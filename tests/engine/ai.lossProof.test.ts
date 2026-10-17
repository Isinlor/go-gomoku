import { expect, test } from 'vitest';
import { BLACK, EMPTY, GogoAI, GogoPosition, WHITE, decodeGame } from '../../src/engine';

function proofAI(position: GogoPosition) {
  const ai = new GogoAI({ now: () => 0, quiescenceDepth: 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.proofMode = true;
  ai.resetSearchHeuristics(true);
  return ai;
}

// Independent full-board oracle: a loss in two plies requires a legal
// opponent winning reply after EVERY legal defense (including captures/ko).
function losesInTwo(position: GogoPosition): boolean {
  let defenses = 0;
  for (let move = 0; move < position.area; move++) {
    if (!position.play(move)) continue;
    defenses++;
    try {
      if (position.winner !== EMPTY) return false;
      let winningReply = false;
      for (let reply = 0; reply < position.area; reply++) {
        if (!position.play(reply)) continue;
        try { winningReply ||= position.winner !== EMPTY; }
        finally { position.undo(); }
      }
      if (!winningReply) return false;
    } finally { position.undo(); }
  }
  return defenses > 0;
}

const blank = Array(8).fill('.........');
const cases = [
  GogoPosition.fromAscii(['.BBBB....', ...blank], WHITE),
  GogoPosition.fromAscii(['WBBBB....', ...blank], WHITE),
  GogoPosition.fromAscii(['.BBBBW...', ...blank], WHITE),
  GogoPosition.fromAscii(['.BBBB....', 'WWWW.....', ...Array(7).fill('.........')], WHITE),
  GogoPosition.fromAscii(['......B..', '.WBBBB.B.', '......B..', ...Array(6).fill('.........')], WHITE),
  decodeGame('B9 a5 g5 b5 f6 c5 f4 d5 e5 e6 h5 e4 h6 f5'),
  decodeGame('B9 a5 g5 b5 f6 c5 f4 d5 a1 e6 h5 e4 h6 f5'),
];

test.each(cases.map((position, index) => [index, position] as const))('loss proof agrees with exhaustive two-ply legality oracle, case %s', (_index, position) => {
  const hash = position.hash;
  const board = Array.from(position.board);
  const ai = proofAI(position);
  expect(ai.proofSearchRoot(position, 2, -1) <= -1_000_000_000 + 2).toBe(losesInTwo(position));
  expect(position.hash).toBe(hash);
  expect(Array.from(position.board)).toEqual(board);
  expect(ai.lossProofMode).toBe(false);
});

test('loss proof checks distant root defenses and accepts only a complete proof', () => {
  const position = GogoPosition.fromAscii(['.BBBB....', ...blank], WHITE);
  const rootHash = position.hash;
  const play = position.play.bind(position);
  const rootMoves = new Set<number>();
  position.play = (move) => {
    if (position.hash === rootHash) rootMoves.add(move);
    return play(move);
  };
  const ai = proofAI(position);
  expect(ai.proofSearchRoot(position, 2, -1)).toBe(-1_000_000_000 + 2);
  expect(rootMoves.size).toBe(77);
  expect(rootMoves.has(position.index(8, 8))).toBe(true);
});

test('quiet setup moves never turn an unproven loss into a proof', () => {
  const position = GogoPosition.fromAscii(['..BB.....', ...blank], WHITE);
  const hash = position.hash;
  const ai = proofAI(position);
  expect(ai.proofSearchRoot(position, 4, -1)).toBeGreaterThan(-1_000_000_000 + 4);
  expect(position.hash).toBe(hash);
  expect(ai.lossProofMode).toBe(false);
});

test('loss proof restores its mode and position on deadline expiry', () => {
  const position = decodeGame('B9 e9 e8 f9');
  const hash = position.hash;
  const ai = proofAI(position);
  ai.deadline = 0;
  expect(() => ai.proofSearchRoot(position, 14, -1)).toThrow('SEARCH_TIMEOUT');
  expect(ai.lossProofMode).toBe(false);
  expect(position.hash).toBe(hash);
});

test('heuristic search avoids scoring quiet moves while an immediate threat requires a reply', () => {
  const position = GogoPosition.fromAscii(['.BBBB....', ...blank], WHITE);
  const hash = position.hash;
  const ai = proofAI(position);
  ai.proofMode = false;
  const generate = ai.generateOrderedMoves.bind(ai);
  let rootGenerations = 0;
  ai.generateOrderedMoves = (...args: any[]) => {
    if (args[0].hash === hash) rootGenerations++;
    return generate(...args);
  };
  expect(ai.search(position, 2, -1_000_000_000, 1_000_000_000, 0)).toBe(-1_000_000_000 + 2);
  expect(rootGenerations).toBe(0);
  expect(position.hash).toBe(hash);
});

test('quiescence recognizes an immediate win before generating and scoring replies', () => {
  const position = GogoPosition.fromAscii(['BBBB.....', ...blank], BLACK);
  const ai = proofAI(position);
  const generate = ai.generateOrderedMoves.bind(ai);
  let generations = 0;
  ai.generateOrderedMoves = (...args: any[]) => { generations++; return generate(...args); };
  expect(ai.quiescence(position, -1_000_000_000, 1_000_000_000, 0, 4)).toBe(1_000_000_000 - 1);
  expect(generations).toBe(0);
});

test('root discovery stops after finding a winning continuation within the searched depth', () => {
  const position = GogoPosition.fromAscii(['.BBB.....', ...blank], BLACK);
  const hash = position.hash;
  const ai = proofAI(position);
  ai.proofMode = false;
  const play = position.play.bind(position);
  let rootPlays = 0;
  position.play = (move) => { if (position.hash === hash) rootPlays++; return play(move); };
  const result = ai.searchRoot(position, 3, position.index(4, 0));
  expect(result.score).toBe(1_000_000_000 - 3);
  expect(rootPlays).toBe(1);
  expect(position.hash).toBe(hash);
});

test('an unverified heuristic winning reply cannot establish a forced loss', () => {
  const position = GogoPosition.fromAscii(['..BB.....', ...blank], WHITE);
  const hash = position.hash;
  const ai = proofAI(position);
  ai.searchDepths = (_position: GogoPosition, _depth: number, state: any) => {
    state.bestMove = position.index(8, 8);
    state.bestScore = 1_000_000_000 - 3;
    state.completedDepth = 3;
  };
  expect(ai.proofSearchRoot(position, 4, position.index(4, 0))).toBe(0);
  expect(position.hash).toBe(hash);
  expect(ai.lossProofMode).toBe(false);
  expect(ai.proofMode).toBe(true);
});

test('a stale illegal heuristic winning reply leaves a loss unproven', () => {
  const position = GogoPosition.fromAscii(['..BB.....', ...blank], WHITE);
  const hash = position.hash;
  const ai = proofAI(position);
  ai.searchDepths = (_position: GogoPosition, _depth: number, state: any) => {
    state.bestMove = position.index(2, 0);
    state.bestScore = 1_000_000_000 - 3;
    state.completedDepth = 3;
  };
  expect(ai.proofSearchRoot(position, 4, position.index(4, 0))).toBe(0);
  expect(position.hash).toBe(hash);
  expect(ai.lossProofMode).toBe(false);
});

test('loss proof reuses an independently verified opponent reply across root defenses', () => {
  const position = GogoPosition.fromAscii(['.BBBB....', ...blank], WHITE);
  const ai = proofAI(position);
  const search = ai.searchDepths.bind(ai);
  let discoveries = 0;
  ai.searchDepths = (...args: any[]) => { discoveries++; return search(...args); };
  expect(ai.proofSearchRoot(position, 2, -1)).toBe(-1_000_000_000 + 2);
  expect(discoveries).toBeLessThanOrEqual(2);
  expect(position.ply).toBe(0);
  expect(ai.lossProofMode).toBe(false);
});

test('loss verification proves legal discovery hints before repeating child discovery', () => {
  const position = GogoPosition.fromAscii(['.BBBB....', ...blank], WHITE);
  const ai = proofAI(position);
  ai.searchRoot(position, 2, -1);
  const search = ai.searchDepths.bind(ai);
  let discoveries = 0;
  ai.searchDepths = (...args: any[]) => { discoveries++; return search(...args); };
  expect(ai.proofSearchRoot(position, 2, -1)).toBe(-1_000_000_000 + 2);
  expect(discoveries).toBe(0);
  expect(position.ply).toBe(0);
});

test('a failed heuristic reply is tried only when the proof horizon permits it', () => {
  const position = GogoPosition.fromAscii(['..BB.....', ...blank], WHITE);
  const ai = proofAI(position);
  position.play(80);
  const childHash = position.hash;
  const index = Number(childHash & ((1n << 18n) - 1n));
  ai.ttHash[index] = childHash;
  ai.ttBestMove[index] = 4;
  position.undo();
  const prove = ai.proveAttackMove.bind(ai);
  const attempts: number[] = [];
  ai.proveAttackMove = (searched: GogoPosition, move: number, depth: number) => {
    if (searched.hash === childHash && move === 4) attempts.push(depth);
    return prove(searched, move, depth);
  };
  expect(ai.proofSearchRoot(position, 4, 80)).toBe(0);
  expect(attempts).toEqual([2]);
  expect(position.ply).toBe(0);
});

test('loss discovery remains available when the concrete reply prover omits a winning witness', () => {
  const position = GogoPosition.fromAscii(['.BBBB....', ...blank], WHITE);
  const ai = proofAI(position);
  const immediate = ai.findImmediateWin.bind(ai);
  ai.findImmediateWin = (searched: GogoPosition) => searched.ply === 1 ? -1 : immediate(searched);
  expect(ai.proofSearchRoot(position, 2, -1)).toBe(-1_000_000_000 + 2);
  expect(position.ply).toBe(0);
  expect(ai.lossProofMode).toBe(false);
});
