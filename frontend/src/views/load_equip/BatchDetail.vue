<template>
  <div class="batch-card">
    <div class="batch-head">
      <strong>下发单 {{ batch.batchNo }}</strong>
      <span class="batch-meta">
        提交于 {{ batch.createdAt }} · 共 {{ batch.items.length }} 台：
        受理 {{ summary.accepted }} / 完成 {{ summary.completed }} /
        跳过 {{ summary.skipped }} / 失败 {{ summary.failed }} / 待处理 {{ summary.pending }}
      </span>
      <button v-if="canRun" class="btn primary btn-sm" type="button" @click="emit('continue', batch.id)">
        从失败项继续
      </button>
      <span v-else class="batch-closed">该单已无可继续条目</span>
    </div>
    <ul class="batch-items">
      <li
        v-for="item in batch.items"
        :key="item.equipmentId"
        class="batch-item"
        :class="`item-${item.status}`"
      >
        <span class="item-no">{{ item.equipmentNo }}</span>
        <span class="item-badge" :class="`item-${item.status}`">{{ labelOf[item.status] }}</span>
        <span class="item-reason">{{ item.reason }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { canContinue } from '@/api/maintenance-dispatch'
import type { DispatchItemStatus, MaintenanceBatch } from '@/data/types'

const props = defineProps<{ batch: MaintenanceBatch }>()
const emit = defineEmits<{ (event: 'continue', batchId: number): void }>()

const labelOf: Record<DispatchItemStatus, string> = {
  pending: '待处理',
  accepted: '已受理（维保中）',
  skipped: '已跳过',
  failed: '处理失败',
  completed: '维保完成',
}

const summary = computed(() => {
  const result = { pending: 0, accepted: 0, skipped: 0, failed: 0, completed: 0 }
  for (const item of props.batch.items) {
    result[item.status] += 1
  }
  return result
})

const canRun = computed(() => canContinue(props.batch))
</script>
