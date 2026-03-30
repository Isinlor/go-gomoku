<script setup lang="ts">
import { computed } from 'vue';
import { BLACK, WHITE, EMPTY, type Cell } from '../engine';

const props = defineProps<{
  board: Uint8Array;
  size: number;
  disabled: boolean;
  boardVersion: number;
}>();

const emit = defineEmits<{
  cellClick: [index: number];
}>();

const cells = computed(() => {
  // Access boardVersion to ensure Vue invalidates the cache when the board mutates
  void props.boardVersion;
  const result: { index: number; value: Cell; label: string; className: string }[] = [];
  for (let y = 0; y < props.size; y++) {
    for (let x = 0; x < props.size; x++) {
      const index = y * props.size + x;
      const value = props.board[index] as Cell;
      let label = '';
      let className = 'cell';
      if (value === BLACK) {
        label = '●';
        className += ' stone-black';
      } else if (value === WHITE) {
        label = '●';
        className += ' stone-white';
      }
      result.push({ index, value, label, className });
    }
  }
  return result;
});
</script>

<template>
  <div
    class="board"
    :style="{ gridTemplateColumns: `repeat(${props.size}, 36px)` }"
    aria-label="GoGomoku board"
  >
    <button
      v-for="cell in cells"
      :key="cell.index"
      :class="cell.className"
      type="button"
      :disabled="props.disabled || cell.value !== 0"
      @click="emit('cellClick', cell.index)"
    >
      {{ cell.label }}
    </button>
  </div>
</template>
