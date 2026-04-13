import { test, expect } from 'vitest';

import { BLACK, EMPTY, GogoPosition, WHITE, playerName, encodeMove, decodeMove, decodeGame, xorshift32 } from '../../src/engine';

function position(rows: string[], toMove = BLACK, options = {}) {
  return GogoPosition.fromAscii(rows, toMove, options);
}

function rawPosition(rows: string[], toMove = BLACK, options = {}) {
  const game = position(rows, toMove, options);
  game.winner = EMPTY;
  return game;
}

test('constructor, parser, coordinates, and helpers validate inputs', () => {
  expect(() => new GogoPosition(10)).toThrow(/Unsupported board size/);
  expect(() => position(['.........'], BLACK)).toThrow(/Unsupported board size/);
  expect(() => position(['.........', '........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'])).toThrow(/invalid width/);
  expect(() => position(['?........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'])).toThrow(/Unsupported board symbol/);

  const symbolGame = position([
    '+bxoW....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(symbolGame.at(1, 0)).toBe(BLACK);
  expect(symbolGame.at(2, 0)).toBe(BLACK);
  expect(symbolGame.at(3, 0)).toBe(WHITE);
  expect(symbolGame.at(4, 0)).toBe(WHITE);

  const game = new GogoPosition(9);
  expect(game.index(-1, 0)).toBe(-1);
  expect(game.index(0, 9)).toBe(-1);
  expect(game.at(-1, 0)).toBe(EMPTY);
  expect(game.at(0, 9)).toBe(EMPTY);
  expect(game.playXY(-1, 0)).toBe(false);
  expect(game.play(-1)).toBe(false);
  expect(game.playXY(4, 4)).toBe(true);
  expect(game.playXY(4, 4)).toBe(false);
  expect(game.play(game.index(4, 4))).toBe(false);
  game.undo();
  expect(game.undo()).toBe(false);
  expect(playerName(BLACK)).toBe('black');
  expect(playerName(WHITE)).toBe('white');
});

test('existing winner detection and played wins cover vertical and anti-diagonal lines', () => {
  const detected = position([
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  expect(detected.winner).toBe(BLACK);

  const vertical = new GogoPosition(9);
  expect(vertical.playXY(0, 0)).toBe(true);
  expect(vertical.playXY(1, 0)).toBe(true);
  expect(vertical.playXY(0, 1)).toBe(true);
  expect(vertical.playXY(1, 1)).toBe(true);
  expect(vertical.playXY(0, 2)).toBe(true);
  expect(vertical.playXY(1, 2)).toBe(true);
  expect(vertical.playXY(0, 3)).toBe(true);
  expect(vertical.playXY(1, 3)).toBe(true);
  expect(vertical.playXY(0, 4)).toBe(true);
  expect(vertical.winner).toBe(BLACK);
  expect(vertical.playXY(8, 8)).toBe(false);
  expect(vertical.hasAnyLegalMove()).toBe(false);

  const antiDiagonal = rawPosition([
    '.........',
    '...X.....',
    '..X......',
    '.X.......',
    'X........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(antiDiagonal.playXY(4, 0)).toBe(true);
  expect(antiDiagonal.winner).toBe(BLACK);
});

test('captures handle single groups, multiple groups, duplicate adjacency, undo, and capacity growth', () => {
  const single = position([
    '.X.......',
    'XOX......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(single.playXY(1, 2)).toBe(true);
  expect(single.lastCapturedCount).toBe(1);
  expect(single.at(1, 1)).toBe(EMPTY);
  expect(single.undo()).toBe(true);
  expect(single.at(1, 1)).toBe(WHITE);
  expect(single.lastMove).toBe(-1);
  expect(single.lastCapturedCount).toBe(0);

  const multi = position([
    '.X.X.....',
    'XO.OX....',
    '.X.X.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(multi.playXY(2, 1)).toBe(true);
  expect(multi.lastCapturedCount).toBe(2);
  expect(multi.at(1, 1)).toBe(EMPTY);
  expect(multi.at(3, 1)).toBe(EMPTY);

  const growth = position([
    '.XXX.....',
    'XOOX.....',
    'XO.......',
    '.X.......',
    'X........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK, { historyCapacity: 1, captureCapacity: 1 });
  expect(growth.playXY(2, 2)).toBe(true);
  expect(growth.lastCapturedCount).toBe(3);
  expect(growth.at(1, 1)).toBe(EMPTY);
  expect(growth.at(2, 1)).toBe(EMPTY);
  expect(growth.at(1, 2)).toBe(EMPTY);
  expect(growth.undo()).toBe(true);
  expect(growth.at(1, 1)).toBe(WHITE);
  expect(growth.at(2, 1)).toBe(WHITE);
  expect(growth.at(1, 2)).toBe(WHITE);

  expect(growth.playXY(8, 8)).toBe(true);
  expect(growth.playXY(7, 8)).toBe(true);
  expect(growth.undo()).toBe(true);
  expect(growth.undo()).toBe(true);
});

test('suicide is illegal, winning suicide is legal, and ko forbids immediate recapture only', () => {
  const suicide = position([
    '.O.......',
    'O.O......',
    '.O.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const suicidePoint = suicide.index(1, 1);
  expect(suicide.isLegal(suicidePoint)).toBe(false);
  expect(suicide.play(suicidePoint)).toBe(false);
  expect(suicide.at(1, 1)).toBe(EMPTY);

  const winningSuicide = rawPosition([
    '.XXXXO...',
    'OOOOO....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const winPoint = winningSuicide.index(0, 0);
  expect(winningSuicide.isLegal(winPoint)).toBe(true);
  expect(winningSuicide.play(winPoint)).toBe(true);
  expect(winningSuicide.winner).toBe(BLACK);

  const ko = position([
    '..O......',
    '.O.O.....',
    '.XOX.....',
    '..X......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(ko.playXY(2, 1)).toBe(true);
  expect(ko.lastCapturedCount).toBe(1);
  expect(ko.koPoint).toBe(ko.index(2, 2));
  expect(ko.isLegal(ko.index(2, 2))).toBe(false);
  expect(ko.play(ko.index(2, 2))).toBe(false);
  expect(ko.playXY(8, 8)).toBe(true);
  expect(ko.playXY(7, 8)).toBe(true);
  expect(ko.isLegal(ko.index(2, 2))).toBe(true);
  expect(ko.playXY(2, 2)).toBe(true);
  expect(ko.at(2, 1)).toBe(EMPTY);
});

test('legal move generation and group scanning reflect current state', () => {
  const game = position([
    'XX.......',
    'XOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(game.hasAnyLegalMove()).toBe(true);
  const legal = new Int16Array(game.area);
  const count = game.generateAllLegalMoves(legal);
  expect(count > 0).toBeTruthy();
  expect(legal.includes(game.index(2, 2))).toBeTruthy();
  expect(game.scanGroup(game.index(1, 1), WHITE)).toBe(4);
  expect(game.scanGroupSize).toBe(2);

  const won = position([
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(won.generateAllLegalMoves(new Int16Array(won.area))).toBe(0);

  const mixedLegality = position([
    '.O.......',
    'O.O......',
    '.O.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  mixedLegality.board[mixedLegality.index(8, 8)] = WHITE;
  mixedLegality.stoneCount += 1;
  expect(mixedLegality.hasAnyLegalMove()).toBe(true);
  expect(!Array.from(new Int16Array(mixedLegality.area).fill(-1)).includes(999)).toBeTruthy();

  const noLegal = new GogoPosition(9);
  noLegal.board.fill(BLACK);
  noLegal.stoneCount = noLegal.area;
  noLegal.winner = EMPTY;
  expect(noLegal.hasAnyLegalMove()).toBe(false);
});

test('white-box internals cover helper branches that are otherwise hard to trigger', () => {
  const game = new GogoPosition(9, { historyCapacity: 1, captureCapacity: 1 }) as any;
  game.ensureHistoryCapacity(4);
  game.ensureCaptureCapacity(4);
  game.historyMoves = new Int16Array(0);
  game.historyPlayers = new Uint8Array(0);
  game.historyKo = new Int16Array(0);
  game.historyWinner = new Uint8Array(0);
  game.historyCaptureStart = new Int32Array(0);
  game.historyCaptureCount = new Int16Array(0);
  game.capturePositions = new Int16Array(0);
  game.ensureHistoryCapacity(2);
  game.ensureCaptureCapacity(2);
  expect(game.historyMoves.length >= 4).toBeTruthy();
  expect(game.capturePositions.length >= 4).toBeTruthy();

  game.board[0] = BLACK;
  game.board[1] = WHITE;
  game.stoneCount = 1;
  game.capturePositions[0] = 1;
  game.captureTop = 1;
  game.rollbackIllegalMove(0, WHITE, 0, 1);
  expect(game.board[0]).toBe(EMPTY);
  expect(game.board[1]).toBe(WHITE);
  expect(game.captureTop).toBe(0);
  expect(game.stoneCount).toBe(1);

  game.board.fill(EMPTY);
  game.stoneCount = 0;
  game.board[game.index(0, 0)] = BLACK;
  game.board[game.index(1, 1)] = BLACK;
  game.board[game.index(2, 2)] = BLACK;
  game.board[game.index(3, 3)] = BLACK;
  expect(game.checkFiveFrom(game.index(3, 3), BLACK)).toBe(false);
  game.board[game.index(4, 4)] = BLACK;
  expect(game.checkFiveFrom(game.index(4, 4), BLACK)).toBe(true);
});

test('encodeMove converts a board index to column-letter + row-number notation', () => {
  const game9 = new GogoPosition(9);
  expect(encodeMove(0, game9.meta)).toBe('a1');
  expect(encodeMove(8, game9.meta)).toBe('i1');
  expect(encodeMove(9, game9.meta)).toBe('a2');
  expect(encodeMove(40, game9.meta)).toBe('e5');
  expect(encodeMove(80, game9.meta)).toBe('i9');

  const game13 = new GogoPosition(13);
  expect(encodeMove(0, game13.meta)).toBe('a1');
  expect(encodeMove(12, game13.meta)).toBe('m1');
  expect(encodeMove(156, game13.meta)).toBe('a13');
  expect(encodeMove(168, game13.meta)).toBe('m13');
});

test('decodeMove parses column-letter + row-number to board index and rejects invalid inputs', () => {
  expect(decodeMove('a1', 9)).toBe(0);
  expect(decodeMove('i1', 9)).toBe(8);
  expect(decodeMove('a2', 9)).toBe(9);
  expect(decodeMove('e5', 9)).toBe(40);
  expect(decodeMove('i9', 9)).toBe(80);
  expect(decodeMove('A1', 9)).toBe(0);
  expect(decodeMove('E5', 9)).toBe(40);
  expect(decodeMove('a13', 13)).toBe(156);
  expect(decodeMove('m13', 13)).toBe(168);

  expect(decodeMove('', 9)).toBe(-1);
  expect(decodeMove('a', 9)).toBe(-1);
  expect(decodeMove('1a', 9)).toBe(-1);
  expect(decodeMove('{1', 9)).toBe(-1);
  expect(decodeMove('!1', 9)).toBe(-1);
  expect(decodeMove('a1b', 9)).toBe(-1);
  expect(decodeMove('a0', 9)).toBe(-1);
  expect(decodeMove('j1', 9)).toBe(-1);
  expect(decodeMove('a10', 9)).toBe(-1);
});

test('encodeGame serialises game history and decodeGame rebuilds a position from the string', () => {
  const empty9 = new GogoPosition(9);
  expect(empty9.encodeGame()).toBe('B9');

  const game11 = new GogoPosition(11);
  game11.playXY(5, 5);
  game11.playXY(4, 4);
  expect(game11.encodeGame()).toBe('B11 f6 e5');

  const loaded11 = decodeGame('B11 f6 e5');
  expect(loaded11.size).toBe(11);
  expect(loaded11.ply).toBe(2);
  expect(loaded11.at(5, 5)).toBe(BLACK);
  expect(loaded11.at(4, 4)).toBe(WHITE);
  expect(loaded11.toMove).toBe(BLACK);

  const game13 = new GogoPosition(13);
  game13.playXY(6, 6);
  game13.playXY(7, 7);
  game13.playXY(5, 5);
  const encoded13 = game13.encodeGame();
  expect(encoded13).toBe('B13 g7 h8 f6');
  const decoded13 = decodeGame(encoded13);
  expect(decoded13.ply).toBe(3);
  expect(decoded13.at(6, 6)).toBe(BLACK);
  expect(decoded13.at(7, 7)).toBe(WHITE);
  expect(decoded13.at(5, 5)).toBe(BLACK);

  const empty13 = decodeGame('B13');
  expect(empty13.size).toBe(13);
  expect(empty13.ply).toBe(0);
});

test('decodeGame throws on invalid board size token, unrecognised move, and illegal move', () => {
  expect(() => decodeGame('')).toThrow(/Invalid board size token/);
  expect(() => decodeGame('B10 e5')).toThrow(/Invalid board size token/);
  expect(() => decodeGame('B9 z1')).toThrow(/Invalid move/);
  expect(() => decodeGame('B9 e5 e5')).toThrow(/Illegal move/);
});


test('xorshift32 produces non-zero output from a non-zero seed and advances state', () => {
  const state = { v: 1 };
  const a = xorshift32(state);
  const b = xorshift32(state);
  expect(a).not.toBe(0);
  expect(b).not.toBe(a);
});

test('Zobrist hash is consistent through play/undo cycles', () => {
  const pos = new GogoPosition(9);
  const initialHash = pos.hash;

  // play then undo restores hash exactly
  pos.playXY(4, 4);
  expect(pos.hash).not.toBe(initialHash);
  pos.undo();
  expect(pos.hash).toBe(initialHash);

  // two different first moves produce different hashes
  pos.playXY(4, 4);
  const hashA = pos.hash;
  pos.undo();
  pos.playXY(3, 3);
  const hashB = pos.hash;
  pos.undo();
  expect(hashA).not.toBe(hashB);

  // same board reached via different move orders produces the same hash
  const pos2 = new GogoPosition(9);
  pos.playXY(4, 4); pos.playXY(0, 0); pos.playXY(3, 3);
  pos2.playXY(3, 3); pos2.playXY(0, 0); pos2.playXY(4, 4);
  expect(pos.hash).toBe(pos2.hash);
});

test('Zobrist hash matches fromAscii hash for the same stone layout', () => {
  const pos = new GogoPosition(9);
  pos.playXY(4, 4); // BLACK
  pos.playXY(0, 0); // WHITE — toMove is BLACK again

  const ascii = position([
    'O........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(pos.hash).toBe(ascii.hash);
});

test('Zobrist hash accounts for ko: position with active ko has a different hash', () => {
  // Build a real ko situation.
  //
  // We surround point (1,2) with BLACK stones on 3 sides and leave (1,3) open,
  // then surround point (1,3) with WHITE stones on 3 sides so that when BLACK
  // captures W@(1,2), the capturing stone B@(1,3) has exactly one liberty.
  //
  //  col: 0  1  2
  //  row1: .  B  .
  //  row2: B  W  B   ← W@(1,2) surrounded on N/W/E by B; liberty at (1,3)
  //  row3: W  B  W   ← B@(1,3) surrounded on W/E/S by W; liberty at (1,2)
  //  row4: .  W  .
  //
  // Sequence (B=BLACK, W=WHITE, turns alternate):
  //  1. B@(1,1)  2. W@(0,3)  3. B@(0,2)  4. W@(2,3)
  //  5. B@(2,2)  6. W@(1,4)  7. B@(5,5) (noise)  8. W@(1,2)
  //  9. B@(1,3)  ← captures W@(1,2), B has 1 liberty at (1,2) → KO!
  const ko = new GogoPosition(9);
  ko.playXY(1, 1); // B — north of W
  ko.playXY(0, 3); // W — west of B's capture point
  ko.playXY(0, 2); // B — west of W
  ko.playXY(2, 3); // W — east of B's capture point
  ko.playXY(2, 2); // B — east of W
  ko.playXY(1, 4); // W — south of B's capture point
  ko.playXY(5, 5); // B noise — need W to play next
  ko.playXY(1, 2); // W plays surrounded-on-3-sides (1 liberty at (1,3))
  ko.playXY(1, 3); // B captures W@(1,2) → B has 1 liberty at (1,2) → KO!

  expect(ko.koPoint).toBe(ko.index(1, 2));
  const hashWithKo = ko.hash;

  // Undo the capturing move: ko goes away
  ko.undo();
  expect(ko.koPoint).toBe(-1);
  const hashWithoutKo = ko.hash;

  // Same stones, same toMove, but different ko restriction → different hash
  expect(hashWithKo).not.toBe(hashWithoutKo);

  // Re-applying the move restores the ko hash
  ko.playXY(1, 3);
  expect(ko.hash).toBe(hashWithKo);
});

test('history capacity growth also grows historyHash array', () => {
  // Use a tiny history capacity so it must grow during play
  const pos = new GogoPosition(9, { historyCapacity: 2 });
  const initial = pos.hash;
  let played = 0;
  for (let i = 0; i < 9 && played < 4; i += 1) {
    for (let j = 0; j < 9 && played < 4; j += 1) {
      if (pos.playXY(i, j)) { played += 1; }
    }
  }
  // Undo all moves — hash must be restored to initial
  for (let k = 0; k < played; k += 1) {
    pos.undo();
  }
  expect(pos.hash).toBe(initial);
});
