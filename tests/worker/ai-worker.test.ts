import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAIRequest, setupWorkerHandler, type AIRequest } from '../../src/worker/ai-worker';

describe('handleAIRequest', () => {
  test('returns a valid result for an empty board', () => {
    const request: AIRequest = {
      encodedGame: 'B9',
      timeLimitMs: 100,
      maxDepth: 2,
      quiescenceDepth: 2,
      maxPly: 64,
    };
    const response = handleAIRequest(request);
    expect(response.move).toBe(40); // center of 9x9
    expect(response.depth).toBeGreaterThanOrEqual(1);
    expect(typeof response.score).toBe('number');
    expect(typeof response.nodes).toBe('number');
    expect(typeof response.timedOut).toBe('boolean');
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
    expect(response.move).toBe(-1);
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
