import { expect, test } from 'vitest';
import { BLACK, EMPTY, WHITE, GogoAI, GogoPosition, otherPlayer, type Player } from '../../src/engine';

// . . . X . .       The gap block has one liberty, directly below it.
// . X X . X .       Capturing it makes a suicide-protected winning threat.
const stones = [[4, 3], [2, 4], [3, 4], [5, 4]];
const symmetries = Array.from({ length: 8 }, (_, symmetry) => (x: number, y: number): [number, number] => {
  if (symmetry >= 4) x = 8 - x;
  for (let turn = 0; turn < symmetry % 4; turn++) [x, y] = [8 - y, x];
  return [x, y];
});

function setup(player: Player, transform = symmetries[0], placedStones = stones, toMove = otherPlayer(player)) {
  const rows = Array.from({ length: 9 }, () => Array(9).fill('.'));
  for (const [x, y] of placedStones) {
    const [tx, ty] = transform(x, y);
    rows[ty][tx] = player === BLACK ? 'X' : 'O';
  }
  const position = GogoPosition.fromAscii(rows.map(row => row.join('')), toMove);
  const point = (x: number, y: number) => position.index(...transform(x, y));
  return { position, point };
}

for (const player of [BLACK, WHITE] as const) {
  test.each(symmetries.map((transform, index) => ({ transform, index })))(
    `the edge replaces the support stone, attacker ${player}, symmetry $index`,
    { tags: ['slow'] },
    ({ transform }) => {
      const edgeStones = [[2, 8], [3, 8], [5, 8]];
      const { position } = setup(player, transform, edgeStones);
      const before = position.encodeGame();
      const result = new GogoAI({ maxDepth: 6, now: () => 0 }).findBestMove(position, 1000);
      expect(result.forcedLoss).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(position.encodeGame()).toBe(before);
    },
  );

  test.each([[[2, 8], [3, 8]], [[2, 8], [5, 8]], [[3, 8], [5, 8]]])(
    `two-stone edge precursor has a proved winning move (${player}, %j)`,
    { tags: ['slow'] },
    (first, second) => {
      const { position, point } = setup(player, symmetries[0], [first, second], player);
      const before = position.encodeGame();
      const result = new GogoAI({ maxDepth: 7, now: () => 0 }).findBestMove(position, 1000);
      expect(result.forcedWin).toBe(true);
      // Horizon mates can now reach exact verification before depth seven.
      expect(result.depth).toBeLessThanOrEqual(7);
      expect(result.move).toBe(point(4, 8));
      const prover = new GogoAI({ now: () => 0 }) as any;
      prover.lossProofMode = true;
      expect(prover.verifyWinningMove(position, result.move, 1000, 7)).toBe(true);
      expect(position.encodeGame()).toBe(before);
    },
  );

  test.each([0, 1, 2, 3])(`three-stone precursor has a proved winning completion (${player}, omitted stone %s)`, { tags: ['slow'] }, omitted => {
    const { position: precursor, point } = setup(player, symmetries[0], stones.filter((_, index) => index !== omitted), player);
    const before = precursor.encodeGame();
    const completion = point(stones[omitted][0], stones[omitted][1]);
    const prover = new GogoAI({ now: () => 0 }) as any;
    // Require full-board defenses in the witness, rather than nearby-only
    // discovery. A failed bounded search would not establish a refutation.
    prover.lossProofMode = true;
    expect(prover.verifyWinningMove(precursor, completion, 1000, 7)).toBe(true);
    expect(prover.verifiedWinDepth).toBe(7);
    expect(precursor.encodeGame()).toBe(before);

    const result = new GogoAI({ maxDepth: 7, now: () => 0 }).findBestMove(precursor, 1000);
    expect(result.forcedWin).toBe(true);
    // Quiescence exposes the immediate fork during the first root iteration.
    expect(result.depth).toBe(omitted === 0 ? 1 : 7);
    // Without the support, filling the row's gap wins faster than adding it.
    expect(result.move).toBe(omitted === 0 ? point(4, 4) : completion);
    expect(precursor.encodeGame()).toBe(before);
  });

  test.each(symmetries.map((transform, index) => ({ transform, index })))(
    `capture-backed broken three is proved lost for the defender, attacker ${player}, symmetry $index`,
    { tags: ['slow'] },
    ({ transform }) => {
      const { position } = setup(player, transform);
      const before = position.encodeGame();
      // Loss verification checks every legal defense, including distant moves.
      const result = new GogoAI({ maxDepth: 6, now: () => 0 }).findBestMove(position, 1000);
      expect(result.forcedLoss).toBe(true);
      expect(result.forcedWin).toBe(false);
      expect(position.isLegal(result.move)).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(position.encodeGame()).toBe(before);
    },
  );

  test(`after the gap block is captured, every legal reply loses in at most two attacking moves (${player})`, { tags: ['slow'] }, () => {
    const { position, point } = setup(player);
    const gap = point(4, 4);
    expect(position.play(gap)).toBe(true);
    expect(position.scanGroup(gap, otherPlayer(player))).toBe(1);
    expect(position.play(point(4, 5))).toBe(true);
    expect(position.lastCapturedCount).toBe(1);
    expect(position.board[gap]).toBe(EMPTY);
    expect(position.isLegal(gap)).toBe(false); // Defender cannot replay by suicide.
    const before = position.encodeGame();
    const replies = new Int16Array(position.area);
    const count = position.generateAllLegalMoves(replies);
    expect(count).toBeGreaterThan(70);
    for (const reply of replies.slice(0, count)) {
      expect(position.play(reply)).toBe(true);
      const attack = reply === point(1, 4) ? point(6, 4)
        : reply === point(6, 4) ? point(1, 4) : gap;
      expect(position.play(attack)).toBe(true);
      const defenses = new Int16Array(position.area);
      const defenseCount = position.generateAllLegalMoves(defenses);
      for (const defense of defenses.slice(0, defenseCount)) {
        expect(position.play(defense)).toBe(true);
        // With an endpoint blocked, the only winning point is suicide for the
        // defender. Otherwise the open four has two winning endpoints.
        const winningPoint = attack === gap
          ? (defense === point(1, 4) ? point(6, 4) : point(1, 4)) : gap;
        expect(position.play(winningPoint)).toBe(true);
        expect(position.winner).toBe(player);
        position.undo();
        position.undo();
      }
      position.undo();
      position.undo();
    }
    expect(position.encodeGame()).toBe(before);
  });
}

test('the apparent gap block can capture an atari support stone, breaking the local argument', () => {
  const position = GogoPosition.fromAscii([
    '.........', '.........', '....O....', '...OXO...', '..XX.X...',
    '.........', '.........', '.........', '.........',
  ], WHITE);
  expect(position.playXY(4, 4)).toBe(true);
  expect(position.lastCapturedCount).toBe(1);
  expect(position.at(4, 3)).toBe(EMPTY);
  expect(position.playXY(4, 5)).toBe(true);
  expect(position.lastCapturedCount).toBe(0);
  expect(position.at(4, 4)).toBe(WHITE);
  expect(position.playXY(4, 3)).toBe(true);
  expect(position.at(4, 4)).toBe(WHITE);
});

test('an immediate counter-win takes precedence over the capture-backed three', () => {
  const position = GogoPosition.fromAscii([
    'OOOO.....', '.........', '.........', '....X....', '..XX.X...',
    '.........', '.........', '.........', '.........',
  ], WHITE);
  const result = new GogoAI({ maxDepth: 6, now: () => 0 }).findBestMove(position, 1000);
  expect(result.forcedWin).toBe(true);
  expect(result.forcedLoss).toBe(false);
  expect(position.play(result.move)).toBe(true);
  expect(position.winner).toBe(WHITE);
});
