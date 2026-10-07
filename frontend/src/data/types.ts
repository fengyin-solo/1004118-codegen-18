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

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 整组维保下发：一张下发单包含多台设备的逐台处理条目。
export type DispatchItemStatus = 'pending' | 'accepted' | 'skipped' | 'failed' | 'completed'

export type DispatchItem = {
  equipmentId: number
  equipmentNo: string
  // 下发时随单提交的快照：设备类型、适用机型、最大载重、维保记录、设备状态。
  设备类型: string
  适用机型: string
  最大载重: string
  维保记录: string
  设备状态: string
  status: DispatchItemStatus
  reason: string
  acceptedAt: string
  completedAt: string
}

export type MaintenanceBatch = {
  id: number
  batchNo: string
  createdAt: string
  lastRunAt: string
  items: DispatchItem[]
}
