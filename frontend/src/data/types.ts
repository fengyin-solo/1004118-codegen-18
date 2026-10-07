/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 整组维保下发：一次勾选多台设备，同一条维保记录逐台受理。
export type MaintenanceItemStatus = 'pending' | 'success' | 'skipped' | 'failed'

export type MaintenanceItem = {
  equipId: number
  equipNo: string
  status: MaintenanceItemStatus
  message: string
}

// processing：还没遇到失败也没做完；partial：在失败项中断，可从失败项继续；done：全部处理完。
export type MaintenanceDispatchState = 'processing' | 'partial' | 'done'

export type MaintenanceDispatch = {
  batchNo: string
  idempotencyKey: string
  equipIds: number[]
  note: string
  submittedAt: string
  cursor: number
  state: MaintenanceDispatchState
  items: MaintenanceItem[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
