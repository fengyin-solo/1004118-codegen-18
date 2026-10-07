import type { MaintenanceDispatch } from './types'

// 整组维保下发单的本地持久化：下发受理记录和逐台处理进度都放这里，刷新后仍可从失败项继续。
const DISPATCH_STORAGE_KEY = 'airport-ground-handling:maintenance-dispatches'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readDispatches(): MaintenanceDispatch[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(DISPATCH_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as MaintenanceDispatch[]
  } catch {
    return []
  }
}

let cache: MaintenanceDispatch[] | null = null

export function listDispatches(): MaintenanceDispatch[] {
  if (cache === null) {
    cache = readDispatches()
  }
  return cache
}

export function findDispatch(idempotencyKey: string): MaintenanceDispatch | undefined {
  return listDispatches().find((dispatch) => dispatch.idempotencyKey === idempotencyKey)
}

export function saveDispatches(dispatches: MaintenanceDispatch[]): void {
  cache = clone(dispatches)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DISPATCH_STORAGE_KEY, JSON.stringify(cache))
  }
}

export function upsertDispatch(dispatch: MaintenanceDispatch): void {
  const dispatches = listDispatches()
  const index = dispatches.findIndex((item) => item.batchNo === dispatch.batchNo)
  const next = [...dispatches]
  if (index >= 0) {
    next[index] = clone(dispatch)
  } else {
    next.unshift(clone(dispatch))
  }
  saveDispatches(next)
}

export function resetDispatches(): void {
  saveDispatches([])
}
