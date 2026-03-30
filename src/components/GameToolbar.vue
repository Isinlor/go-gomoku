<script setup lang="ts">
import { BLACK, WHITE, type SupportedSize } from '../engine';

const props = defineProps<{
  blackIsAI: boolean;
  whiteIsAI: boolean;
  blackTimeLimit: number;
  whiteTimeLimit: number;
  boardSize: SupportedSize;
  aiThinking: boolean;
}>();

const emit = defineEmits<{
  'update:blackIsAI': [value: boolean];
  'update:whiteIsAI': [value: boolean];
  'update:blackTimeLimit': [value: number];
  'update:whiteTimeLimit': [value: number];
  'update:boardSize': [value: SupportedSize];
  newGame: [];
  undo: [];
}>();

function onBlackModeChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:blackIsAI', target.value === 'ai');
}

function onWhiteModeChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:whiteIsAI', target.value === 'ai');
}

function onBlackTimeLimitChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:blackTimeLimit', Math.max(1, Number(target.value) || 75));
}

function onWhiteTimeLimitChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit('update:whiteTimeLimit', Math.max(1, Number(target.value) || 75));
}

function onBoardSizeChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit('update:boardSize', Number(target.value) as SupportedSize);
}
</script>

<template>
  <div class="toolbar">
    <fieldset class="player-fieldset">
      <legend>● Black</legend>
      <label>
        <input
          type="radio"
          name="black-mode"
          value="human"
          :checked="!props.blackIsAI"
          @change="onBlackModeChange"
        />
        Human
      </label>
      <label>
        <input
          type="radio"
          name="black-mode"
          value="ai"
          :checked="props.blackIsAI"
          @change="onBlackModeChange"
        />
        AI
      </label>
      <label>
        AI time (ms)
        <input
          type="number"
          min="1"
          step="1"
          :value="props.blackTimeLimit"
          @change="onBlackTimeLimitChange"
        />
      </label>
    </fieldset>

    <fieldset class="player-fieldset">
      <legend>○ White</legend>
      <label>
        <input
          type="radio"
          name="white-mode"
          value="human"
          :checked="!props.whiteIsAI"
          @change="onWhiteModeChange"
        />
        Human
      </label>
      <label>
        <input
          type="radio"
          name="white-mode"
          value="ai"
          :checked="props.whiteIsAI"
          @change="onWhiteModeChange"
        />
        AI
      </label>
      <label>
        AI time (ms)
        <input
          type="number"
          min="1"
          step="1"
          :value="props.whiteTimeLimit"
          @change="onWhiteTimeLimitChange"
        />
      </label>
    </fieldset>

    <label>
      Board size
      <select :value="String(props.boardSize)" @change="onBoardSizeChange">
        <option value="9">9x9</option>
        <option value="11">11x11</option>
        <option value="13">13x13</option>
      </select>
    </label>

    <button type="button" @click="emit('newGame')">New game</button>
    <button type="button" @click="emit('undo')">Undo</button>
  </div>
</template>
