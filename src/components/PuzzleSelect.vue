<script setup lang="ts">
import { PUZZLES, type Puzzle } from '../engine';

const emit = defineEmits<{
  loadPuzzle: [puzzle: Puzzle];
}>();

function onPuzzleChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const puzzle = PUZZLES.find((p) => p.id === target.value);
  if (puzzle !== undefined) emit('loadPuzzle', puzzle);
  target.value = '';
}
</script>

<template>
  <div class="puzzle-section">
    <label for="puzzle-select"><strong>Puzzles</strong></label>
    <select id="puzzle-select" @change="onPuzzleChange">
      <option value="">Select a puzzle…</option>
      <option v-for="p in PUZZLES" :key="p.id" :value="p.id">
        {{ p.toMove === 1 ? 'Black' : 'White' }} ({{ p.depth }},{{ p.threshold }})
      </option>
    </select>
  </div>
</template>
