import { expect, test } from 'vitest';
import {
  BLACK, EMPTY, WHITE, GogoAI, GogoPosition, decodeGame, decodeMove,
  otherPlayer, transformPoint, type Player, type SupportedSize,
} from '../../src/engine';

function snapshot(position: GogoPosition) {
  return {
    board: position.toAscii(), record: position.encodeGame(), hash: position.hash,
    toMove: position.toMove, winner: position.winner, ko: position.koPoint,
    ply: position.ply, stones: position.stoneCount,
    lastMove: position.lastMove, captured: position.lastCapturedCount,
  };
}

// Independent oracle: use only actual legal play/undo, not AI windows, candidate
// generation, evaluation, or threat detection. Ko expires through normal play.
function canWinImmediately(position: GogoPosition): boolean {
  const player = position.toMove;
  for (let move = 0; move < position.area; move += 1) {
    if (!position.play(move)) continue;
    try {
      if (position.winner === player) return true;
    } finally {
      position.undo();
    }
  }
  return false;
}

function survivingReplies(position: GogoPosition): number[] {
  const player = position.toMove;
  const replies: number[] = [];
  for (let move = 0; move < position.area; move += 1) {
    if (!position.play(move)) continue;
    try {
      if (position.winner === player || !canWinImmediately(position)) replies.push(move);
    } finally {
      position.undo();
    }
  }
  return replies;
}

function forcedDefensiveMove(ai: GogoAI, position: GogoPosition): number {
  const detector = ai as unknown as {
    ensureBuffers(area: number): void;
    findForcedDefensiveMove(position: GogoPosition): number;
  };
  detector.ensureBuffers(position.area);
  return detector.findForcedDefensiveMove(position);
}

test.each([0.999, 1, 2])('checks the 1 ms deadline after confirming i1 at %s ms', elapsed => {
  const position = decodeGame('B9 e5 f6 f4 d6 g3 e6 h2');
  const before = snapshot(position);
  let fallbackCalls = 0;
  const fallback = new GogoAI({ now: () => fallbackCalls++ === 0 ? 0 : 1 }).findBestMove(position, 1).move;
  let calls = 0;
  const ai = new GogoAI({ now: () => ++calls <= 2 ? 0 : elapsed });
  const result = ai.findBestMove(position, 1);
  const expired = elapsed >= 1;
  expect(result).toMatchObject({
    move: expired ? fallback : decodeMove('i1', 9),
    depth: 0, nodes: 0, timedOut: expired, forcedDefensiveMove: !expired,
    forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false,
  });
  expect(snapshot(position)).toEqual(before);
  // A scan timeout must not suppress confirmation when this AI is reused.
  calls = 0;
  expect(ai.findBestMove(position, 5_000)).toMatchObject({
    move: decodeMove('i1', 9), timedOut: false, forcedDefensiveMove: true,
  });
  expect(snapshot(position)).toEqual(before);
});

const directions = [
  { name: 'horizontal', dx: 1, dy: 0 },
  { name: 'vertical', dx: 0, dy: 1 },
  { name: 'diagonal down', dx: 1, dy: 1 },
  { name: 'diagonal up', dx: 1, dy: -1 },
];
const lineCases = ([9, 11, 13] as SupportedSize[]).flatMap(size =>
  ([BLACK, WHITE] as Player[]).flatMap(attacker => directions.flatMap(direction =>
    Array.from({ length: 5 }, (_, gap) => ({ size, attacker, direction, gap })),
  )),
);

test.each(lineCases)('unique reply: size=$size attacker=$attacker $direction.name gap=$gap', ({ size, attacker, direction, gap }) => {
  const board = Array.from({ length: size }, () => Array<string>(size).fill('.'));
  const originX = 2;
  const originY = direction.dy === -1 ? size - 3 : 2;
  const stone = attacker === BLACK ? 'X' : 'O';
  const blocker = attacker === BLACK ? 'O' : 'X';
  for (let step = -1; step <= 5; step += 1) {
    const x = originX + step * direction.dx;
    const y = originY + step * direction.dy;
    board[y][x] = step === -1 || step === 5 ? blocker : step === gap ? '.' : stone;
  }
  const expected = (originY + gap * direction.dy) * size + originX + gap * direction.dx;
  const position = GogoPosition.fromAscii(board.map(row => row.join('')), otherPlayer(attacker));
  const before = snapshot(position);
  expect(survivingReplies(position)).toEqual([expected]);
  expect(snapshot(position)).toEqual(before);

  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  expect(forcedDefensiveMove(ai, position)).toBe(expected);
  expect(snapshot(position)).toEqual(before);
  expect(ai.findBestMove(position, 5_000)).toMatchObject({
    move: expected, depth: 0, nodes: 0, timedOut: false, forcedDefensiveMove: true,
    forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false,
  });
  expect(snapshot(position)).toEqual(before);
});

const tacticalCases = [
  {
    name: 'capture is the only defense against an open diagonal',
    rows: ['.X.......', 'XXO......', '.OXO.....', '...X.....', '....XX...', '....X.X..', '.....X...', '.........', '.........'],
    replies: ['c4'], shortcut: 'c4',
  },
  {
    name: 'shared-stone capture stops two overlapping diagonals',
    rows: ['.........', '.........', '..X...X..', '...XOX...', '...OXO...', '...X.X...', '.........', '.........', '.........'],
    replies: ['e6'], shortcut: 'e6',
  },
  {
    name: 'both a capture and a block survive',
    rows: ['.........', 'OXO......', '.OX......', '...X.....', '....X....', '.....O...', '.........', '.........', '.........'],
    replies: ['a1', 'b1'], shortcut: null,
  },
  {
    name: 'an unrelated atari capture leaves the winning diagonal intact',
    rows: ['.........', 'OXO....X.', '.O....X..', '.....X...', '....X....', '...OOO...', '.........', '.........', '.........'],
    replies: ['i1'], shortcut: 'i1',
  },
  {
    name: 'the geometric block is illegal suicide',
    rows: ['......X..', '.OXXXX.X.', '......X..', '.........', '.........', '.........', '.........', '.........', '.........'],
    replies: [], shortcut: null,
  },
  {
    name: 'an open four has two winning endpoints and no defense',
    rows: ['.XXXX....', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'],
    replies: [], shortcut: null,
  },
  {
    name: 'blocking one independent four leaves the other winning threat',
    rows: ['.........', '.XXXXO...', '.........', '.........', '.........', '.........', '.XXXXO...', '.........', '.........'],
    replies: [], shortcut: null,
  },
  {
    name: 'an immediate counter-win must retain its proof and score',
    rows: ['.XXXX....', 'OOOO.....', '.........', '.........', '.........', '.........', '.........', '.........', '.........'],
    replies: ['e2'], shortcut: null,
  },
];
const symmetryCases = tacticalCases.flatMap(scenario =>
  ([false, true]).flatMap(swap => Array.from({ length: 8 }, (_, symmetry) => ({ scenario, swap, symmetry }))),
);

test.each(symmetryCases)('$scenario.name: color swap=$swap symmetry=$symmetry', ({ scenario, swap, symmetry }) => {
  const board = Array.from({ length: 9 }, () => Array<string>(9).fill('.'));
  for (let y = 0; y < 9; y += 1) for (let x = 0; x < 9; x += 1) {
    const [tx, ty] = transformPoint(symmetry, x, y, 9);
    const cell = scenario.rows[y][x];
    board[ty][tx] = swap && cell !== '.' ? cell === 'X' ? 'O' : 'X' : cell;
  }
  const transformedMove = (move: string): number => {
    const index = decodeMove(move, 9);
    const [x, y] = transformPoint(symmetry, index % 9, Math.floor(index / 9), 9);
    return y * 9 + x;
  };
  const position = GogoPosition.fromAscii(board.map(row => row.join('')), swap ? BLACK : WHITE);
  const before = snapshot(position);
  const expected = scenario.replies.map(transformedMove).sort((a, b) => a - b);
  expect(survivingReplies(position)).toEqual(expected);
  expect(snapshot(position)).toEqual(before);

  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  expect(forcedDefensiveMove(ai, position)).toBe(scenario.shortcut === null ? -1 : transformedMove(scenario.shortcut));
  expect(snapshot(position)).toEqual(before);
  if (scenario.shortcut !== null) {
    expect(ai.findBestMove(position, 5_000)).toMatchObject({
      move: transformedMove(scenario.shortcut), depth: 0, nodes: 0, forcedDefensiveMove: true,
      forcedWin: false, forcedLoss: false,
    });
    expect(snapshot(position)).toEqual(before);
  } else if (scenario.name === 'an immediate counter-win must retain its proof and score') {
    const result = ai.findBestMove(position, 5_000);
    expect(result.move).toBe(expected[0]);
    expect(result.depth).toBeGreaterThan(0);
    expect(result.forcedWin).toBe(true);
    expect(result.forcedDefensiveMove).toBe(false);
    expect(ai.verifyWinningMove(position, expected[0], 5_000)).toBe(true);
    expect(snapshot(position)).toEqual(before);
  }
});

test('a counter-win with zero liberties is legal, takes precedence, and is proven', () => {
  const position = GogoPosition.fromAscii([
    '.........', '.........', '.....X...', '.XXXXOX..', 'XOOOO.X..',
    '.XXXXOX..', '.....X...', '.........', '.........',
  ], WHITE);
  const before = snapshot(position);
  const win = decodeMove('f5', 9);
  expect(survivingReplies(position)).toEqual([win]);
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  expect(forcedDefensiveMove(ai, position)).toBe(-1);
  expect(ai.findBestMove(position, 5_000)).toMatchObject({ move: win, forcedWin: true, forcedDefensiveMove: false });
  expect(ai.verifyWinningMove(position, win, 5_000)).toBe(true);
  expect(snapshot(position)).toEqual(before);
  expect(position.play(win)).toBe(true);
  expect(position.winner).toBe(WHITE);
  expect(position.scanGroup(win, WHITE)).toBe(0);
  position.undo();
  expect(snapshot(position)).toEqual(before);
});

test.each([
  { name: 'ko forbids the only block', record: 'B9 a5 g5 b5 f6 c5 f4 d5 e5 e6 h5 e4 h6 f5', replies: [] },
  { name: 'changed history releases the block', record: 'B9 a5 g5 b5 f6 c5 f4 d5 a1 e6 h5 e4 h6 f5', replies: ['e5'] },
])('$name uses real ko history and restores it after detection', ({ record, replies }) => {
  const position = decodeGame(record);
  const before = snapshot(position);
  const expected = replies.map(move => decodeMove(move, 9));
  expect(survivingReplies(position)).toEqual(expected);
  expect(forcedDefensiveMove(new GogoAI(), position)).toBe(expected.length === 1 ? expected[0] : -1);
  expect(snapshot(position)).toEqual(before);
  position.undo();
  const previous = decodeGame(record.split(' ').slice(0, -1).join(' '));
  expect(snapshot(position)).toEqual(snapshot(previous));
});

test('reusing the AI after a win or timeout does not suppress a later forced defensive move', () => {
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  const winning = decodeGame('B9 a1 a6 b1 b6 c1 c6 d1 d6');
  expect(ai.findBestMove(winning, 5_000).forcedWin).toBe(true);
  const position = decodeGame('B9 e5 f6 f4 d6 g3 e6 h2');
  const before = snapshot(position);
  expect(ai.findBestMove(position, 0)).toMatchObject({ timedOut: true, forcedDefensiveMove: false });
  expect(ai.findBestMove(position, 5_000)).toMatchObject({ move: 8, depth: 0, nodes: 0, timedOut: false, forcedDefensiveMove: true });
  expect(snapshot(position)).toEqual(before);
  expect(position.winner).toBe(EMPTY);
});

test('ordinary moves, terminal positions, and a proven forced loss do not claim a forced defensive move', () => {
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  expect(ai.findBestMove(new GogoPosition(9), 5_000).forcedDefensiveMove).toBe(false);
  const terminal = decodeGame('B9 a1 a6 b1 b6 c1 c6 d1 d6 e1');
  expect(ai.findBestMove(terminal, 5_000)).toMatchObject({ move: -1, forcedDefensiveMove: false });
  const losing = GogoPosition.fromAscii([
    '.XXXX....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], WHITE);
  expect(ai.findBestMove(losing, 5_000)).toMatchObject({ forcedLoss: true, forcedDefensiveMove: false });
});
