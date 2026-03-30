import { ref, shallowRef, triggerRef, computed, onUnmounted } from 'vue';
import {
  GogoPosition,
  BLACK,
  WHITE,
  EMPTY,
  playerName,
  decodeGame,
  type SupportedSize,
  type Player,
} from '../engine';
import type { AIRequest, AIResponse } from '../worker/ai-worker';

export interface UseGameOptions {
  createWorker?: () => Worker;
  getLocationHash?: () => string;
  setLocationHash?: (hash: string) => void;
}

export function useGame(options: UseGameOptions = {}) {
  const getLocationHash = options.getLocationHash ?? (() => window.location.href);
  const setLocationHash = options.setLocationHash ?? ((hash: string) => {
    window.history.replaceState(null, '', hash);
  });

  const size = ref<SupportedSize>(9);
  const game = shallowRef(new GogoPosition(9));
  const blackIsAI = ref(false);
  const whiteIsAI = ref(true);
  const blackTimeLimit = ref(75);
  const whiteTimeLimit = ref(75);
  const aiThinking = ref(false);
  const statusExtra = ref('');
  const loadError = ref('');
  const boardVersion = ref(0);

  function notifyBoardChange(): void {
    boardVersion.value += 1;
    triggerRef(game);
  }

  let worker: Worker | null = null;
  let pendingGameId = 0;

  function getWorker(): Worker {
    if (worker === null) {
      const w = options.createWorker
        ? options.createWorker()
        : new Worker(new URL('../worker/ai-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = createWorkerMessageHandler(w);
      w.onerror = createWorkerErrorHandler(w);
      w.onmessageerror = createWorkerErrorHandler(w);
      worker = w;
    }
    return worker;
  }

  function terminateWorker(): void {
    if (worker !== null) {
      worker.terminate();
      worker = null;
    }
  }

  onUnmounted(() => {
    terminateWorker();
  });

  function isCurrentPlayerHuman(): boolean {
    return game.value.toMove === BLACK ? !blackIsAI.value : !whiteIsAI.value;
  }

  function isAITurn(): boolean {
    const g = game.value;
    if (g.winner !== EMPTY || !g.hasAnyLegalMove()) return false;
    return g.toMove === BLACK ? blackIsAI.value : whiteIsAI.value;
  }

  function playerLabel(player: Player): string {
    const isAI = player === BLACK ? blackIsAI.value : whiteIsAI.value;
    return `${playerName(player)}${isAI ? ' (AI)' : ''}`;
  }

  const statusText = computed(() => {
    const g = game.value;
    const extra = statusExtra.value;
    const suffix = extra ? ` — ${extra}` : '';
    if (g.winner !== EMPTY) {
      return `${playerName(g.winner as Player)} wins${suffix}`;
    }
    if (!g.hasAnyLegalMove()) {
      return `draw${suffix}`;
    }
    return `${playerLabel(g.toMove)} to move${suffix}`;
  });

  const gameRecord = computed(() => {
    return game.value.encodeGame();
  });

  const gameUrl = computed(() => {
    const base = getLocationHash().split('#')[0];
    return `${base}#${encodeURIComponent(gameRecord.value)}`;
  });

  function boardDisabled(): boolean {
    return aiThinking.value || !isCurrentPlayerHuman() || game.value.winner !== EMPTY;
  }

  function makeAIConfig(): { maxDepth: number; quiescenceDepth: number; maxPly: number } {
    return {
      maxDepth: game.value.size === 13 ? 5 : 6,
      quiescenceDepth: 6,
      maxPly: 96,
    };
  }

  function maybeRunAI(): void {
    if (!isAITurn() || aiThinking.value) {
      return;
    }
    aiThinking.value = true;
    statusExtra.value = 'AI searching';
    pendingGameId += 1;
    const g = game.value;
    const config = makeAIConfig();
    const timeLimit = g.toMove === BLACK ? blackTimeLimit.value : whiteTimeLimit.value;
    const request: AIRequest = {
      encodedGame: g.encodeGame(),
      timeLimitMs: Math.max(1, timeLimit),
      maxDepth: config.maxDepth,
      quiescenceDepth: config.quiescenceDepth,
      maxPly: config.maxPly,
    };
    const w = getWorker();
    (w as unknown as { _pendingId: number })._pendingId = pendingGameId;
    w.postMessage(request);
  }

  function createWorkerMessageHandler(expectedWorker: Worker) {
    return function onWorkerMessage(event: MessageEvent<AIResponse>): void {
      // Ignore messages from a worker that is no longer current
      if (expectedWorker !== worker) return;
      const currentId = (expectedWorker as unknown as { _pendingId: number })._pendingId;
      if (currentId !== pendingGameId) return;
      const result = event.data;
      if (result.move !== -1) {
        game.value.play(result.move);
      }
      aiThinking.value = false;
      statusExtra.value = `AI depth ${result.depth}, nodes ${result.nodes}`;
      notifyBoardChange();
      updateLocationHash();
      maybeRunAI();
    };
  }

  function createWorkerErrorHandler(expectedWorker: Worker) {
    return function onWorkerError(): void {
      if (expectedWorker !== worker) return;
      aiThinking.value = false;
      statusExtra.value = 'AI worker error';
      terminateWorker();
    };
  }

  function updateLocationHash(): void {
    setLocationHash(`#${encodeURIComponent(gameRecord.value)}`);
  }

  function newGame(): void {
    terminateWorker();
    aiThinking.value = false;
    game.value = new GogoPosition(size.value);
    statusExtra.value = '';
    notifyBoardChange();
    updateLocationHash();
    maybeRunAI();
  }

  function undo(): void {
    if (aiThinking.value) return;
    const g = game.value;
    if (g.ply === 0) return;
    g.undo();
    const hasHumanPlayer = !blackIsAI.value || !whiteIsAI.value;
    if (hasHumanPlayer && isAITurn() && g.ply > 0) {
      g.undo();
    }
    statusExtra.value = '';
    notifyBoardChange();
    updateLocationHash();
    maybeRunAI();
  }

  function playMove(index: number): void {
    if (aiThinking.value || !isCurrentPlayerHuman() || game.value.winner !== EMPTY) {
      return;
    }
    if (!game.value.play(index)) {
      statusExtra.value = 'illegal move';
      notifyBoardChange();
      return;
    }
    statusExtra.value = '';
    notifyBoardChange();
    updateLocationHash();
    maybeRunAI();
  }

  function loadGame(text: string): boolean {
    loadError.value = '';
    const trimmed = text.trim();
    if (!trimmed) return false;
    try {
      const loaded = decodeGame(trimmed);
      terminateWorker();
      aiThinking.value = false;
      game.value = loaded;
      size.value = loaded.size;
      statusExtra.value = '';
      notifyBoardChange();
      updateLocationHash();
      maybeRunAI();
      return true;
    } catch (err: unknown) {
      loadError.value = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  function setSize(newSize: SupportedSize): void {
    size.value = newSize;
  }

  function onModeChange(): void {
    if (!aiThinking.value) {
      statusExtra.value = '';
      notifyBoardChange();
      maybeRunAI();
    }
  }

  function tryLoadFromUrl(): boolean {
    const hash = getLocationHash().replace(/^.*#/, '');
    if (!hash) return false;
    try {
      const text = decodeURIComponent(hash);
      return loadGame(text);
    } catch {
      return false;
    }
  }

  // Initialize from URL or start new game
  if (!tryLoadFromUrl()) {
    newGame();
  }

  return {
    size,
    game,
    blackIsAI,
    whiteIsAI,
    blackTimeLimit,
    whiteTimeLimit,
    aiThinking,
    statusText,
    statusExtra,
    gameRecord,
    gameUrl,
    loadError,
    boardVersion,
    boardDisabled,
    newGame,
    undo,
    playMove,
    loadGame,
    setSize,
    onModeChange,
    tryLoadFromUrl,
    maybeRunAI,
    isAITurn,
    isCurrentPlayerHuman,
    terminateWorker,
  };
}
