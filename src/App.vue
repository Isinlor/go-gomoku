<script setup lang="ts">
import { useGame } from './composables/useGame';
import GameToolbar from './components/GameToolbar.vue';
import BoardGrid from './components/BoardGrid.vue';
import GameRecord from './components/GameRecord.vue';
import LoadGame from './components/LoadGame.vue';
import type { SupportedSize } from './engine';

const {
  size,
  game,
  blackIsAI,
  whiteIsAI,
  blackTimeLimit,
  whiteTimeLimit,
  aiThinking,
  statusText,
  gameRecord,
  loadError,
  boardDisabled,
  newGame,
  undo,
  playMove,
  loadGame,
  setSize,
  onModeChange,
  gameUrl,
} = useGame();

function onUpdateBlackIsAI(value: boolean): void {
  blackIsAI.value = value;
  onModeChange();
}

function onUpdateWhiteIsAI(value: boolean): void {
  whiteIsAI.value = value;
  onModeChange();
}

function onUpdateBoardSize(value: SupportedSize): void {
  setSize(value);
}

function onCopyUrl(): void {
  navigator.clipboard.writeText(gameUrl.value).catch(() => {
    prompt('Copy this URL:', gameUrl.value);
  });
}
</script>

<template>
  <GameToolbar
    :black-is-a-i="blackIsAI"
    :white-is-a-i="whiteIsAI"
    :black-time-limit="blackTimeLimit"
    :white-time-limit="whiteTimeLimit"
    :board-size="size"
    :ai-thinking="aiThinking"
    @update:black-is-a-i="onUpdateBlackIsAI"
    @update:white-is-a-i="onUpdateWhiteIsAI"
    @update:black-time-limit="blackTimeLimit = $event"
    @update:white-time-limit="whiteTimeLimit = $event"
    @update:board-size="onUpdateBoardSize"
    @new-game="newGame"
    @undo="undo"
  />

  <div id="status">{{ statusText }}</div>

  <BoardGrid
    :board="game.board"
    :size="game.size"
    :disabled="boardDisabled()"
    @cell-click="playMove"
  />

  <GameRecord
    :record="gameRecord"
    @copy-url="onCopyUrl"
  />

  <LoadGame
    :error="loadError"
    @load-game="loadGame"
  />

  <div class="hint">
    Select <strong>Human</strong> or <strong>AI</strong> for each player above. You can switch
    modes at any time during the game — switching a player to AI immediately triggers the AI to
    play. The demo uses the same engine and AI exported by the package. Serve this folder with
    any static HTTP server and open this file in a browser.
  </div>
</template>
