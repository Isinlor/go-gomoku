<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  error: string;
}>();

const emit = defineEmits<{
  loadGame: [text: string];
}>();

const loadInput = ref('');

function onLoad(): void {
  emit('loadGame', loadInput.value);
}
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
      <button type="button" @click="onLoad">Load game</button>
      <span id="load-error">{{ props.error }}</span>
    </div>
  </div>
</template>
