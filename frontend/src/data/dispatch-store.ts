import type { MaintenanceBatch } from './types'

// 维保下发单单独存一份 localStorage：和业务条目数据互不影响，重置模块数据不会清掉下发单。
const STORAGE_KEY = 'airport-ground-handling:maintenance-batches'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): MaintenanceBatch[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as MaintenanceBatch[]
  } catch {
    return []
  }
}

let cache: MaintenanceBatch[] | null = null

export function listBatches(): MaintenanceBatch[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveBatches(batches: MaintenanceBatch[]): void {
  cache = batches
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(batches))
  }
}

export function getBatch(id: number): MaintenanceBatch | undefined {
  return listBatches().find((batch) => batch.id === id)
}

export function upsertBatch(batch: MaintenanceBatch): void {
  const batches = listBatches()
  const index = batches.findIndex((item) => item.id === batch.id)
  const next = [...batches]
  if (index >= 0) {
    next[index] = clone(batch)
  } else {
    next.unshift(clone(batch))
  }
  saveBatches(next)
}
