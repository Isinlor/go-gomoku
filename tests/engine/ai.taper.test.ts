import { expect, test } from 'vitest';

import { candidateCapForPly, GogoAI, GogoPosition, normalizeCandidateTaper } from '../../src/engine';

test('normalizeCandidateTaper falls back to defaults for empty or invalid taper input', () => {
  expect(normalizeCandidateTaper(undefined)).toEqual([24, 12, 8, 6, 4]);
  expect(normalizeCandidateTaper([])).toEqual([24, 12, 8, 6, 4]);
  expect(normalizeCandidateTaper([0, -2, Number.NaN])).toEqual([24, 12, 8, 6, 4]);
});

test('candidateCapForPly uses the last taper value for deep plies', () => {
  const taper = [30, 15, 8];
  expect(candidateCapForPly(0, taper)).toBe(30);
  expect(candidateCapForPly(1, taper)).toBe(15);
  expect(candidateCapForPly(2, taper)).toBe(8);
  expect(candidateCapForPly(12, taper)).toBe(8);
});

test('searchRoot applies taper cap at root in heuristic mode', () => {
  const ai = new GogoAI({ maxDepth: 1, quiescenceDepth: 0, now: () => 0, candidateTaper: [5, 5, 5] });
  const anyAI = ai as any;
  const pos = new GogoPosition(9);
  pos.playXY(4, 4);

  const candidates: number[] = [];
  for (let i = 0; i < pos.area && candidates.length < 20; i += 1) {
    if (pos.board[i] === 0) {
      candidates.push(i);
    }
  }

  anyAI.generateOrderedMoves = (_position: GogoPosition, moves: Int16Array, _scores: Int32Array) => {
    for (let i = 0; i < candidates.length; i += 1) {
      moves[i] = candidates[i];
    }
    return candidates.length;
  };
  anyAI.generateFullBoardMoves = () => 0;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = Infinity;
  anyAI.nodesVisited = 0;
  anyAI.timedOut = false;

  let playCalls = 0;
  const originalPlay = pos.play.bind(pos);
  pos.play = ((move: number) => {
    playCalls += 1;
    return originalPlay(move);
  }) as typeof pos.play;

  const result = anyAI.searchRoot(pos, 1, -1);
  expect(result.move).not.toBe(-1);
  expect(playCalls).toBe(5);
});
