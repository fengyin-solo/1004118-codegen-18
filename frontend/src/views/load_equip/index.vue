<template>
  <section class="page" data-module="load_equip">
    <header class="page-head">
      <div>
        <h2>装卸设备管理</h2>
        <p class="page-desc">
          勾选多台设备后整组维保下发，携带设备类型、适用机型、最大载重、维保记录与设备状态一次提交、逐台处理；只跳过不允许维保的设备，失败后可从失败项继续。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="openDispatch">
          整组维保下发{{ selectedIds.length ? `（已选 ${selectedIds.length} 台）` : '' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出装卸设备清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">恢复演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">运行中设备</span>
        <strong class="stat-value">{{ countOf('运行中') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">维保中设备</span>
        <strong class="stat-value">{{ countOf('维保中') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">报修设备</span>
        <strong class="stat-value">{{ countOf('已报修') }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th class="check-cell">
            <input
              type="checkbox"
              :checked="allVisibleSelected"
              :indeterminate.prop="someVisibleSelected && !allVisibleSelected"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>维保归属</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-cell">
            <input type="checkbox" :value="Number(row.id)" v-model="selectedIds" />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row['维保归属'] || '—' }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无装卸设备数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条装卸设备记录 · 已勾选 {{ selectedIds.length }} 台</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="dispatch-history">
      <h3>整组维保下发记录</h3>
      <p v-if="!dispatches.length" class="empty-state">还没有整组维保下发单。</p>
      <article v-for="dispatch in dispatches" :key="dispatch.batchNo" class="dispatch-card">
        <header class="dispatch-card-head">
          <div>
            <strong>{{ dispatch.batchNo }}</strong>
            <span class="dispatch-state" :data-state="dispatch.state">{{ stateText(dispatch.state) }}</span>
          </div>
          <div class="dispatch-meta">
            <span>提交时间：{{ dispatch.submittedAt }}</span>
            <span>共 {{ dispatch.equipIds.length }} 台</span>
            <button
              v-if="dispatch.state === 'partial'"
              class="btn primary"
              type="button"
              @click="resumeDispatch(dispatch.batchNo)"
            >
              从失败项继续（第 {{ dispatch.cursor + 1 }} 台）
            </button>
          </div>
        </header>
        <p class="dispatch-note">维保记录：{{ dispatch.note }}</p>
        <ol class="dispatch-items">
          <li v-for="item in dispatch.items" :key="item.equipId" class="dispatch-item" :data-status="item.status">
            <span class="item-no">{{ item.equipNo }}</span>
            <span class="item-status">{{ itemStatusText(item.status) }}</span>
            <span class="item-message">{{ item.message }}</span>
          </li>
        </ol>
      </article>
    </section>

    <div v-if="dispatchOpen" class="modal-mask" @click.self="closeDispatch">
      <div class="modal">
        <header class="modal-head">
          <h3>整组维保下发</h3>
          <button class="link" type="button" @click="closeDispatch">关闭</button>
        </header>
        <div class="modal-body">
          <p class="modal-tip">
            本次共选 {{ selectedRows.length }} 台设备，设备类型、适用机型、最大载重、设备状态按设备明细一并提交，
            系统逐台受理：已报修设备只跳过不阻断，归属冲突等失败项会中断，之后可从失败项继续。
          </p>
          <table class="data-table">
            <thead>
              <tr>
                <th>设备编号</th>
                <th>设备类型</th>
                <th>适用机型</th>
                <th>最大载重</th>
                <th>设备状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in selectedRows" :key="String(row.id)">
                <td>{{ row['设备编号'] }}</td>
                <td>{{ row['设备类型'] }}</td>
                <td>{{ row['适用机型'] }}</td>
                <td>{{ row['最大载重'] }}</td>
                <td>{{ row.status }}</td>
              </tr>
            </tbody>
          </table>
          <label class="note-field">
            <span>本次维保记录 <em>*</em></span>
            <textarea v-model="dispatchNote" rows="3" placeholder="例如：2026-10 秋季整组维保，更换液压油并复检制动系统"></textarea>
          </label>

          <div v-if="activeDispatch" class="dispatch-result">
            <p :class="resultDeduped ? 'warn-text' : 'ok-text'">
              <template v-if="resultDeduped">重复下发已拦截：直接返回首次受理单 {{ activeDispatch.batchNo }}，不重复生效。</template>
              <template v-else>下发单 {{ activeDispatch.batchNo }} 已受理，状态：{{ stateText(activeDispatch.state) }}。</template>
            </p>
            <ol class="dispatch-items">
              <li
                v-for="item in activeDispatch.items"
                :key="item.equipId"
                class="dispatch-item"
                :data-status="item.status"
              >
                <span class="item-no">{{ item.equipNo }}</span>
                <span class="item-status">{{ itemStatusText(item.status) }}</span>
                <span class="item-message">{{ item.message }}</span>
              </li>
            </ol>
          </div>
        </div>
        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeDispatch">关闭</button>
          <button
            v-if="activeDispatch && activeDispatch.state === 'partial'"
            class="btn"
            type="button"
            @click="resumeActive"
          >
            从失败项继续
          </button>
          <button class="btn primary" type="button" @click="submitDispatch">一次提交</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries } from '@/api/local-service'
import {
  applyEquipmentAction,
  continueGroupMaintenance,
  listGroupMaintenance,
  submitGroupMaintenance,
  syncCargoLedger,
} from '@/api/maintenance-service'
import { resetRows } from '@/data/local-store'
import { resetDispatches } from '@/data/maintenance-store'
import type { EntryRow, MaintenanceDispatch, MaintenanceDispatchState, MaintenanceItemStatus } from '@/data/types'

const metaKey = 'load_equip'
const columns = ['设备编号', '设备类型', '适用机型', '最大载重', '安装位置', '购入日期', '维保记录', '设备状态']
const filterFields = columns.slice(0, 3)
const statuses = ['待机', '运行中', '维保中', '已报修']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const selectedIds = ref<number[]>([])
const dispatches = ref<MaintenanceDispatch[]>([])

const dispatchOpen = ref(false)
const dispatchNote = ref('')
const activeDispatch = ref<MaintenanceDispatch | null>(null)
const resultDeduped = ref(false)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const selectedRows = computed(() =>
  rows.value.filter((row) => selectedIds.value.includes(Number(row.id))),
)

const allVisibleSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)
const someVisibleSelected = computed(() =>
  rows.value.some((row) => selectedIds.value.includes(Number(row.id))),
)

function countOf(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

// 已在维保中的设备可以补「完成维保」，其它状态走启用/维保/报修流转。
function rowActions(row: EntryRow): string[] {
  return String(row.status) === '维保中'
    ? ['完成维保', '申请报修']
    : ['启用设备', '安排维保', '申请报修']
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(metaKey)
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const visibleIds = rows.value.map((row) => Number(row.id))
  if (checked) {
    selectedIds.value = [...new Set([...selectedIds.value, ...visibleIds])]
  } else {
    selectedIds.value = selectedIds.value.filter((id) => !visibleIds.includes(id))
  }
}

function openDispatch() {
  if (!selectedIds.value.length) {
    return
  }
  dispatchNote.value = ''
  activeDispatch.value = null
  resultDeduped.value = false
  dispatchOpen.value = true
}

function closeDispatch() {
  dispatchOpen.value = false
}

function submitDispatch() {
  errorMessage.value = ''
  const result = submitGroupMaintenance(selectedIds.value, dispatchNote.value)
  if ('ok' in result && !result.ok) {
    errorMessage.value = result.message
    return
  }
  const payload = result as { dispatch: MaintenanceDispatch; deduped: boolean }
  activeDispatch.value = payload.dispatch
  resultDeduped.value = payload.deduped
  reload()
}

function resumeDispatch(batchNo: string) {
  const updated = continueGroupMaintenance(batchNo)
  if (updated && activeDispatch.value?.batchNo === batchNo) {
    activeDispatch.value = updated
  }
  reload()
}

function resumeActive() {
  if (activeDispatch.value) {
    resumeDispatch(activeDispatch.value.batchNo)
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyEquipmentAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function resetDemo() {
  resetRows(metaKey)
  resetDispatches()
  syncCargoLedger()
  selectedIds.value = []
  reload()
}

function stateText(state: MaintenanceDispatchState): string {
  return { processing: '受理中', partial: '失败中断', done: '整组办结' }[state]
}

function itemStatusText(status: MaintenanceItemStatus): string {
  return { pending: '待处理', success: '受理成功', skipped: '跳过', failed: '失败' }[status]
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(metaKey, filters.value)
    rows.value = payload.items
    total.value = payload.total
    selectedIds.value = selectedIds.value.filter((id) => rows.value.some((row) => Number(row.id) === id))
    dispatches.value = listGroupMaintenance()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '装卸设备列表读取失败'
  }
}

onMounted(() => {
  // 进入装卸设备页即保证货物装卸台账与设备清单同步替代。
  syncCargoLedger()
  reload()
})
</script>
