<script setup lang="ts">
import { ref } from 'vue';

const { error } = defineProps<{
  error: string;
}>();

const emit = defineEmits<{
  loadGame: [text: string];
}>();

const loadInput = ref('');
</script>

<template>
  <div class="load-section">
    <label for="load-input"><strong>Load game</strong></label>
    <textarea
      id="load-input"
      v-model="loadInput"
      rows="2"
      placeholder="e.g. B9 e5 d4 f4 ..."
    />
    <div class="load-row">
      <button type="button" @click="emit('loadGame', loadInput)">Load game</button>
      <span id="load-error">{{ error }}</span>
    </div>
  </div>
</template>
