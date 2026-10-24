import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

function setup(rows = Array(9).fill('.........')) {
  const position = GogoPosition.fromAscii(rows, BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  return { position, ai };
}

const otherHalf = 1n << 32n;

test('negamax rejects a transposition with identical low bits but a different upper word', () => {
  const { position, ai } = setup();
  const expected = ai.search(position, 1, -Infinity, Infinity, 0);
  const index = Number(position.hash & 262143n);
  ai.ttHash[index] = position.hash ^ otherHalf;
  ai.ttScore[index] = 123456789;
  ai.ttDepth[index] = 127;
  ai.ttFlag[index] = 1;
  expect(ai.search(position, 1, -Infinity, Infinity, 0)).toBe(expected);
});

test('quiescence rejects a transposition with identical low bits but a different upper word', () => {
  const { position, ai } = setup();
  const expected = ai.quiescence(position, -Infinity, Infinity, 0, 0);
  const index = Number(position.hash & 4095n);
  ai.qHash[index] = position.hash ^ otherHalf;
  ai.qScore[index] = 123456789;
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 0)).toBe(expected);
});

test.each(['proofAttack', 'proofDefend'])('%s rejects a proof with a different upper hash word', method => {
  const { position, ai } = setup();
  const index = Number(position.hash & 262143n);
  ai.proofTTHash[index] = position.hash ^ otherHalf;
  ai.proofTTResult[index] = 1;
  ai.proofTTDepth[index] = 10;
  expect(ai[method](position, 2, 0)).toBe(false);
});

test('proof ordering rejects a heuristic hint from a different upper hash word', () => {
  const { position, ai } = setup(['XX.......', ...Array(8).fill('.........')]);
  const index = Number(position.hash & 262143n);
  ai.ttHash[index] = position.hash ^ otherHalf;
  ai.ttBestMove[index] = 40;
  let played = 0;
  const play = position.play.bind(position);
  position.play = (move: number) => { played++; return play(move); };
  expect(ai.proofAttack(position, 3, 0)).toBe(false);
  expect(played).toBe(0);
});

test('incremental window state distinguishes positions with matching low hash words', () => {
  const { position, ai } = setup();
  ai.beginWindowPass(position);
  position.board[0] = BLACK;
  position.hash ^= otherHalf;
  ai.beginWindowPass(position);
  expect(ai.windowCounts[0]).toBe(6);
});

test('group discovery and scoring distinguish matching low hash words', () => {
  const { position, ai } = setup(['X........', ...Array(8).fill('.........')]);
  ai.beginWindowPass(position);
  ai.primeScoredGroupInfo(position, 0, BLACK);
  const epoch = ai.scoredGroupPassEpoch;
  position.hash ^= otherHalf;
  ai.markGroupTacticalMoves(position, BLACK);
  expect(ai.scoredGroupPassEpoch).toBe(epoch + 1);
  position.hash ^= otherHalf;
  ai.primeScoredGroupInfo(position, 0, BLACK);
  expect(ai.scoredGroupPassEpoch).toBe(epoch + 2);
  expect(ai.scoredGroupLiberties[0]).toBe(2);
});
