<script setup lang="ts">
import { PUZZLES, type Puzzle } from '../engine';

const emit = defineEmits<{
  loadPuzzle: [puzzle: Puzzle];
}>();

function onPuzzleChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const id = target.value;
  if (!id) return;
  const puzzle = PUZZLES.find((p) => p.id === id);
  if (puzzle) {
    emit('loadPuzzle', puzzle);
  }
  target.value = '';
}

function label(puzzle: Puzzle): string {
  const color = puzzle.toMove === 1 ? 'Black' : 'White';
  return `${color} (${puzzle.depth},${puzzle.threshold})`;
}
</script>

<template>
  <div class="puzzle-section">
    <label for="puzzle-select"><strong>Puzzles</strong></label>
    <select id="puzzle-select" @change="onPuzzleChange">
      <option value="">Select a puzzle…</option>
      <option v-for="p in PUZZLES" :key="p.id" :value="p.id">
        {{ label(p) }}
      </option>
    </select>
  </div>
</template>
