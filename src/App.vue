<script setup lang="ts">
import { useGame } from './composables/useGame';
import GameToolbar from './components/GameToolbar.vue';
import BoardGrid from './components/BoardGrid.vue';
import GameRecord from './components/GameRecord.vue';
import LoadGame from './components/LoadGame.vue';
import PuzzleSelect from './components/PuzzleSelect.vue';
import { BLACK, WHITE } from './engine';
import type { AIType } from './worker/ai-worker';

const {
  size,
  game,
  blackIsAI,
  whiteIsAI,
  blackTimeLimit,
  whiteTimeLimit,
  blackAIType,
  whiteAIType,
  aiThinking,
  statusText,
  gameRecord,
  loadError,
  boardDisabled,
  boardVersion,
  newGame,
  undo,
  playMove,
  loadGame,
  loadPuzzle,
  setSize,
  onModeChange,
  onAITypeChange,
  gameUrl,
} = useGame();

function updatePlayerMode(player: typeof BLACK | typeof WHITE, value: boolean): void {
  (player === BLACK ? blackIsAI : whiteIsAI).value = value;
  onModeChange();
}

function updatePlayerAIType(player: typeof BLACK | typeof WHITE, value: AIType): void {
  (player === BLACK ? blackAIType : whiteAIType).value = value;
  onAITypeChange();
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
    :black-a-i-type="blackAIType"
    :white-a-i-type="whiteAIType"
    :board-size="size"
    :ai-thinking="aiThinking"
    @update:black-is-a-i="updatePlayerMode(BLACK, $event)"
    @update:white-is-a-i="updatePlayerMode(WHITE, $event)"
    @update:black-time-limit="blackTimeLimit = $event"
    @update:white-time-limit="whiteTimeLimit = $event"
    @update:black-a-i-type="updatePlayerAIType(BLACK, $event)"
    @update:white-a-i-type="updatePlayerAIType(WHITE, $event)"
    @update:board-size="setSize"
    @new-game="newGame"
    @undo="undo"
  />

  <div id="status">{{ statusText }}</div>

  <BoardGrid
    :board="game.board"
    :size="game.size"
    :disabled="boardDisabled()"
    :board-version="boardVersion"
    @cell-click="playMove"
  />

  <GameRecord
    :record="gameRecord"
    @copy-url="onCopyUrl"
  />

  <PuzzleSelect @load-puzzle="loadPuzzle" />

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
