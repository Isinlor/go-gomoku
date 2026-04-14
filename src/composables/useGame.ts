import { ref, shallowRef, triggerRef, computed, onUnmounted } from 'vue';
import {
  GogoPosition,
  GogoAI,
  BLACK,
  WHITE,
  EMPTY,
  playerName,
  decodeGame,
  type SupportedSize,
  type Player,
  type Puzzle,
} from '../engine';
import type { AIRequest, AIResponse, AIType } from '../worker/ai-worker';

export interface UseGameOptions {
  createWorker?: () => Worker;
  getLocationHash?: () => string;
  getLocationHref?: () => string;
  setLocationHash?: (hash: string) => void;
}

const MIN_SOFTMAX_EXPONENT = -700;

export function useGame(options: UseGameOptions = {}) {
  const getLocationHash = options.getLocationHash ?? (() => window.location.hash);
  const getLocationHref = options.getLocationHref ?? (() => window.location.href);
  const setLocationHash = options.setLocationHash ?? ((hash: string) => {
    window.history.replaceState(null, '', hash);
  });

  const size = ref<SupportedSize>(9);
  const game = shallowRef(new GogoPosition(9));
  const blackIsAI = ref(false);
  const whiteIsAI = ref(true);
  const blackTimeLimit = ref(75);
  const whiteTimeLimit = ref(75);
  const blackAIType = ref<AIType>('classic');
  const whiteAIType = ref<AIType>('classic');
  const aiThinking = ref(false);
  const statusExtra = ref('');
  const loadError = ref('');
  const boardVersion = ref(0);
  const boardEvaluation = ref<Array<{ score: number; probability: number } | null>>([]);

  function notifyBoardChange(): void {
    boardVersion.value += 1;
    triggerRef(game);
  }

  function clearBoardEvaluation(): void {
    if (boardEvaluation.value.length === 0) return;
    boardEvaluation.value = [];
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
    const base = getLocationHref().split('#')[0];
    return `${base}#${encodeURIComponent(gameRecord.value)}`;
  });

  function boardDisabled(): boolean {
    return aiThinking.value || !isCurrentPlayerHuman() || game.value.winner !== EMPTY;
  }

  function makeAIConfig(): { maxDepth: number; quiescenceDepth: number; maxPly: number } {
    return {
      maxDepth: 12,
      quiescenceDepth: 4,
      maxPly: 96,
    };
  }

  function maybeRunAI(): void {
    if (!isAITurn() || aiThinking.value) {
      return;
    }
    clearBoardEvaluation();
    aiThinking.value = true;
    statusExtra.value = 'AI searching';
    pendingGameId += 1;
    const g = game.value;
    const config = makeAIConfig();
    const timeLimit = g.toMove === BLACK ? blackTimeLimit.value : whiteTimeLimit.value;
    const aiType = g.toMove === BLACK ? blackAIType.value : whiteAIType.value;
    const request: AIRequest = {
      encodedGame: g.encodeGame(),
      timeLimitMs: Math.max(1, timeLimit),
      maxDepth: config.maxDepth,
      quiescenceDepth: config.quiescenceDepth,
      maxPly: config.maxPly,
      aiType,
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
      const forcedOutcomeSuffix = result.forcedWin
        ? ', forced win'
        : result.forcedLoss
          ? ', forced loss'
          : '';
      statusExtra.value = `AI depth ${result.depth}, nodes ${result.nodes}${forcedOutcomeSuffix}`;
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
    clearBoardEvaluation();
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
    clearBoardEvaluation();
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
    clearBoardEvaluation();
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
      clearBoardEvaluation();
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

  function loadPuzzle(puzzle: Puzzle): void {
    blackIsAI.value = false;
    whiteIsAI.value = false;
    clearBoardEvaluation();
    loadGame(puzzle.encoded);
  }

  function setSize(newSize: SupportedSize): void {
    size.value = newSize;
  }

  function onModeChange(): void {
    if (!aiThinking.value) {
      clearBoardEvaluation();
      statusExtra.value = '';
      notifyBoardChange();
      maybeRunAI();
    }
  }

  function onAITypeChange(): void {
    if (!aiThinking.value) {
      clearBoardEvaluation();
      statusExtra.value = '';
      notifyBoardChange();
    }
  }

  function toSoftmaxProbabilities(scores: readonly number[]): number[] {
    if (scores.length === 0) return [];
    let maxScore = Number.NEGATIVE_INFINITY;
    for (const score of scores) {
      if (score > maxScore) {
        maxScore = score;
      }
    }
    const logits = new Array(scores.length);
    let sum = 0;
    for (let i = 0; i < scores.length; i += 1) {
      const value = Math.exp(Math.max(MIN_SOFTMAX_EXPONENT, scores[i] - maxScore));
      logits[i] = value;
      sum += value;
    }
    if (sum <= 0 || !Number.isFinite(sum)) {
      const uniform = 1 / scores.length;
      return new Array(scores.length).fill(uniform);
    }
    return logits.map((value) => value / sum);
  }

  function evaluateBoard(): void {
    if (aiThinking.value) {
      return;
    }
    const g = game.value;
    if (g.winner !== EMPTY || !g.hasAnyLegalMove()) {
      clearBoardEvaluation();
      statusExtra.value = 'No legal moves to evaluate';
      notifyBoardChange();
      return;
    }
    const config = makeAIConfig();
    const timeLimit = g.toMove === BLACK ? blackTimeLimit.value : whiteTimeLimit.value;
    const result = new GogoAI({
      maxDepth: config.maxDepth,
      quiescenceDepth: config.quiescenceDepth,
      maxPly: config.maxPly,
    }).evaluateBoard(g, Math.max(1, timeLimit));

    const probabilities = toSoftmaxProbabilities(result.scores.map((entry) => entry.score));
    const overlay = new Array<{ score: number; probability: number } | null>(g.area).fill(null);
    for (let i = 0; i < result.scores.length; i += 1) {
      const entry = result.scores[i];
      overlay[entry.move] = {
        score: entry.score,
        probability: probabilities[i],
      };
    }
    boardEvaluation.value = overlay;
    statusExtra.value = `Board eval depth ${result.depth}, nodes ${result.nodes}${result.timedOut ? ', timed out' : ''}`;
    notifyBoardChange();
  }

  function tryLoadFromUrl(): boolean {
    const raw = getLocationHash().trim();
    const hashIndex = raw.indexOf('#');
    const hash = hashIndex >= 0
      ? raw.slice(hashIndex + 1)
      : raw.startsWith('http://') || raw.startsWith('https://')
        ? ''
        : raw.replace(/^#/, '');
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
    blackAIType,
    whiteAIType,
    aiThinking,
    statusText,
    statusExtra,
    gameRecord,
    gameUrl,
    loadError,
    boardVersion,
    boardEvaluation,
    boardDisabled,
    newGame,
    undo,
    playMove,
    loadGame,
    loadPuzzle,
    evaluateBoard,
    setSize,
    onModeChange,
    onAITypeChange,
    tryLoadFromUrl,
    maybeRunAI,
    isAITurn,
    isCurrentPlayerHuman,
    terminateWorker,
  };
}
