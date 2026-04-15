<script setup lang="ts">
import { BLACK, WHITE, type SupportedSize } from '../engine';
import type { AIType } from '../worker/ai-worker';

type PlayerKey = 'black' | 'white';

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

const players = [
  { key: 'black', stone: BLACK, label: 'Black' },
  { key: 'white', stone: WHITE, label: 'White' },
] as const;
const emitUpdate = emit as (
  event: 'update:blackIsAI' | 'update:whiteIsAI' | 'update:blackTimeLimit' |
    'update:whiteTimeLimit' | 'update:blackAIType' | 'update:whiteAIType',
  value: boolean | number | AIType,
) => void;

function emitPlayerUpdate(player: PlayerKey, field: 'IsAI' | 'TimeLimit' | 'AIType', value: boolean | number | AIType): void {
  emitUpdate(`update:${player}${field}` as Parameters<typeof emitUpdate>[0], value);
}

function onModeChange(player: PlayerKey, event: Event): void {
  emitPlayerUpdate(player, 'IsAI', (event.target as HTMLInputElement).value === 'ai');
}

function onTimeLimitChange(player: PlayerKey, event: Event): void {
  emitPlayerUpdate(player, 'TimeLimit', Math.max(1, Number((event.target as HTMLInputElement).value) || 75));
}

function onAITypeChange(player: PlayerKey, event: Event): void {
  emitPlayerUpdate(player, 'AIType', (event.target as HTMLSelectElement).value as AIType);
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
      :key="player.key"
      class="player-fieldset"
    >
      <legend>{{ player.stone === BLACK ? '●' : '○' }} {{ player.label }}</legend>
      <label
        v-for="mode in ['human', 'ai'] as const"
        :key="mode"
      >
        <input
          type="radio"
          :name="`${player.key}-mode`"
          :value="mode"
          :checked="player.key === 'black' ? props.blackIsAI === (mode === 'ai') : props.whiteIsAI === (mode === 'ai')"
          @change="onModeChange(player.key, $event)"
        />
        {{ mode === 'ai' ? 'AI' : 'Human' }}
      </label>
      <label v-if="player.key === 'black' ? props.blackIsAI : props.whiteIsAI">
        AI type
        <select
          :value="player.key === 'black' ? props.blackAIType : props.whiteAIType"
          @change="onAITypeChange(player.key, $event)"
        >
          <option value="classic">Classic</option>
        </select>
      </label>
      <label>
        AI time (ms)
        <input
          type="number"
          min="1"
          step="1"
          :value="player.key === 'black' ? props.blackTimeLimit : props.whiteTimeLimit"
          @change="onTimeLimitChange(player.key, $event)"
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
