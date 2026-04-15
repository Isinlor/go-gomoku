<script setup lang="ts">
const { record } = defineProps<{
  record: string;
}>();

const emit = defineEmits<{
  copyUrl: [];
}>();
</script>

<template>
  <div class="game-record-section">
    <label><strong>Game record</strong></label>
    <div class="game-record-row">
      <textarea
        id="game-record"
        readonly
        rows="2"
        aria-label="Game record in move notation"
        :value="record"
      />
      <button type="button" @click="emit('copyUrl')">Copy URL</button>
    </div>
  </div>
</template>
