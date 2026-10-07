<template>
  <section class="page" data-module="cargo">
    <header class="page-head">
      <div>
        <h2>货物装卸管理</h2>
        <p class="page-desc">维护货物装卸，围绕装卸编号、关联航班、货物品类、件数吨位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记货物装卸</button>
        <button class="btn" type="button" @click="exportRows">导出货物装卸清单</button>
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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无货物装卸数据，可先登记货物装卸</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条货物装卸记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 其它入口的货物装卸台账不单独维护设备清单，统一用装卸设备管理的同步替代清单 -->
    <div class="dispatch-panel">
      <h3 class="panel-title">装卸设备清单（同步替代）</h3>
      <p class="panel-tip">
        本台账的设备清单已由「装卸设备管理」替代并保持同步：整组维保下发后这里实时反映设备状态与归属，
        维保中、已报修设备不可用于本次装卸，不再维护独立清单。
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
            <th>可用于装卸</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="equip in equipmentRows" :key="String(equip.id)">
            <td>{{ equip['设备编号'] ?? '—' }}</td>
            <td>{{ equip['设备类型'] ?? '—' }}</td>
            <td>{{ equip['适用机型'] ?? '—' }}</td>
            <td>{{ equip['最大载重'] ?? '—' }}</td>
            <td>{{ equip['维保记录'] ?? '—' }}</td>
            <td>
              {{ equip.status }}
              <span v-if="ownerOf(equip)" class="owner-tag">归属 {{ ownerOf(equip) }}</span>
            </td>
            <td>
              <span :class="availableForCargo(equip) ? 'item-accepted' : 'item-skipped'">
                {{ availableForCargo(equip) ? '可调用' : availabilityReason(equip) }}
              </span>
            </td>
          </tr>
          <tr v-if="!equipmentRows.length">
            <td colspan="7" class="empty-state">暂无同步的装卸设备数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cargo')
const columns = ["装卸编号", "关联航班", "货物品类", "件数吨位", "装卸班组", "计划开始", "实际完成", "装卸状态"]
const actions = ["开始装卸", "确认完成", "标记中断"]
const statuses = ["待装卸", "装卸中", "已完成", "异常中断"]
const stats = [{"label": "待装卸航班", "value": 0}, {"label": "装卸中航班", "value": 0}, {"label": "异常中断航班", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 同步替代清单：直接读装卸设备模块的同一份数据，维保下发改完这里即同步。
const equipmentRows = ref<EntryRow[]>([])

function ownerOf(row: EntryRow): string {
  return String(row['维保归属'] ?? '')
}

function availableForCargo(row: EntryRow): boolean {
  const status = String(row.status)
  return status === '待机' || status === '运行中'
}

function availabilityReason(row: EntryRow): string {
  const status = String(row.status)
  if (status === '维保中') {
    return '维保中不可用'
  }
  if (status === '已报修') {
    return '已报修不可用'
  }
  return '不可用'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '货物装卸登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 同步替代清单每次随台账一起刷新。
    equipmentRows.value = listEntries('load_equip').items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '货物装卸列表读取失败'
  }
}

onMounted(reload)
</script>
