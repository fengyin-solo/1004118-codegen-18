import { listRows, saveRows } from '@/data/local-store'
import { findDispatch, listDispatches, upsertDispatch } from '@/data/maintenance-store'
import type {
  ActionResult,
  EntryRow,
  MaintenanceDispatch,
  MaintenanceItem,
  MaintenanceItemStatus,
} from '@/data/types'

// 装卸设备整组维保下发：一次勾选多台设备、同一条维保记录，逐台受理。
const LOAD_EQUIP_KEY = 'load_equip'
const CARGO_KEY = 'cargo'
const MAINTENANCE_STATUS = '维保中'
const REPAIRED_STATUS = '已报修'
const OWNER_FIELD = '维保归属'

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowLabel(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

// 维保记录只追加、不覆盖：任何下发都不能把既有记录重置掉。
function appendMaintenanceNote(row: EntryRow, entry: string): EntryRow {
  const previous = String(row['维保记录'] ?? '').trim()
  const next = previous ? `${previous}；${entry}` : entry
  return { ...row, '维保记录': next }
}

// 同一份设备选择重复下发，只认第一次受理的那张下发单。
function buildIdempotencyKey(equipIds: number[]): string {
  return [...new Set(equipIds)].sort((a, b) => a - b).join(',')
}

function buildBatchNo(sequence: number): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `WB-${stamp}-${String(sequence + 1).padStart(2, '0')}`
}

// 归属是否还挂在某张下发单上：设备维保未逐台完成前，先受理者一直占用，后到者冲突失败。
function activeOwnerOf(row: EntryRow): string | undefined {
  const owner = String(row[OWNER_FIELD] ?? '').trim()
  return owner || undefined
}

type ProcessOutcome = {
  status: MaintenanceItemStatus
  message: string
  updated?: EntryRow
}

// 逐台受理：只跳过明确不允许维保的设备（已报修）；归属冲突等失败项中断整组。
function acceptForMaintenance(row: EntryRow | undefined, dispatch: MaintenanceDispatch): ProcessOutcome {
  if (!row) {
    return { status: 'failed', message: '设备不存在或已下架，受理失败' }
  }
  const equipNo = String(row['设备编号'] ?? row.id)
  const current = String(row.status)
  if (current === REPAIRED_STATUS) {
    return { status: 'skipped', message: `设备 ${equipNo} 已报修，不允许维保，已跳过` }
  }
  if (current === MAINTENANCE_STATUS) {
    const owner = activeOwnerOf(row)
    if (owner && owner !== dispatch.batchNo) {
      return {
        status: 'failed',
        message: `设备 ${equipNo} 已由先受理的 ${owner} 占用维保，归属冲突`,
      }
    }
    // 没有归属人的在维设备（例如单台安排维保进入），视为本组首次受理并挂归属。
    return {
      status: 'success',
      message: `设备 ${equipNo} 已在维保中，由本下发单 ${dispatch.batchNo} 受理`,
      updated: { ...appendMaintenanceNote(row, `[${todayLabel()}] 整组维保下发（${dispatch.batchNo}）：${dispatch.note}`), [OWNER_FIELD]: dispatch.batchNo },
    }
  }
  const updated: EntryRow = {
    ...appendMaintenanceNote(row, `[${todayLabel()}] 整组维保下发（${dispatch.batchNo}）：${dispatch.note}`),
    status: MAINTENANCE_STATUS,
    pending: true,
    abnormal: false,
    [OWNER_FIELD]: dispatch.batchNo,
  }
  return { status: 'success', message: `设备 ${equipNo} 受理成功，状态转为「维保中」`, updated }
}

// 从游标位置逐台处理，直到整组做完或遇到失败项中断；游标之前的已完成项不会被重置。
function driveDispatch(dispatch: MaintenanceDispatch): MaintenanceDispatch {
  const rows = listRows(LOAD_EQUIP_KEY)
  const nextRows = [...rows]
  let cursor = dispatch.cursor

  while (cursor < dispatch.equipIds.length) {
    const equipId = dispatch.equipIds[cursor]
    const rowIndex = nextRows.findIndex((row) => Number(row.id) === equipId)
    const row = rowIndex >= 0 ? nextRows[rowIndex] : undefined
    const outcome = acceptForMaintenance(row, dispatch)
    const base: MaintenanceItem = {
      equipId,
      equipNo: row ? String(row['设备编号'] ?? equipId) : `#${equipId}`,
      status: outcome.status,
      message: outcome.message,
    }

    if (outcome.status === 'failed') {
      dispatch.items[cursor] = base
      dispatch.cursor = cursor
      dispatch.state = 'partial'
      saveRows(LOAD_EQUIP_KEY, nextRows)
      syncCargoLedger()
      upsertDispatch(dispatch)
      return dispatch
    }

    if (outcome.updated) {
      nextRows[rowIndex] = outcome.updated
    }
    dispatch.items[cursor] = base
    cursor += 1
  }

  dispatch.cursor = cursor
  dispatch.state = 'done'
  // 注意：下发办结不等于维保完成，归属仍逐台挂在设备上，直到该台「完成维保」才释放。
  saveRows(LOAD_EQUIP_KEY, nextRows)
  syncCargoLedger()
  upsertDispatch(dispatch)
  return dispatch
}

export type GroupMaintenanceResult = {
  dispatch: MaintenanceDispatch
  deduped: boolean
}

export function submitGroupMaintenance(equipIds: number[], rawNote: string): GroupMaintenanceResult | ActionResult {
  const ids = [...new Set(equipIds)].sort((a, b) => a - b)
  const note = rawNote.trim().replace(/[，,]/g, '、')
  if (ids.length === 0) {
    return { ok: false, message: '请先勾选至少一台设备' }
  }
  if (!note) {
    return { ok: false, message: '请填写本次整组维保的维保记录' }
  }

  const idempotencyKey = buildIdempotencyKey(ids)
  const existing = findDispatch(idempotencyKey)
  if (existing) {
    // 重复下发只生效一次：直接回第一次的受理结果，不再逐台处理。
    return { dispatch: existing, deduped: true }
  }

  const dispatch: MaintenanceDispatch = {
    batchNo: buildBatchNo(listDispatches().length),
    idempotencyKey,
    equipIds: ids,
    note,
    submittedAt: nowLabel(),
    cursor: 0,
    state: 'processing',
    items: ids.map((id) => ({
      equipId: id,
      equipNo: `#${id}`,
      status: 'pending' as MaintenanceItemStatus,
      message: '等待受理',
    })),
  }
  upsertDispatch(dispatch)
  const driven = driveDispatch(dispatch)
  return { dispatch: driven, deduped: false }
}

// 从失败项继续：成功项与跳过项原样保留，只从游标（上次失败项）继续逐台处理。
export function continueGroupMaintenance(batchNo: string): MaintenanceDispatch | undefined {
  const dispatch = listDispatches().find((item) => item.batchNo === batchNo)
  if (!dispatch || dispatch.state === 'done') {
    return dispatch
  }
  return driveDispatch(dispatch)
}

export function listGroupMaintenance(): MaintenanceDispatch[] {
  return listDispatches()
}

// 单台动作仍在装卸设备页保留，统一在这里保证维保记录追加与台账同步。
export function applyEquipmentAction(id: number, action: string): ActionResult {
  const rows = listRows(LOAD_EQUIP_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的装卸设备` }
  }
  const row = rows[index]
  const current = String(row.status)
  const nextRows = [...rows]

  if (action === '安排维保') {
    if (current === REPAIRED_STATUS) {
      return { ok: false, message: '已报修设备不允许维保，需先复检启用' }
    }
    if (current === MAINTENANCE_STATUS) {
      const owner = activeOwnerOf(row)
      if (owner) {
        return { ok: false, message: `设备已由 ${owner} 受理维保，归属冲突，不能重复安排` }
      }
      return { ok: false, message: '设备已经在维保中，不用重复安排' }
    }
    nextRows[index] = {
      ...appendMaintenanceNote(row, `[${todayLabel()}] 单台安排维保`),
      status: MAINTENANCE_STATUS,
      pending: true,
      abnormal: false,
    }
    saveRows(LOAD_EQUIP_KEY, nextRows)
    syncCargoLedger()
    return { ok: true, message: `设备 ${String(row['设备编号'] ?? id)} 已安排维保，当前状态「维保中」` }
  }

  if (action === '完成维保') {
    if (current !== MAINTENANCE_STATUS) {
      return { ok: false, message: `设备当前是「${current}」，没有进行中的维保可完成` }
    }
    nextRows[index] = {
      ...appendMaintenanceNote(row, `[${todayLabel()}] 维保完成，恢复待机`),
      status: '待机',
      pending: true,
      abnormal: false,
      [OWNER_FIELD]: '',
    }
    saveRows(LOAD_EQUIP_KEY, nextRows)
    syncCargoLedger()
    return { ok: true, message: `设备 ${String(row['设备编号'] ?? id)} 维保完成，已恢复「待机」` }
  }

  const targets: Record<string, string> = { '启用设备': '运行中', '申请报修': '已报修' }
  const target = targets[action]
  if (!target) {
    return { ok: false, message: `装卸设备没有登记「${action}」这个动作` }
  }
  if (current === target) {
    return { ok: false, message: `设备已经是「${target}」，不用重复操作` }
  }
  if (target === REPAIRED_STATUS && activeOwnerOf(row)) {
    return { ok: false, message: `设备已由 ${activeOwnerOf(row)} 受理维保，归属冲突，不能直接报修` }
  }
  nextRows[index] = { ...row, status: target, pending: target !== REPAIRED_STATUS, abnormal: false }
  saveRows(LOAD_EQUIP_KEY, nextRows)
  syncCargoLedger()
  return { ok: true, message: `设备已${action}，当前状态「${target}」` }
}

// 货物装卸台账同步替代：整张台账由装卸设备清单投影生成，每次设备变化后整体替换。
export function syncCargoLedger(): void {
  const equipmentRows = listRows(LOAD_EQUIP_KEY)
  const cargoRows: EntryRow[] = equipmentRows.map((row) => {
    const statusMap: Record<string, string> = {
      '待机': '待装卸',
      '运行中': '装卸中',
      '维保中': '异常中断',
      '已报修': '异常中断',
    }
    const mapped = statusMap[String(row.status)] ?? '待装卸'
    return {
      id: Number(row.id),
      status: mapped,
      pending: mapped !== '已完成',
      abnormal: mapped === '异常中断',
      '装卸编号': `LE-CARG-${String(row.id).padStart(4, '0')}`,
      '关联航班': String(row['适用机型'] ?? '—'),
      '货物品类': String(row['设备类型'] ?? '—'),
      '件数吨位': String(row['最大载重'] ?? '—'),
      '装卸班组': String(row['安装位置'] ?? '—'),
      '计划开始': String(row['购入日期'] ?? '—'),
      '实际完成': String(row['维保记录'] ?? '—'),
      '装卸状态': `${mapped}（来源设备 ${String(row['设备编号'] ?? row.id)}）`,
      '来源设备编号': String(row['设备编号'] ?? row.id),
    }
  })
  saveRows(CARGO_KEY, cargoRows)
}
