// 业务规则端到端验证：用内存 localStorage 跑通整组维保下发的全部约束。
const store: Record<string, string> = {}
globalThis.window = {
  localStorage: {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => delete store[key],
  },
} as unknown as Window & typeof globalThis

import {
  submitDispatch,
  continueDispatch,
  completeEquipmentMaintenance,
  listDispatchBatches,
} from '../src/api/maintenance-dispatch'
import { resetRows, listRows } from '../src/data/local-store'

let failures = 0
function assert(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) {
    failures += 1
    console.error(`✗ ${label}\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

function statusOf(id: number): string {
  const row = listRows('load_equip').find((item) => Number(item.id) === id)
  return String(row!.status)
}
function ownerOf(id: number): string {
  const row = listRows('load_equip').find((item) => Number(item.id) === id)
  return String(row!['维保归属'] ?? '')
}
function recordOf(id: number): string {
  const row = listRows('load_equip').find((item) => Number(item.id) === id)
  return String(row!['维保记录'] ?? '')
}
function statusesOf(batchNo: string): Record<string, string> {
  const batch = listDispatchBatches().find((item) => item.batchNo === batchNo)!
  return Object.fromEntries(batch.items.map((item) => [String(item.equipmentId), item.status]))
}

// 回到种子：1 待机,2 运行中,3 维保中(无归属),4 待机,5 运行中,6 已报修
resetRows('load_equip')
store['airport-ground-handling:maintenance-batches'] = '[]'

console.log('--- 场景1：一次提交逐台处理，只跳过不允许维保的设备 ---')
const r1 = submitDispatch([1, 2, 3, 6])
assert('受理 2 台（待机/运行中）', r1.summary.accepted, 2)
assert('维保中(无归属)+已报修 共跳过 2 台', r1.summary.skipped, 2)
assert('无归属冲突失败', r1.summary.failed, 0)
assert('设备1进入维保中并归属本单', [statusOf(1), ownerOf(1)], ['维保中', r1.batch.batchNo])
assert('设备2进入维保中并归属本单', [statusOf(2), ownerOf(2)], ['维保中', r1.batch.batchNo])
assert('设备6仍为已报修', statusOf(6), '已报修')
assert('设备1维保记录为追加而非覆盖', recordOf(1).startsWith('2026-08-10 例行保养；整组维保下发受理'), true)

console.log('--- 场景2：重复下发只生效一次（同组设备仍在处理中） ---')
const r2 = submitDispatch([6, 3, 2, 1])
assert('识别为重复下发', r2.duplicated, true)
assert('返回同一张下发单', r2.batch.id, r1.batch.id)
const record1AfterDup = recordOf(1)
const record2AfterDup = recordOf(2)
assert('重复下发未再追加维保记录', [recordOf(1), recordOf(2)], [record1AfterDup, record2AfterDup])

console.log('--- 场景3：设备归属冲突以先受理者为准，判失败；从失败项继续 ---')
// 新组：4待机(可受理) + 1已被第一张单占用(冲突失败) + 5运行中(排在失败项之后,应保持待处理)
const r3 = submitDispatch([4, 1, 5])
assert('第二张单受理 1 台', r3.summary.accepted, 1)
assert('第二张单冲突失败 1 台', r3.summary.failed, 1)
assert('失败台之后的设备保持待处理', r3.summary.pending, 1)
assert('设备4归属第二张单', ownerOf(4), r3.batch.batchNo)
assert('设备1归属仍属第一张单（先受理者为准）', ownerOf(1), r1.batch.batchNo)

// 第一张单完成设备1维保，释放归属；第二张单从失败项继续
const c1 = completeEquipmentMaintenance(1)
assert('设备1完成维保回到待机', c1.ok, true)
assert('设备1归属已释放', [statusOf(1), ownerOf(1)], ['待机', ''])
const r3b = continueDispatch(r3.batch.id)
assert('继续后失败项被受理', statusesOf(r3.batch.batchNo)['1'], 'accepted')
assert('继续后原待处理的设备5也被受理', statusesOf(r3.batch.batchNo)['5'], 'accepted')
assert('继续后无剩余失败', r3b.summary.failed, 0)
assert('设备5归属第二张单', ownerOf(5), r3.batch.batchNo)

console.log('--- 场景4：已完成记录不得被重置 ---')
const record1Before = recordOf(1)
const r3c = continueDispatch(r3.batch.id)
assert('已受理/已跳过条目不被重置', statusesOf(r3.batch.batchNo)['4'], 'accepted')
assert('重复继续不产生失败', r3c.summary.failed, 0)
assert('设备1维保记录未被改写', recordOf(1), record1Before)

// 第二张单完成设备1维保 → 条目 completed；再继续也不得重置
completeEquipmentMaintenance(1)
const stBefore = statusesOf(r3.batch.batchNo)['1']
assert('完成维保单条目为 completed', stBefore, 'completed')
continueDispatch(r3.batch.id)
assert('completed 条目继续后仍为 completed', statusesOf(r3.batch.batchNo)['1'], 'completed')

console.log('--- 场景5：下发单全部办结后，同组设备新一轮维保允许发起（新单） ---')
// 完成第二张单全部在维保设备
for (const id of [1, 4, 5]) completeEquipmentMaintenance(id)
const r4 = submitDispatch([1, 4])
assert('办结后相同设备发起的是新下发单', r4.duplicated, false)
assert('新单成功受理两台', r4.summary.accepted, 2)

console.log('--- 场景6：非维保中设备不能完成维保（已完成记录不被重置） ---')
const c2 = completeEquipmentMaintenance(2) // 设备2仍在第一张单维保中 → 可以完成
assert('维保中设备可完成维保', c2.ok, true)
const c3 = completeEquipmentMaintenance(2) // 完成后再来一次 → 拒绝
assert('已回到待机后重复完成被拒绝', c3.ok, false)
assert('设备2完成记录追加且保留受理记录', recordOf(2).includes('整组维保下发受理') && recordOf(2).includes('整组维保完成'), true)

console.log('')
if (failures > 0) {
  console.error(`共 ${failures} 项断言失败`)
  process.exit(1)
}
console.log('全部业务规则断言通过')
