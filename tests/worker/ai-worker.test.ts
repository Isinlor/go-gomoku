import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAIRequest, setupWorkerHandler, type AIRequest } from '../../src/worker/ai-worker';

describe('handleAIRequest', () => {
  test('returns the unique i1 defense immediately through the browser worker request path', () => {
    const response = handleAIRequest({
      encodedGame: 'B9 e5 f6 f4 d6 g3 e6 h2',
      timeLimitMs: 5_000,
      maxDepth: 30,
      quiescenceDepth: 4,
      maxPly: 96,
    });
    expect(response.move).toBe(8); // i1
    expect(response.depth).toBe(0);
    expect(response.nodes).toBe(0);
    expect(response.timedOut).toBe(false);
    expect(response.forcedDefensiveMove).toBe(true);
    expect(response.forcedWin).toBe(false);
    expect(response.forcedLoss).toBe(false);
  });

  test('returns a valid result for an empty board', () => {
    const request: AIRequest = {
      encodedGame: 'B9',
      timeLimitMs: 1_000,
      maxDepth: 2,
      quiescenceDepth: 2,
      maxPly: 64,
    };
    const response = handleAIRequest(request);
    expect(response.move).toBe(40); // center of 9x9
    expect(response.depth).toBeGreaterThanOrEqual(1);
    expect(response.nodes).toBeGreaterThan(0);
    expect(response.timedOut).toBe(false);
    expect(response.forcedWin).toBe(false);
    expect(response.forcedDefensiveMove).toBe(false);
  });

  test('preserves the score and proof of an immediate win', () => {
    const response = handleAIRequest({
      encodedGame: 'B9 a1 a6 b1 b6 c1 c6 d1 d6',
      timeLimitMs: 1_000,
      maxDepth: 2,
      quiescenceDepth: 0,
      maxPly: 64,
    });
    expect(response).toMatchObject({
      move: 4, // e1 completes Black's five-in-a-row.
      score: 999_999_999,
      depth: 1,
      timedOut: false,
      forcedDefensiveMove: false,
      forcedWin: true,
      forcedLoss: false,
      heuristicWin: true,
      heuristicLoss: false,
    });
    expect(response.nodes).toBeGreaterThan(0);
  });

  test('reports an exhausted search budget with a legal fallback and no proof', () => {
    const response = handleAIRequest({
      encodedGame: 'B9',
      timeLimitMs: 0,
      maxDepth: 2,
      quiescenceDepth: 2,
      maxPly: 64,
    });
    expect(response).toEqual({
      move: 40,
      score: 0,
      depth: 0,
      nodes: 0,
      timedOut: true,
      forcedDefensiveMove: false,
      forcedWin: false,
      forcedLoss: false,
      heuristicWin: false,
      heuristicLoss: false,
    });
  });

  test('returns move -1 for a terminal position', () => {
    const request: AIRequest = {
      encodedGame: 'B9 a1 a6 b1 b6 c1 c6 d1 d6 e1',
      timeLimitMs: 100,
      maxDepth: 2,
      quiescenceDepth: 2,
      maxPly: 64,
    };
    const response = handleAIRequest(request);
    expect(response).toEqual({
      move: -1,
      score: -1_000_000_000,
      depth: 0,
      nodes: 0,
      timedOut: false,
      forcedDefensiveMove: false,
      forcedWin: false,
      forcedLoss: true,
      heuristicWin: false,
      heuristicLoss: true,
    });
  });

  test('handles a position with some moves played', () => {
    const request: AIRequest = {
      encodedGame: 'B9 e5 d4',
      timeLimitMs: 50,
      maxDepth: 2,
      quiescenceDepth: 2,
      maxPly: 64,
    };
    const response = handleAIRequest(request);
    expect(response.move).not.toBe(-1);
    expect(response.depth).toBeGreaterThanOrEqual(1);
  });

  test('uses GogoAI when aiType is classic', () => {
    const request: AIRequest = {
      encodedGame: 'B9',
      timeLimitMs: 50,
      maxDepth: 2,
      quiescenceDepth: 2,
      maxPly: 64,
      aiType: 'classic',
    };
    const response = handleAIRequest(request);
    expect(response.move).toBe(40);
    expect(response.depth).toBeGreaterThanOrEqual(1);
  });
});

describe('setupWorkerHandler', () => {
  test('sets onmessage on the scope and responds to messages', () => {
    const scope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn(),
    };
    setupWorkerHandler(scope);
    expect(scope.onmessage).toBeDefined();

    const request: AIRequest = {
      encodedGame: 'B9',
      timeLimitMs: 50,
      maxDepth: 1,
      quiescenceDepth: 1,
      maxPly: 2,
    };
    scope.onmessage!({ data: request } as MessageEvent<AIRequest>);
    expect(scope.postMessage).toHaveBeenCalledTimes(1);
    const response = scope.postMessage.mock.calls[0][0];
    expect(response.move).toBe(40);
  });
});

describe('module-level worker setup', () => {
  test('sets self.onmessage when the module loads', () => {
    // The module-level setupWorkerHandler(self) call runs when this test file
    // imports the module. In happy-dom, self is window.
    // Verify that self.onmessage was set (it's set by the module load in the
    // import at the top of this file).
    expect(typeof self.onmessage).toBe('function');
  });
});
