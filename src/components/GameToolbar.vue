<script setup lang="ts">
import { computed } from 'vue';
import { BLACK, WHITE, type SupportedSize } from '../engine';
import type { AIType } from '../worker/ai-worker';

const props = defineProps<{
  blackIsAI: boolean;
  whiteIsAI: boolean;
  blackTimeLimit: number;
  whiteTimeLimit: number;
  blackAIType: AIType;
  whiteAIType: AIType;
  boardSize: SupportedSize;
  aiThinking: boolean;
}>();

const emit = defineEmits<{
  'update:blackIsAI': [value: boolean];
  'update:whiteIsAI': [value: boolean];
  'update:blackTimeLimit': [value: number];
  'update:whiteTimeLimit': [value: number];
  'update:blackAIType': [value: AIType];
  'update:whiteAIType': [value: AIType];
  'update:boardSize': [value: SupportedSize];
  newGame: [];
  undo: [];
}>();

const players = computed(() => [
  {
    color: BLACK,
    legend: '● Black',
    modeName: 'black-mode',
    isAI: props.blackIsAI,
    timeLimit: props.blackTimeLimit,
    aiType: props.blackAIType,
  },
  {
    color: WHITE,
    legend: '○ White',
    modeName: 'white-mode',
    isAI: props.whiteIsAI,
    timeLimit: props.whiteTimeLimit,
    aiType: props.whiteAIType,
  },
]);

function onModeChange(player: typeof BLACK | typeof WHITE, event: Event): void {
  const target = event.target as HTMLInputElement;
  if (player === BLACK) {
    emit('update:blackIsAI', target.value === 'ai');
  } else {
    emit('update:whiteIsAI', target.value === 'ai');
  }
}

function onTimeLimitChange(player: typeof BLACK | typeof WHITE, event: Event): void {
  const target = event.target as HTMLInputElement;
  const value = Math.max(1, Number(target.value) || 75);
  if (player === BLACK) {
    emit('update:blackTimeLimit', value);
  } else {
    emit('update:whiteTimeLimit', value);
  }
}

function onAITypeChange(player: typeof BLACK | typeof WHITE, event: Event): void {
  const target = event.target as HTMLSelectElement;
  if (player === BLACK) {
    emit('update:blackAIType', target.value as AIType);
  } else {
    emit('update:whiteAIType', target.value as AIType);
  }
}

function onBoardSizeChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit('update:boardSize', Number(target.value) as SupportedSize);
}
</script>

<template>
  <div class="toolbar">
    <fieldset
      v-for="player in players"
      :key="player.color"
      class="player-fieldset"
    >
      <legend>{{ player.legend }}</legend>
      <label>
        <input
          type="radio"
          :name="player.modeName"
          value="human"
          :checked="!player.isAI"
          @change="onModeChange(player.color, $event)"
        />
        Human
      </label>
      <label>
        <input
          type="radio"
          :name="player.modeName"
          value="ai"
          :checked="player.isAI"
          @change="onModeChange(player.color, $event)"
        />
        AI
      </label>
      <label v-if="player.isAI">
        AI type
        <select :value="player.aiType" @change="onAITypeChange(player.color, $event)">
          <option value="classic">Classic</option>
        </select>
      </label>
      <label>
        AI time (ms)
        <input
          type="number"
          min="1"
          step="1"
          :value="player.timeLimit"
          @change="onTimeLimitChange(player.color, $event)"
        />
      </label>
    </fieldset>

    <label>
      Board size
      <select class="board-size-select" :value="String(props.boardSize)" @change="onBoardSizeChange">
        <option value="9">9x9</option>
        <option value="11">11x11</option>
        <option value="13">13x13</option>
      </select>
    </label>

    <button type="button" @click="emit('newGame')">New game</button>
    <button type="button" @click="emit('undo')">Undo</button>
  </div>
</template>
