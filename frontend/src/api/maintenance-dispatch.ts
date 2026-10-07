import { getBatch, listBatches, upsertBatch } from '@/data/dispatch-store'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DispatchItem,
  DispatchItemStatus,
  EntryRow,
  MaintenanceBatch,
} from '@/data/types'

// 整组维保下发的全部业务判断都收口在这个文件里，页面只负责渲染与触发。
const MODULE_KEY = 'load_equip'
const OWNER_FIELD = '维保归属'
const MAINT_RECORD_FIELD = '维保记录'
const TARGET_STATUS = '维保中'
const IDLE_STATUS = '待机'
const REPAIRED_STATUS = '已报修'
const SNAPSHOT_FIELDS = ['设备类型', '适用机型', '最大载重', '维保记录', '设备状态'] as const

export type DispatchSummary = Record<DispatchItemStatus, number> & { total: number }

export type SubmitResult = {
  batch: MaintenanceBatch
  duplicated: boolean
  message: string
  summary: DispatchSummary
}

export type PreviewEntry = {
  equipmentId: number
  equipmentNo: string
  allowed: boolean
  reason: string
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id)))]
}

function batchSignature(batch: MaintenanceBatch): string {
  return batch.items
    .map((item) => item.equipmentId)
    .sort((a, b) => a - b)
    .join(',')
}

function summarize(batch: MaintenanceBatch): DispatchSummary {
  const summary: DispatchSummary = {
    pending: 0,
    accepted: 0,
    skipped: 0,
    failed: 0,
    completed: 0,
    total: batch.items.length,
  }
  for (const item of batch.items) {
    summary[item.status] += 1
  }
  return summary
}

// 下发单仍在处理中：还有待处理 / 失败待继续 / 已受理在维保的条目。
// 全部完成（或只剩跳过）后视为关闭，同一组设备才允许发起新一轮维保。
export function isBatchOpen(batch: MaintenanceBatch): boolean {
  return batch.items.some((item) =>
    item.status === 'pending' || item.status === 'failed' || item.status === 'accepted',
  )
}

export function batchSummary(batch: MaintenanceBatch): DispatchSummary {
  return summarize(batch)
}

export function canContinue(batch: MaintenanceBatch): boolean {
  return batch.items.some((item) => item.status === 'pending' || item.status === 'failed')
}

function nextBatchNo(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const seq = listBatches().filter((batch) => batch.batchNo.includes(day)).length + 1
  return `WB-${day}-${String(seq).padStart(3, '0')}`
}

function appendRecord(row: EntryRow, note: string): void {
  const current = text(row, MAINT_RECORD_FIELD)
  row[MAINT_RECORD_FIELD] = current ? `${current}；${note}` : note
}

// 逐台处理：只处理待处理和失败项；已受理、已跳过、已完成的条目一律不动，
// 这样「从失败项继续」和「重复下发」都不会把已有结果重置掉。
// 遇到第一台失败即中断，后面的设备保持待处理；继续时再从失败项往后逐台跑。
function processItem(item: DispatchItem, batch: MaintenanceBatch, rows: EntryRow[]): boolean {
  if (item.status === 'accepted' || item.status === 'skipped' || item.status === 'completed') {
    return true
  }
  const time = stamp()
  const row = rows.find((candidate) => Number(candidate.id) === item.equipmentId)
  if (!row) {
    item.status = 'failed'
    item.reason = '未找到该设备记录，处理失败'
    return false
  }
  const status = String(row.status)
  const owner = text(row, OWNER_FIELD)
  if (status === REPAIRED_STATUS) {
    // 已报修设备不允许维保：只跳过，不算失败，继续处理后面的设备。
    item.status = 'skipped'
    item.reason = '设备已报修，不允许维保，已跳过'
    return true
  }
  // 只有维保中的设备才谈归属：待机/运行中设备若残留归属（先受理单已完成维保），
  // 视为过期归属，本单直接受理，不制造归属冲突。
  if (status === TARGET_STATUS) {
    if (owner === batch.batchNo) {
      // 本单已经受理过：幂等，不重复写维保记录。
      item.status = 'accepted'
      item.reason = '本下发单已受理，重复下发不生效'
      if (!item.acceptedAt) {
        item.acceptedAt = time
      }
      return true
    }
    if (owner) {
      // 归属冲突：设备已被别的下发单先受理，以先受理者为准，本台判失败并中断，可后续继续。
      item.status = 'failed'
      item.reason = `设备已由下发单 ${owner} 先受理，归属冲突，处理失败`
      return false
    }
    // 没有归属方却已在维保（单台维保入口进入）：重复下发不生效，跳过。
    item.status = 'skipped'
    item.reason = '设备已在维保中，重复下发不生效，已跳过'
    return true
  }
  // 待机 / 运行中：本单受理，占用设备归属并追加维保记录（只追加，不覆盖历史）。
  row.status = TARGET_STATUS
  row[OWNER_FIELD] = batch.batchNo
  row.pending = true
  appendRecord(row, `整组维保下发受理（${batch.batchNo}，${time}）`)
  item.status = 'accepted'
  item.reason = '已受理维保，设备进入维保中'
  item.acceptedAt = time
  return true
}

function runBatch(batch: MaintenanceBatch): MaintenanceBatch {
  const rows = listRows(MODULE_KEY).map((row) => ({ ...row }))
  for (const item of batch.items) {
    const keepGoing = processItem(item, batch, rows)
    if (!keepGoing) {
      break
    }
  }
  saveRows(MODULE_KEY, rows)
  batch.lastRunAt = stamp()
  upsertBatch(batch)
  return batch
}

// 一次提交：多选设备随单带上设备类型、适用机型、最大载重、维保记录、设备状态快照。
export function submitDispatch(ids: number[]): SubmitResult {
  const equipmentIds = uniqueIds(ids)
  if (equipmentIds.length === 0) {
    throw new Error('请先勾选要整组维保的设备')
  }
  const rows = listRows(MODULE_KEY)
  // 同一组设备无论勾选顺序如何都视为同一次下发，签名统一按编号排序。
  const signature = [...equipmentIds].sort((a, b) => a - b).join(',')
  const duplicate = listBatches().find(
    (batch) => batchSignature(batch) === signature && isBatchOpen(batch),
  )
  if (duplicate) {
    // 重复下发只生效一次：处理中的同组下发单直接返回，不再逐台受理。
    return {
      batch: duplicate,
      duplicated: true,
      message: `相同设备的下发单 ${duplicate.batchNo} 仍在处理中，重复下发只生效一次，未重复受理`,
      summary: summarize(duplicate),
    }
  }
  const now = new Date()
  const time = stamp()
  const batchNo = nextBatchNo(now)
  const nextId = listBatches().reduce((max, batch) => Math.max(max, batch.id), 0) + 1
  const items: DispatchItem[] = equipmentIds.map((equipmentId) => {
    const row = rows.find((candidate) => Number(candidate.id) === equipmentId)
    const snapshot = Object.fromEntries(
      SNAPSHOT_FIELDS.map((field) => [field, row ? text(row, field) : '']),
    ) as Pick<DispatchItem, (typeof SNAPSHOT_FIELDS)[number]>
    return {
      equipmentId,
      equipmentNo: row ? text(row, '设备编号') || `#${equipmentId}` : `#${equipmentId}`,
      ...snapshot,
      status: 'pending',
      reason: '',
      acceptedAt: '',
      completedAt: '',
    }
  })
  const batch: MaintenanceBatch = {
    id: nextId,
    batchNo,
    createdAt: time,
    lastRunAt: time,
    items,
  }
  runBatch(batch)
  const summary = summarize(batch)
  return {
    batch,
    duplicated: false,
    message: `下发单 ${batchNo} 已提交：受理 ${summary.accepted} 台，跳过 ${summary.skipped} 台，失败 ${summary.failed} 台`,
    summary,
  }
}

// 整组中一台失败后从失败项继续：按原顺序逐台重试待处理 / 失败项，其它条目保持不动。
export function continueDispatch(batchId: number): SubmitResult {
  const batch = getBatch(batchId)
  if (!batch) {
    throw new Error(`没有找到编号为 ${batchId} 的维保下发单`)
  }
  runBatch(batch)
  const summary = summarize(batch)
  return {
    batch,
    duplicated: false,
    message: `下发单 ${batch.batchNo} 已从失败项继续：受理 ${summary.accepted} 台，跳过 ${summary.skipped} 台，失败 ${summary.failed} 台`,
    summary,
  }
}

export function listDispatchBatches(): MaintenanceBatch[] {
  return listBatches()
}

// 完成维保：把维保中设备放回待机，追加一条完成记录，并把对应下发单条目置为已完成。
// 已完成的条目和历史维保记录都不会被重置。
export function completeEquipmentMaintenance(equipmentId: number): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === equipmentId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${equipmentId} 的装卸设备` }
  }
  const current = { ...rows[index] }
  const status = String(current.status)
  if (status !== TARGET_STATUS) {
    return {
      ok: false,
      message: `设备当前为「${status}」，只有维保中设备可以完成维保；已完成的维保记录不得重置`,
    }
  }
  const owner = text(current, OWNER_FIELD)
  const time = stamp()
  appendRecord(current, `整组维保完成（${owner || '单台维保'}，${time}）`)
  current.status = IDLE_STATUS
  current[OWNER_FIELD] = ''
  current.pending = true
  const next = [...rows]
  next[index] = current
  saveRows(MODULE_KEY, next)

  if (owner) {
    const ownedBatch = listBatches().find((batch) => batch.batchNo === owner)
    if (ownedBatch) {
      const item = ownedBatch.items.find((entry) => entry.equipmentId === equipmentId)
      if (item && item.status === 'accepted') {
        item.status = 'completed'
        item.reason = '维保完成，设备已回到待机'
        item.completedAt = time
        ownedBatch.lastRunAt = time
        upsertBatch(ownedBatch)
      }
    }
  }
  return { ok: true, message: `设备维保已完成，当前状态「${IDLE_STATUS}」` }
}

// 提交前预览：哪些设备允许维保，哪些会被跳过或因归属冲突失败。
export function previewDispatch(ids: number[]): PreviewEntry[] {
  const rows = listRows(MODULE_KEY)
  return uniqueIds(ids).map((equipmentId) => {
    const row = rows.find((candidate) => Number(candidate.id) === equipmentId)
    if (!row) {
      return { equipmentId, equipmentNo: `#${equipmentId}`, allowed: false, reason: '设备记录不存在' }
    }
    const status = String(row.status)
    const owner = text(row, OWNER_FIELD)
    if (status === REPAIRED_STATUS) {
      return { equipmentId, equipmentNo: text(row, '设备编号'), allowed: false, reason: '已报修，不允许维保，将跳过' }
    }
    if (status === TARGET_STATUS) {
      return owner
        ? { equipmentId, equipmentNo: text(row, '设备编号'), allowed: false, reason: `维保中，${owner} 已先受理，将判归属冲突失败` }
        : { equipmentId, equipmentNo: text(row, '设备编号'), allowed: false, reason: '已在维保中，重复下发不生效，将跳过' }
    }
    return { equipmentId, equipmentNo: text(row, '设备编号'), allowed: true, reason: '待机/运行中，允许维保' }
  })
}
