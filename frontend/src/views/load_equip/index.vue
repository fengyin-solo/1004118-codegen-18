<template>
  <section class="page" data-module="load_equip">
    <header class="page-head">
      <div>
        <h2>装卸设备管理</h2>
        <p class="page-desc">
          多选设备编号后整组维保下发：随单提交设备类型、适用机型、最大载重、维保记录与设备状态，系统逐台处理，
          已报修或已在维保中的设备只跳过，归属冲突判失败，可从失败项继续。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="selectedIds.length === 0" @click="openDispatch">
          整组维保下发{{ selectedIds.length ? `（已选 ${selectedIds.length} 台）` : '' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出装卸设备清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
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
              :indeterminate.prop="someVisibleSelected"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': isSelected(row) }">
          <td class="check-cell">
            <input type="checkbox" :checked="isSelected(row)" @change="toggleOne(row)" />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="ownerOf(row)" class="owner-tag">归属 {{ ownerOf(row) }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
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
          <td :colspan="columns.length + 3" class="empty-state">暂无装卸设备数据，可先登记装卸设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条装卸设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 整组维保下发：提交前预览每台设备会被受理、跳过还是判归属冲突 -->
    <div v-if="dispatching" class="dispatch-panel">
      <h3 class="panel-title">整组维保下发确认</h3>
      <p class="panel-tip">
        以下 {{ previewRows.length }} 台设备将随单提交设备类型、适用机型、最大载重、维保记录与设备状态，
        一次提交后逐台处理；只跳过不允许维保的设备，其余设备受理后进入维保中。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>设备类型</th>
            <th>适用机型</th>
            <th>最大载重</th>
            <th>维保记录</th>
            <th>设备状态</th>
            <th>处理预判</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in previewRows" :key="entry.equipmentId">
            <td>{{ entry.equipmentNo }}</td>
            <td>{{ snapshotOf(entry.equipmentId)['设备类型'] ?? '—' }}</td>
            <td>{{ snapshotOf(entry.equipmentId)['适用机型'] ?? '—' }}</td>
            <td>{{ snapshotOf(entry.equipmentId)['最大载重'] ?? '—' }}</td>
            <td>{{ snapshotOf(entry.equipmentId)['维保记录'] ?? '—' }}</td>
            <td>{{ snapshotOf(entry.equipmentId)['设备状态'] ?? '—' }}</td>
            <td>
              <span :class="entry.allowed ? 'item-accepted' : previewClass(entry.reason)">
                {{ entry.allowed ? '受理维保' : entry.reason }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="panel-actions">
        <button class="btn primary" type="button" :disabled="submitting" @click="submit">
          {{ submitting ? '处理中…' : '确认提交并逐台处理' }}
        </button>
        <button class="btn ghost" type="button" :disabled="submitting" @click="dispatching = false">取消</button>
      </div>
    </div>

    <!-- 最近一次提交 / 继续处理结果 -->
    <div v-if="lastResult" class="dispatch-panel">
      <h3 class="panel-title">下发单 {{ lastResult.batch.batchNo }}</h3>
      <p :class="lastResult.duplicated ? 'item-skipped' : 'result-text'">{{ lastResult.message }}</p>
      <BatchDetail :batch="lastResult.batch" @continue="continueBatch" />
    </div>

    <!-- 历史下发单：失败项还在的单子可以从失败项继续（最近结果已在上方单独展示） -->
    <div v-if="olderBatches.length" class="dispatch-panel">
      <h3 class="panel-title">维保下发单</h3>
      <BatchDetail
        v-for="batch in olderBatches"
        :key="batch.id"
        :batch="batch"
        @continue="continueBatch"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import BatchDetail from './BatchDetail.vue'
import {
  continueDispatch,
  listDispatchBatches,
  previewDispatch,
  submitDispatch,
  completeEquipmentMaintenance,
  type SubmitResult,
} from '@/api/maintenance-dispatch'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, MaintenanceBatch } from '@/data/types'

const meta = moduleMeta('load_equip')
const columns = ['设备编号', '设备类型', '适用机型', '最大载重', '安装位置', '购入日期', '维保记录', '设备状态']
const statuses = ['待机', '运行中', '维保中', '已报修']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const selectedIds = ref<number[]>([])
const dispatching = ref(false)
const submitting = ref(false)
const lastResult = ref<SubmitResult | null>(null)
const batches = ref<MaintenanceBatch[]>([])

const stats = computed(() => [
  { label: '运行中设备', value: rows.value.filter((row) => String(row.status) === '运行中').length },
  { label: '维保中设备', value: rows.value.filter((row) => String(row.status) === '维保中').length },
  { label: '报修设备', value: rows.value.filter((row) => String(row.status) === '已报修').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const allVisibleSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => isSelected(row)),
)
const someVisibleSelected = computed(
  () => !allVisibleSelected.value && rows.value.some((row) => isSelected(row)),
)

const previewRows = computed(() =>
  dispatching.value ? previewDispatch(selectedIds.value) : [],
)

// 最近一次提交/继续的下发单在顶部单独展示，历史区里不再重复。
const olderBatches = computed(() =>
  batches.value.filter((batch) => batch.id !== lastResult.value?.batch.id),
)

function isSelected(row: EntryRow): boolean {
  return selectedIds.value.includes(Number(row.id))
}

function toggleOne(row: EntryRow): void {
  const id = Number(row.id)
  if (isSelected(row)) {
    selectedIds.value = selectedIds.value.filter((value) => value !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

function toggleAll(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    const merged = new Set([...selectedIds.value, ...rows.value.map((row) => Number(row.id))])
    selectedIds.value = [...merged]
  } else {
    const visible = new Set(rows.value.map((row) => Number(row.id)))
    selectedIds.value = selectedIds.value.filter((id) => !visible.has(id))
  }
}

function ownerOf(row: EntryRow): string {
  return String(row['维保归属'] ?? '')
}

// 归属冲突会判失败（可继续），其余不允许维保的情形只是跳过。
function previewClass(reason: string): string {
  return reason.includes('冲突') ? 'item-failed' : 'item-skipped'
}

// 维保中只能「完成维保」；其它设备走启用 / 报修，维保下发统一从整组入口走。
function actionsFor(row: EntryRow): string[] {
  if (String(row.status) === '维保中') {
    return ['完成维保']
  }
  return ['启用设备', '申请报修']
}

function snapshotOf(equipmentId: number): Record<string, string> {
  const row = rows.value.find((candidate) => Number(candidate.id) === equipmentId)
  if (!row) {
    return {}
  }
  return {
    设备类型: String(row['设备类型'] ?? ''),
    适用机型: String(row['适用机型'] ?? ''),
    最大载重: String(row['最大载重'] ?? ''),
    维保记录: String(row['维保记录'] ?? ''),
    设备状态: String(row.status ?? ''),
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openDispatch() {
  errorMessage.value = ''
  lastResult.value = null
  dispatching.value = true
}

function submit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    lastResult.value = submitDispatch(selectedIds.value)
    dispatching.value = false
    selectedIds.value = []
    reloadAll()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '整组维保下发失败'
  } finally {
    submitting.value = false
  }
}

function continueBatch(batchId: number) {
  errorMessage.value = ''
  try {
    lastResult.value = continueDispatch(batchId)
    reloadAll()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '从失败项继续失败'
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const id = Number(row.id)
  const result =
    action === '完成维保'
      ? completeEquipmentMaintenance(id)
      : applyAction(meta.key, id, action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reloadAll()
}

function reloadBatches() {
  batches.value = listDispatchBatches()
}

function reloadAll() {
  reload()
  reloadBatches()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '装卸设备列表读取失败'
  }
}

onMounted(reloadAll)
</script>
