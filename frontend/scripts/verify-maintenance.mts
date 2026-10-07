// 整组维保业务规则的节点侧验证：用内存 localStorage 替身跑完整流程。
import { assert } from 'node:console'

const memory = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
}

const { syncCargoLedger, submitGroupMaintenance, continueGroupMaintenance, applyEquipmentAction } = await import(
  './src/api/maintenance-service.ts'
)
const { resetRows } = await import('./src/data/local-store.ts')
const { resetDispatches } = await import('./src/data/maintenance-store.ts')

let passed = 0
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    console.error(`✗ ${name} ${detail}`)
    process.exitCode = 1
  } else {
    passed++
    console.log(`✓ ${name}`)
  }
}

function loadEquipRows() {
  return JSON.parse(memory.get('airport-ground-handling:entries:v2')!).load_equip
}
function cargoRows() {
  return JSON.parse(memory.get('airport-ground-handling:entries:v2')!).cargo
}

resetRows('load_equip')
resetDispatches()
syncCargoLedger()

// 场景一：选 1（待机）、2（运行中）、5（已报修）、6（运行中）一次提交，逐台处理且只跳过 5。
const first = submitGroupMaintenance([1, 2, 5, 6], '秋季整组维保A') as any
check('首单办结', first.deduped === false && first.dispatch.state === 'done')
const rowsAfterFirst = loadEquipRows()
check('设备1转维保中', rowsAfterFirst[0].status === '维保中')
check('设备2转维保中', rowsAfterFirst[1].status === '维保中')
check('已报修设备5只跳过、不阻断', first.dispatch.items[2].status === 'skipped' && rowsAfterFirst[4].status === '已报修')
check('设备6转维保中', rowsAfterFirst[5].status === '维保中')
check('维保记录追加而非重置', String(rowsAfterFirst[0]['维保记录']).startsWith('2026-08-10 季度维保完成；'))
check('办结后归属仍按先受理者保留', rowsAfterFirst[0]['维保归属'] === first.dispatch.batchNo && rowsAfterFirst[5]['维保归属'] === first.dispatch.batchNo)
const cargo1 = cargoRows()
check('台账同步替代为设备清单', cargo1.length === 6 && cargo1[0]['装卸编号'] === 'LE-CARG-0001')
check('维保中映射异常中断', cargo1[0].status === '异常中断' && cargo1[1].status === '异常中断')
check('已报修映射异常中断且异常标记', cargo1[4].status === '异常中断' && cargo1[4].abnormal === true)

// 场景二：同样的设备选择重复下发，只生效一次。
const repeat = submitGroupMaintenance([6, 5, 2, 1], '另一条不同的记录') as any
check('重复下发被幂等拦截', repeat.deduped === true && repeat.dispatch.batchNo === first.dispatch.batchNo)
const recordsBefore = String(loadEquipRows()[0]['维保记录'])
const repeatAgain = submitGroupMaintenance([1, 2, 5, 6], '再来一次') as any
check('幂等不追加新记录', repeatAgain.deduped === true && String(loadEquipRows()[0]['维保记录']) === recordsBefore)

// 场景三：只完成设备1的维保（释放一台），再下发 [1,3]，成功；
// 此时 3 被第二张单占用，另一张单 [3,4] 应在设备3处归属冲突失败并中断，4 维持原状。
const done1 = applyEquipmentAction(1, '完成维保')
check('单台完成维保', done1.ok && loadEquipRows()[0].status === '待机')

const second = submitGroupMaintenance([1, 3], '整组B') as any
check('第二张单办结并占用设备3', second.dispatch.state === 'done')
check('设备3被第二张单受理', loadEquipRows()[2].status === '维保中' && loadEquipRows()[2]['维保归属'] === second.dispatch.batchNo)
check('设备3维保记录保留历史并追加', String(loadEquipRows()[2]['维保记录']).includes('2026-09-05 更换液压油；'))

const third = submitGroupMaintenance([3, 4], '整组C') as any
check('冲突单在失败项中断', third.dispatch.state === 'partial' && third.dispatch.cursor === 0)
check('冲突项标记失败且提示先受理者', third.dispatch.items[0].status === 'failed' && third.dispatch.items[0].message.includes(second.dispatch.batchNo))
check('冲突失败后后续设备4未处理', third.dispatch.items[1].status === 'pending' && loadEquipRows()[3].status === '维保中')
check('设备4未被挂第三张单归属', loadEquipRows()[3]['维保归属'] !== third.dispatch.batchNo)

// 场景四：第二张单完成设备3维保后，从失败项继续：3这次成功，4已是无归属在维设备被受理成功，整组办结。
const finish3 = applyEquipmentAction(3, '完成维保')
check('设备3完成维保释放归属', finish3.ok && !loadEquipRows()[2]['维保归属'])
const resumed = continueGroupMaintenance(third.dispatch.batchNo)!
check('从失败项继续后办结', resumed.state === 'done' && resumed.cursor === 2)
check('设备3由第三张单受理', resumed.items[0].status === 'success' && loadEquipRows()[2]['维保归属'] === third.dispatch.batchNo)
check('设备4在维中被受理后办结释放', resumed.items[1].status === 'success')
const record3History = String(loadEquipRows()[2]['维保记录'])
check('已完成记录未被重置（两次下发记录都在）', record3History.includes('整组B') && record3History.includes('整组C'))

// 场景五：已报修设备单台也不允许维保。
const repaired = applyEquipmentAction(5, '安排维保')
check('已报修设备单台维保被拒', !repaired.ok && repaired.message.includes('不允许维保'))

// 场景六：空选与空记录校验
const empty1 = submitGroupMaintenance([], 'x') as any
const empty2 = submitGroupMaintenance([1], '   ') as any
check('空选被拒', empty1.ok === false)
check('空维保记录被拒', empty2.ok === false)

assert(passed > 0)
console.log(`\n${passed} 项断言全部通过`)
