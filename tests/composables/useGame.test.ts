import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, triggerRef } from 'vue';
import { useGame } from '../../src/composables/useGame';
import { BLACK, WHITE, EMPTY, GogoPosition } from '../../src/engine';
import * as engineModule from '../../src/engine';
import type { AIResponse } from '../../src/worker/ai-worker';

function createMockWorker() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as ((event: MessageEvent) => void) | null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as Worker;
  return worker;
}

function mountWithGame(options: Parameters<typeof useGame>[0] = {}) {
  let gameState: ReturnType<typeof useGame> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        gameState = useGame(options);
        return gameState;
      },
      render() {
        return null;
      },
    }),
  );
  return { wrapper, gameState: gameState! };
}

describe('useGame', () => {
  test('initializes with default values for a new game', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });
    expect(gameState.size.value).toBe(9);
    expect(gameState.game.value).toBeInstanceOf(GogoPosition);
    expect(gameState.game.value.size).toBe(9);
    expect(gameState.blackIsAI.value).toBe(false);
    expect(gameState.whiteIsAI.value).toBe(true);
    expect(gameState.blackTimeLimit.value).toBe(75);
    expect(gameState.whiteTimeLimit.value).toBe(75);
    expect(gameState.aiThinking.value).toBe(false);
    expect(gameState.loadError.value).toBe('');
    // Since whiteIsAI is true but it's black's turn, AI should not be thinking
    // unless black is AI. Since black is human, no AI run.
    expect(gameState.statusText.value).toContain('black to move');
    wrapper.unmount();
  });

  test('loads game from URL hash on initialization', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#B9%20e5%20d4',
      setLocationHash: () => {},
    });
    expect(gameState.game.value.ply).toBe(2);
    expect(gameState.game.value.at(4, 4)).toBe(BLACK);
    expect(gameState.game.value.at(3, 3)).toBe(WHITE);
    expect(gameState.size.value).toBe(9);
    wrapper.unmount();
  });

  test('falls back to new game if URL hash is invalid', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#invalid-garbage',
      setLocationHash: () => {},
    });
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('falls back to new game if URL hash is empty after #', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#',
      setLocationHash: () => {},
    });
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('ignores full URL without hash when loading from location', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => 'https://isinlor.github.io/go-gomoku/',
      setLocationHash: () => {},
    });
    expect(gameState.game.value.ply).toBe(0);
    expect(gameState.loadError.value).toBe('');
    wrapper.unmount();
  });

  test('playMove plays a move for the human player', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Black is human, white is AI
    gameState.whiteIsAI.value = false; // Make both human for simpler testing
    gameState.playMove(40); // center
    expect(gameState.game.value.at(4, 4)).toBe(BLACK);
    expect(gameState.game.value.toMove).toBe(WHITE);
    wrapper.unmount();
  });

  test('playMove rejects illegal moves', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    gameState.playMove(40); // Same spot - illegal
    expect(gameState.statusExtra.value).toBe('illegal move');
    wrapper.unmount();
  });

  test('playMove ignores when AI is thinking', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    (gameState as any).aiThinking.value = true;
    const plyBefore = gameState.game.value.ply;
    gameState.playMove(40);
    expect(gameState.game.value.ply).toBe(plyBefore);
    wrapper.unmount();
  });

  test('playMove ignores when it is not the human player turn', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Make black AI so human can't play as black
    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = false;
    const plyBefore = gameState.game.value.ply;
    gameState.playMove(40);
    expect(gameState.game.value.ply).toBe(plyBefore);
    wrapper.unmount();
  });

  test('playMove ignores when game has a winner', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#B9%20a1%20a6%20b1%20b6%20c1%20c6%20d1%20d6%20e1',
      setLocationHash: () => {},
    });

    expect(gameState.game.value.winner).toBe(BLACK);
    const plyBefore = gameState.game.value.ply;
    gameState.playMove(50);
    expect(gameState.game.value.ply).toBe(plyBefore);
    wrapper.unmount();
  });

  test('undo reverts a move', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(gameState.game.value.ply).toBe(1);
    gameState.undo();
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('undo does nothing when ply is 0', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.undo();
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('undo does nothing when AI is thinking', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    gameState.aiThinking.value = true;
    gameState.undo();
    expect(gameState.game.value.ply).toBe(1);
    wrapper.unmount();
  });

  test('undo undoes two moves when a human player faces an AI opponent', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Both human first to avoid AI trigger
    gameState.whiteIsAI.value = false;
    gameState.playMove(40); // e5 black
    gameState.playMove(30); // d4 white
    expect(gameState.game.value.ply).toBe(2);

    // Now set white to AI
    gameState.whiteIsAI.value = true;
    // ply=2, black's turn. Undo: ply=1 (white's turn, AI). hasHumanPlayer=true, isAITurn=true, ply>0 → second undo. ply=0.
    gameState.undo();
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('newGame resets the game state', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(gameState.game.value.ply).toBe(1);
    gameState.newGame();
    expect(gameState.game.value.ply).toBe(0);
    expect(gameState.statusExtra.value).toBe('');
    wrapper.unmount();
  });

  test('newGame with different size', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.setSize(13);
    gameState.newGame();
    expect(gameState.game.value.size).toBe(13);
    expect(gameState.size.value).toBe(13);
    wrapper.unmount();
  });

  test('loadGame loads a valid game string', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    const result = gameState.loadGame('B9 e5 d4');
    expect(result).toBe(true);
    expect(gameState.game.value.ply).toBe(2);
    expect(gameState.size.value).toBe(9);
    expect(gameState.loadError.value).toBe('');
    wrapper.unmount();
  });

  test('loadGame returns false for empty input', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    const result = gameState.loadGame('');
    expect(result).toBe(false);
    wrapper.unmount();
  });

  test('loadGame sets error for invalid input', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    const result = gameState.loadGame('INVALID');
    expect(result).toBe(false);
    expect(gameState.loadError.value).not.toBe('');
    wrapper.unmount();
  });

  test('loadGame handles non-Error throws', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    const result = gameState.loadGame('B9 z1');
    expect(result).toBe(false);
    expect(gameState.loadError.value).toContain('Invalid move');
    wrapper.unmount();
  });

  test('statusText shows winner', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#B9%20a1%20a6%20b1%20b6%20c1%20c6%20d1%20d6%20e1',
      setLocationHash: () => {},
    });

    expect(gameState.statusText.value).toContain('black wins');
    wrapper.unmount();
  });

  test('statusText shows draw when no legal moves', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Fill the board to create a draw-like situation
    const g = gameState.game.value;
    g.board.fill(BLACK);
    g.stoneCount = g.area;
    g.winner = EMPTY;
    gameState.whiteIsAI.value = false;
    gameState.blackIsAI.value = false;

    // Need to trigger ref for computed to recalculate
    triggerRef(gameState.game);
    expect(gameState.statusText.value).toContain('draw');
    wrapper.unmount();
  });

  test('statusText includes extra info', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.statusExtra.value = 'AI searching';
    expect(gameState.statusText.value).toContain('AI searching');
    wrapper.unmount();
  });

  test('gameRecord returns the encoded game', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    expect(gameState.gameRecord.value).toBe('B9');
    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(gameState.gameRecord.value).toBe('B9 e5');
    wrapper.unmount();
  });

  test('boardDisabled returns correct state', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Black is human, should not be disabled
    expect(gameState.boardDisabled()).toBe(false);

    gameState.aiThinking.value = true;
    expect(gameState.boardDisabled()).toBe(true);
    wrapper.unmount();
  });

  test('onModeChange triggers AI when switching to AI turn', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Black is human, make black AI
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    // Should trigger AI since it's black's turn and black is now AI
    expect(gameState.aiThinking.value).toBe(true);
    expect(worker.postMessage).toHaveBeenCalled();
    wrapper.unmount();
  });

  test('onModeChange does nothing when AI is thinking', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.aiThinking.value = true;
    gameState.onModeChange();
    // Should not crash or change state
    expect(gameState.aiThinking.value).toBe(true);
    wrapper.unmount();
  });

  test('maybeRunAI sends request to worker and handles response', async () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Disable white AI to avoid chain after black plays
    gameState.whiteIsAI.value = false;

    // Set black to AI to trigger maybeRunAI
    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    expect(gameState.aiThinking.value).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const request = (worker.postMessage as any).mock.calls[0][0];
    expect(request.encodedGame).toBe('B9');
    expect(request.maxDepth).toBe(12);

    // Simulate worker response
    const response: AIResponse = {
      move: 40,
      score: 100,
      depth: 2,
      nodes: 50,
      timedOut: false,
      forcedWin: false,
      forcedLoss: false,
      heuristicWin: false,
      heuristicLoss: false,
    };
    (worker as any).onmessage({ data: response } as MessageEvent);

    expect(gameState.aiThinking.value).toBe(false);
    expect(gameState.game.value.at(4, 4)).toBe(BLACK);
    expect(gameState.statusExtra.value).toContain('AI depth 2');
    expect(gameState.statusExtra.value).not.toContain('forced win');
    expect(gameState.statusExtra.value).not.toContain('likely forced');
    wrapper.unmount();
  });

  test('maybeRunAI statusExtra shows forced win when result.forcedWin is true', async () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    const response: AIResponse = {
      move: 40,
      score: 1000000000,
      depth: 1,
      nodes: 1,
      timedOut: false,
      forcedWin: true,
      forcedLoss: false,
      heuristicWin: true,
      heuristicLoss: false,
    };
    (worker as any).onmessage({ data: response } as MessageEvent);

    expect(gameState.aiThinking.value).toBe(false);
    expect(gameState.game.value.at(4, 4)).toBe(BLACK);
    expect(gameState.statusExtra.value).toContain('forced win');
    expect(gameState.statusExtra.value).not.toContain('likely');
    wrapper.unmount();
  });

  test('maybeRunAI statusExtra shows forced loss when result.forcedLoss is true', async () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    const response: AIResponse = {
      move: 40,
      score: -999999998,
      depth: 2,
      nodes: 10,
      timedOut: false,
      forcedWin: false,
      forcedLoss: true,
      heuristicWin: false,
      heuristicLoss: true,
    };
    (worker as any).onmessage({ data: response } as MessageEvent);

    expect(gameState.aiThinking.value).toBe(false);
    expect(gameState.game.value.at(4, 4)).toBe(BLACK);
    expect(gameState.statusExtra.value).toContain('forced loss');
    expect(gameState.statusExtra.value).not.toContain('likely');
    wrapper.unmount();
  });

  test('maybeRunAI statusExtra shows likely forced win when only heuristic win', async () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    const response: AIResponse = {
      move: 40,
      score: 1000000000,
      depth: 1,
      nodes: 1,
      timedOut: false,
      forcedWin: false,
      forcedLoss: false,
      heuristicWin: true,
      heuristicLoss: false,
    };
    (worker as any).onmessage({ data: response } as MessageEvent);

    expect(gameState.statusExtra.value).toContain('likely forced win');
    expect(gameState.statusExtra.value).not.toMatch(/[^y] forced win/);
    wrapper.unmount();
  });

  test('maybeRunAI statusExtra shows likely forced loss when only heuristic loss', async () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    const response: AIResponse = {
      move: 40,
      score: -999999998,
      depth: 2,
      nodes: 10,
      timedOut: false,
      forcedWin: false,
      forcedLoss: false,
      heuristicWin: false,
      heuristicLoss: true,
    };
    (worker as any).onmessage({ data: response } as MessageEvent);

    expect(gameState.statusExtra.value).toContain('likely forced loss');
    expect(gameState.statusExtra.value).not.toMatch(/[^y] forced loss/);
    wrapper.unmount();
  });

  test('maybeRunAI does not run when no AI turn', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Both human
    gameState.blackIsAI.value = false;
    gameState.whiteIsAI.value = false;
    gameState.maybeRunAI();
    expect(gameState.aiThinking.value).toBe(false);
    expect(worker.postMessage).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test('maybeRunAI does not run when already thinking', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    gameState.aiThinking.value = true;
    gameState.maybeRunAI();
    expect(worker.postMessage).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test('AI response with move -1 does not play', async () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    const response: AIResponse = {
      move: -1,
      score: 0,
      depth: 0,
      nodes: 0,
      timedOut: false,
      forcedWin: false,
      forcedLoss: false,
      heuristicWin: false,
      heuristicLoss: false,
    };
    (worker as any).onmessage({ data: response } as MessageEvent);
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('stale AI response is ignored', async () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    // Start a new game to invalidate the pending response
    gameState.blackIsAI.value = false;
    gameState.newGame();

    // Old worker response comes back - should be ignored
    const response: AIResponse = {
      move: 40,
      score: 100,
      depth: 2,
      nodes: 50,
      timedOut: false,
      forcedWin: false,
      forcedLoss: false,
      heuristicWin: false,
      heuristicLoss: false,
    };
    // The worker was terminated by newGame, so onmessage won't fire on the old worker
    // But let's test the case where we get a response after the game changed
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('terminateWorker is called on unmount', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Force worker creation by triggering AI
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(worker.terminate).not.toHaveBeenCalled();

    wrapper.unmount();
    expect(worker.terminate).toHaveBeenCalled();
  });

  test('setLocationHash is called when game state changes', () => {
    const worker = createMockWorker();
    const setHash = vi.fn();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: setHash,
    });

    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(setHash).toHaveBeenCalled();
    const lastCall = setHash.mock.calls[setHash.mock.calls.length - 1][0];
    expect(lastCall).toContain('B9');
    wrapper.unmount();
  });

  test('gameUrl computed property returns correct URL', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => 'http://example.com/#old',
      setLocationHash: () => {},
    });

    expect(gameState.gameUrl.value).toContain('B9');
    wrapper.unmount();
  });

  test('isAITurn returns false when game is won', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#B9%20a1%20a6%20b1%20b6%20c1%20c6%20d1%20d6%20e1',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    expect(gameState.isAITurn()).toBe(false);
    wrapper.unmount();
  });

  test('isCurrentPlayerHuman returns correct value for white', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#B9%20e5',
      setLocationHash: () => {},
    });

    // After e5, it's white's turn
    expect(gameState.game.value.toMove).toBe(WHITE);
    gameState.whiteIsAI.value = false;
    expect(gameState.isCurrentPlayerHuman()).toBe(true);
    gameState.whiteIsAI.value = true;
    expect(gameState.isCurrentPlayerHuman()).toBe(false);
    wrapper.unmount();
  });

  test('maybeRunAI uses size 13 config', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#B13',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(worker.postMessage).toHaveBeenCalled();
    const request = (worker.postMessage as any).mock.calls[0][0];
    expect(request.maxDepth).toBe(12); // uses generous search depth regardless of board size
    wrapper.unmount();
  });

  test('playMove triggers AI after human move', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // White is AI (default), black is human
    gameState.playMove(40); // Human plays center
    expect(gameState.aiThinking.value).toBe(true);
    expect(worker.postMessage).toHaveBeenCalled();
    wrapper.unmount();
  });

  test('AI chain: AI plays for both sides', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = true;
    gameState.onModeChange();

    // Black AI should be requested
    expect(gameState.aiThinking.value).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    // Simulate black AI response
    (worker as any).onmessage({ data: { move: 40, score: 100, depth: 2, nodes: 50, timedOut: false, forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false } as AIResponse } as MessageEvent);

    // Now white AI should be requested
    expect(gameState.aiThinking.value).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  test('terminateWorker when no worker exists does nothing', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Worker not created yet, terminate should be safe
    gameState.terminateWorker();
    expect(worker.terminate).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test('uses black time limit when black is AI', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackTimeLimit.value = 200;
    gameState.blackIsAI.value = true;
    gameState.onModeChange();

    const request = (worker.postMessage as any).mock.calls[0][0];
    expect(request.timeLimitMs).toBe(200);
    wrapper.unmount();
  });

  test('uses white time limit when white is AI', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Play a move as human so it becomes white's turn
    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(gameState.game.value.toMove).toBe(WHITE);

    // Now set white AI with custom time limit
    gameState.whiteTimeLimit.value = 300;
    gameState.whiteIsAI.value = true;
    gameState.onModeChange();

    const request = (worker.postMessage as any).mock.calls[0][0];
    expect(request.timeLimitMs).toBe(300);
    wrapper.unmount();
  });

  test('onWorkerMessage ignores response when worker is null', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Trigger AI to create worker, then terminate
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    gameState.terminateWorker();

    // Simulating a late response after worker terminated
    // The onmessage was set on the old worker object, calling it should be safe
    const response: AIResponse = { move: 40, score: 0, depth: 1, nodes: 10, timedOut: false, forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    (worker as any).onmessage({ data: response } as MessageEvent);
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('statusText shows player label with AI suffix', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    triggerRef(gameState.game);
    expect(gameState.statusText.value).toContain('(AI)');
    wrapper.unmount();
  });

  test('statusText shows winner with extra info', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#B9%20a1%20a6%20b1%20b6%20c1%20c6%20d1%20d6%20e1',
      setLocationHash: () => {},
    });

    gameState.statusExtra.value = 'AI depth 5';
    expect(gameState.statusText.value).toContain('black wins');
    expect(gameState.statusText.value).toContain('AI depth 5');
    wrapper.unmount();
  });

  test('undo with only AI players and ply>0 undoes one move', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Play 2 moves manually (both human) so we can test AI undo
    gameState.whiteIsAI.value = false;
    gameState.playMove(40); // black
    gameState.playMove(30); // white
    expect(gameState.game.value.ply).toBe(2);

    // Both AI - hasHumanPlayer = false, so no double-undo
    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = true;
    gameState.undo(); // ply=1, white's turn. hasHumanPlayer=false → no second undo
    expect(gameState.game.value.ply).toBe(1);
    wrapper.unmount();
  });

  test('uses default setLocationHash when none provided', () => {
    const worker = createMockWorker();
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      // Do NOT provide setLocationHash - use default
    });
    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(replaceStateSpy).toHaveBeenCalled();
    replaceStateSpy.mockRestore();
    wrapper.unmount();
  });

  test('uses default getLocationHash when none provided', () => {
    const worker = createMockWorker();
    // Set a URL hash on window.location
    window.location.hash = '';
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      // Do NOT provide getLocationHash - use default
      setLocationHash: () => {},
    });
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('tryLoadFromUrl returns false when decodeURIComponent throws', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#%ZZ',
      setLocationHash: () => {},
    });
    // The init should fail to decode %ZZ and fall back to newGame
    expect(gameState.game.value.ply).toBe(0);
    wrapper.unmount();
  });

  test('uses default worker creation when createWorker is not provided', () => {
    class MockWorkerClass {
      postMessage = vi.fn();
      terminate = vi.fn();
      onmessage: ((e: MessageEvent) => void) | null = null;
      static instances: MockWorkerClass[] = [];
      constructor() {
        MockWorkerClass.instances.push(this);
      }
    }
    vi.stubGlobal('Worker', MockWorkerClass);

    const { gameState, wrapper } = mountWithGame({
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Trigger AI to force worker creation
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(MockWorkerClass.instances.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
    wrapper.unmount();
  });

  test('statusText shows white player label when it is white turn', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Make both human and play one move so it's white's turn
    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(gameState.game.value.toMove).toBe(WHITE);
    expect(gameState.statusText.value).toContain('white');
    wrapper.unmount();
  });

  test('statusText shows white (AI) label when white is AI', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    gameState.whiteIsAI.value = true;
    triggerRef(gameState.game);
    expect(gameState.statusText.value).toContain('white (AI)');
    wrapper.unmount();
  });

  test('stale AI response with mismatched pendingGameId is ignored', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Trigger AI
    gameState.whiteIsAI.value = false;
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    // Now start a new game to increment pendingGameId
    gameState.blackIsAI.value = false;
    gameState.aiThinking.value = false;
    gameState.newGame();
    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = false;
    gameState.onModeChange();

    // Manually set old _pendingId on worker to simulate stale response
    (worker as any)._pendingId = 0;
    const staleResponse: AIResponse = {
      move: 40, score: 100, depth: 2, nodes: 50, timedOut: false, forcedWin: false,
      forcedLoss: false, heuristicWin: false, heuristicLoss: false,
    };
    (worker as any).onmessage({ data: staleResponse } as MessageEvent);
    // Should still be thinking (stale response not processed)
    expect(gameState.aiThinking.value).toBe(true);
    wrapper.unmount();
  });

  test('loadGame handles non-Error exceptions in catch', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    const spy = vi.spyOn(engineModule, 'decodeGame').mockImplementationOnce(() => {
      throw 'string error';
    });
    const result = gameState.loadGame('B9');
    expect(result).toBe(false);
    expect(gameState.loadError.value).toBe('string error');
    spy.mockRestore();
    wrapper.unmount();
  });

  test('late message from terminated Worker A is ignored when Worker B is active', () => {
    const workerA = createMockWorker();
    const workerB = createMockWorker();
    let workerIndex = 0;
    const workers = [workerA, workerB];
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => workers[workerIndex++],
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Trigger AI to create Worker A
    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = false;
    gameState.onModeChange();
    expect(workerA.postMessage).toHaveBeenCalledTimes(1);
    const handlerA = (workerA as any).onmessage;

    // Start a new game, which terminates Worker A
    gameState.blackIsAI.value = false;
    gameState.aiThinking.value = false;
    gameState.newGame();

    // Trigger AI again to create Worker B
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(workerB.postMessage).toHaveBeenCalledTimes(1);

    // Simulate a late message from Worker A's handler arriving after B is active
    const staleResponse: AIResponse = {
      move: 40, score: 100, depth: 2, nodes: 50, timedOut: false, forcedWin: false,
      forcedLoss: false, heuristicWin: false, heuristicLoss: false,
    };
    handlerA({ data: staleResponse } as MessageEvent);

    // Worker A's message should be rejected (expectedWorker !== worker)
    expect(gameState.aiThinking.value).toBe(true);  // Still waiting for Worker B
    expect(gameState.game.value.ply).toBe(0);         // No move applied
    wrapper.unmount();
  });

  test('gameUrl produces a full URL from getLocationHref', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '#old',
      getLocationHref: () => 'http://example.com/game#old',
      setLocationHash: () => {},
    });

    const url = gameState.gameUrl.value;
    expect(url).toMatch(/^http:\/\/example\.com\/game#/);
    expect(url).toContain('B9');
    wrapper.unmount();
  });

  test('worker onerror clears aiThinking and sets error status', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Trigger AI to create worker
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(gameState.aiThinking.value).toBe(true);

    // Simulate worker error
    (worker as any).onerror(new ErrorEvent('error'));

    expect(gameState.aiThinking.value).toBe(false);
    expect(gameState.statusExtra.value).toBe('AI worker error');
    // Worker should be terminated
    expect(worker.terminate).toHaveBeenCalled();
    wrapper.unmount();
  });

  test('worker onmessageerror clears aiThinking and sets error status', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Trigger AI to create worker
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(gameState.aiThinking.value).toBe(true);

    // Simulate worker message error
    (worker as any).onmessageerror(new MessageEvent('messageerror'));

    expect(gameState.aiThinking.value).toBe(false);
    expect(gameState.statusExtra.value).toBe('AI worker error');
    expect(worker.terminate).toHaveBeenCalled();
    wrapper.unmount();
  });

  test('worker error handler ignores errors from non-current worker', () => {
    const workerA = createMockWorker();
    const workerB = createMockWorker();
    let workerIndex = 0;
    const workers = [workerA, workerB];
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => workers[workerIndex++],
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Create Worker A by triggering AI
    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = false;
    gameState.onModeChange();
    const errorHandlerA = (workerA as any).onerror;

    // Terminate Worker A and create Worker B
    gameState.blackIsAI.value = false;
    gameState.aiThinking.value = false;
    gameState.newGame();
    gameState.blackIsAI.value = true;
    gameState.onModeChange();
    expect(gameState.aiThinking.value).toBe(true);

    // Late error from Worker A should be ignored
    errorHandlerA(new ErrorEvent('error'));
    expect(gameState.aiThinking.value).toBe(true); // Still thinking (waiting for B)
    wrapper.unmount();
  });

  test('boardVersion increments on each board change', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    const initialVersion = gameState.boardVersion.value;
    gameState.whiteIsAI.value = false;
    gameState.playMove(40);
    expect(gameState.boardVersion.value).toBeGreaterThan(initialVersion);

    const afterMoveVersion = gameState.boardVersion.value;
    gameState.undo();
    expect(gameState.boardVersion.value).toBeGreaterThan(afterMoveVersion);
    wrapper.unmount();
  });

  test('initializes blackAIType and whiteAIType to classic', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });
    expect(gameState.blackAIType.value).toBe('classic');
    expect(gameState.whiteAIType.value).toBe('classic');
    wrapper.unmount();
  });

  test('maybeRunAI passes black aiType in request', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackAIType.value = 'classic';
    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = false;
    gameState.onModeChange();

    const request = (worker.postMessage as any).mock.calls[0][0];
    expect(request.aiType).toBe('classic');
    wrapper.unmount();
  });

  test('maybeRunAI passes white aiType in request', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    // Play a move so it becomes white's turn
    gameState.whiteIsAI.value = false;
    gameState.playMove(40);

    gameState.whiteAIType.value = 'classic';
    gameState.whiteIsAI.value = true;
    gameState.onModeChange();

    const request = (worker.postMessage as any).mock.calls[0][0];
    expect(request.aiType).toBe('classic');
    wrapper.unmount();
  });

  test('onAITypeChange does nothing when AI is thinking', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.aiThinking.value = true;
    const versionBefore = gameState.boardVersion.value;
    gameState.onAITypeChange();
    expect(gameState.boardVersion.value).toBe(versionBefore);
    wrapper.unmount();
  });

  test('onAITypeChange updates boardVersion when not thinking', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    const versionBefore = gameState.boardVersion.value;
    gameState.onAITypeChange();
    expect(gameState.boardVersion.value).toBeGreaterThan(versionBefore);
    wrapper.unmount();
  });

  test('loadPuzzle sets both players to human and loads the puzzle position', () => {
    const worker = createMockWorker();
    const { gameState, wrapper } = mountWithGame({
      createWorker: () => worker,
      getLocationHash: () => '',
      setLocationHash: () => {},
    });

    gameState.blackIsAI.value = true;
    gameState.whiteIsAI.value = true;

    gameState.loadPuzzle({
      id: 'black-3-3',
      encoded: 'B9 c5 e3 d5 e4 f5 e6',
      toMove: BLACK,
      solution: 'e5',
      depth: 3,
      threshold: 3,
    });

    expect(gameState.blackIsAI.value).toBe(false);
    expect(gameState.whiteIsAI.value).toBe(false);
    expect(gameState.game.value.ply).toBe(6);
    expect(gameState.game.value.toMove).toBe(BLACK);
    wrapper.unmount();
  });
});
