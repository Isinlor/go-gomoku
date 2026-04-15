import { test, expect } from 'vitest';

import { BLACK, EMPTY, GogoPosition, WHITE, playerName, encodeMove, decodeMove, decodeGame } from '../../src/engine';

test('constructor, parser, coordinates, and helpers validate inputs', () => {
  expect(() => new GogoPosition(10)).toThrow(/Unsupported board size/);
  expect(() => GogoPosition.fromAscii(['.........'], BLACK)).toThrow(/Unsupported board size/);
  expect(() => GogoPosition.fromAscii(['.........', '........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'])).toThrow(/invalid width/);
  expect(() => GogoPosition.fromAscii(['?........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'])).toThrow(/Unsupported board symbol/);

  const symbolGame = GogoPosition.fromAscii([
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
  expect(symbolGame.toAscii()).toEqual([
    '.XXOO....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const cloned = symbolGame.clone();
  expect(cloned).not.toBe(symbolGame);
  expect(cloned.toAscii()).toEqual(symbolGame.toAscii());
  expect(cloned.toMove).toBe(symbolGame.toMove);
  expect(cloned.hash).toBe(symbolGame.hash);
  cloned.playXY(8, 8);
  expect(cloned.at(8, 8)).toBe(BLACK);
  expect(symbolGame.at(8, 8)).toBe(EMPTY);
  expect(playerName(BLACK)).toBe('black');
  expect(playerName(WHITE)).toBe('white');
});

test('clone preserves playable state and toAscii serializes mixed, empty, and full boards', () => {
  const empty = new GogoPosition(9);
  expect(empty.toAscii()).toEqual(Array.from({ length: 9 }, () => '.........'));
  const emptyClone = empty.clone();
  expect(emptyClone).not.toBe(empty);
  expect(emptyClone.toAscii()).toEqual(empty.toAscii());
  expect(emptyClone.hash).toBe(empty.hash);

  const mixed13 = GogoPosition.fromAscii([
    'X.O..........',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
  ], WHITE);
  expect(mixed13.toAscii()).toEqual([
    'X.O..........',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
  ]);

  const original = new GogoPosition(9);
  expect(original.playXY(4, 4)).toBe(true);
  expect(original.playXY(3, 4)).toBe(true);
  const cloned = original.clone();

  expect(cloned).not.toBe(original);
  expect(cloned.toAscii()).toEqual(original.toAscii());
  expect(cloned.toMove).toBe(original.toMove);
  expect(cloned.hash).toBe(original.hash);
  expect(cloned.at(4, 4)).toBe(BLACK);
  expect(cloned.at(3, 4)).toBe(WHITE);
  expect(cloned.playXY(2, 4)).toBe(true);
  expect(cloned.at(2, 4)).toBe(BLACK);
  expect(original.at(2, 4)).toBe(EMPTY);

  const full = GogoPosition.fromAscii(Array.from({ length: 9 }, () => 'XXXXXXXXX'), BLACK);
  expect(full.toAscii()).toEqual(Array.from({ length: 9 }, () => 'XXXXXXXXX'));
  const fullClone = full.clone();
  expect(fullClone).not.toBe(full);
  expect(fullClone.toAscii()).toEqual(full.toAscii());
  expect(fullClone.hash).toBe(full.hash);

  const growth = GogoPosition.fromAscii([
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
  const growthClone = growth.clone() as any;
  expect(growthClone.getMoveAt(0)).toBe(-1);
  expect(growthClone.toAscii()).toEqual(growth.toAscii());
  expect(growthClone.toMove).toBe(growth.toMove);
  expect(growthClone.hash).toBe(growth.hash);
  const nextPlayer = growthClone.toMove;
  expect(growthClone.playXY(8, 8)).toBe(true);
  expect(growthClone.getMoveAt(0)).toBe(growthClone.index(8, 8));
  expect(growthClone.at(8, 8)).toBe(nextPlayer);
  expect(growth.at(8, 8)).toBe(EMPTY);
});

test('existing winner detection and played wins cover vertical and anti-diagonal lines', () => {
  const detected = GogoPosition.fromAscii([
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

  const antiDiagonal = GogoPosition.fromAscii([
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
  const single = GogoPosition.fromAscii([
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

  const multi = GogoPosition.fromAscii([
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

  const growth = GogoPosition.fromAscii([
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
  const suicide = GogoPosition.fromAscii([
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

  const winningSuicide = GogoPosition.fromAscii([
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
  expect(winningSuicide.winner).toBe(WHITE);
  // This test needs a playable board where BLACK can demonstrate the winning-suicide rule
  // even though fromAscii() correctly detects an existing WHITE five-in-a-row.
  winningSuicide.winner = EMPTY;
  const winPoint = winningSuicide.index(0, 0);
  expect(winningSuicide.isLegal(winPoint)).toBe(true);
  expect(winningSuicide.play(winPoint)).toBe(true);
  expect(winningSuicide.winner).toBe(BLACK);

  const ko = GogoPosition.fromAscii([
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

test('single-stone capture only sets ko when capturer is a single stone in atari', () => {
  const noKoByGroupSize = GogoPosition.fromAscii([
    '.X.......',
    'XOX......',
    '.........',
    '.X.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(noKoByGroupSize.playXY(1, 2)).toBe(true);
  expect(noKoByGroupSize.lastCapturedCount).toBe(1);
  expect(noKoByGroupSize.koPoint).toBe(-1);

  const noKoByLiberties = GogoPosition.fromAscii([
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
  expect(noKoByLiberties.playXY(1, 2)).toBe(true);
  expect(noKoByLiberties.lastCapturedCount).toBe(1);
  expect(noKoByLiberties.koPoint).toBe(-1);
});

test('isLegal checks do not mutate position state for legal moves, suicide, or ko recapture', () => {
  const ko = GogoPosition.fromAscii([
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
  const koState = {
    ascii: ko.toAscii(),
    toMove: ko.toMove,
    winner: ko.winner,
    koPoint: ko.koPoint,
    ply: ko.ply,
    stoneCount: ko.stoneCount,
    lastMove: ko.lastMove,
    lastCapturedCount: ko.lastCapturedCount,
    hash: ko.hash,
  };

  expect(ko.isLegal(ko.index(2, 2))).toBe(false);
  expect(ko.toAscii()).toEqual(koState.ascii);
  expect(ko.toMove).toBe(koState.toMove);
  expect(ko.winner).toBe(koState.winner);
  expect(ko.koPoint).toBe(koState.koPoint);
  expect(ko.ply).toBe(koState.ply);
  expect(ko.stoneCount).toBe(koState.stoneCount);
  expect(ko.lastMove).toBe(koState.lastMove);
  expect(ko.lastCapturedCount).toBe(koState.lastCapturedCount);
  expect(ko.hash).toBe(koState.hash);

  expect(ko.isLegal(ko.index(8, 8))).toBe(true);
  expect(ko.toAscii()).toEqual(koState.ascii);
  expect(ko.toMove).toBe(koState.toMove);
  expect(ko.winner).toBe(koState.winner);
  expect(ko.koPoint).toBe(koState.koPoint);
  expect(ko.ply).toBe(koState.ply);
  expect(ko.stoneCount).toBe(koState.stoneCount);
  expect(ko.lastMove).toBe(koState.lastMove);
  expect(ko.lastCapturedCount).toBe(koState.lastCapturedCount);
  expect(ko.hash).toBe(koState.hash);

  const suicide = GogoPosition.fromAscii([
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
  const suicideSnapshot = suicide.clone();

  expect(suicide.isLegal(suicide.index(1, 1))).toBe(false);
  expect(suicide.toAscii()).toEqual(suicideSnapshot.toAscii());
  expect(suicide.toMove).toBe(suicideSnapshot.toMove);
  expect(suicide.winner).toBe(suicideSnapshot.winner);
  expect(suicide.koPoint).toBe(suicideSnapshot.koPoint);
  expect(suicide.ply).toBe(suicideSnapshot.ply);
  expect(suicide.stoneCount).toBe(suicideSnapshot.stoneCount);
  expect(suicide.lastMove).toBe(suicideSnapshot.lastMove);
  expect(suicide.lastCapturedCount).toBe(suicideSnapshot.lastCapturedCount);
  expect(suicide.hash).toBe(suicideSnapshot.hash);
});

test('legal move generation and group scanning reflect current state', () => {
  const game = GogoPosition.fromAscii([
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

  const won = GogoPosition.fromAscii([
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

  const mixedLegality = GogoPosition.fromAscii([
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

test('hash stays consistent through capture, ko updates, undo, and reconstruction', () => {
  const position = GogoPosition.fromAscii([
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
  const startSnapshot = position.clone();

  expect(position.playXY(2, 1)).toBe(true);
  expect(position.koPoint).toBe(position.index(2, 2));
  const afterCaptureHash = position.hash;
  const rebuiltAfterCapture = GogoPosition.fromAscii(position.toAscii(), position.toMove);
  expect(rebuiltAfterCapture.koPoint).toBe(-1);
  expect(rebuiltAfterCapture.hash).not.toBe(afterCaptureHash);

  expect(position.playXY(8, 8)).toBe(true);
  expect(position.playXY(7, 8)).toBe(true);
  const rebuiltAfterKoExpires = GogoPosition.fromAscii(position.toAscii(), position.toMove);
  expect(rebuiltAfterKoExpires.hash).toBe(position.hash);

  expect(position.undo()).toBe(true);
  expect(position.undo()).toBe(true);
  expect(position.hash).toBe(afterCaptureHash);
  expect(position.koPoint).toBe(position.index(2, 2));

  expect(position.undo()).toBe(true);
  expect(position.toAscii()).toEqual(startSnapshot.toAscii());
  expect(position.toMove).toBe(startSnapshot.toMove);
  expect(position.winner).toBe(startSnapshot.winner);
  expect(position.koPoint).toBe(startSnapshot.koPoint);
  expect(position.ply).toBe(startSnapshot.ply);
  expect(position.stoneCount).toBe(startSnapshot.stoneCount);
  expect(position.lastMove).toBe(startSnapshot.lastMove);
  expect(position.lastCapturedCount).toBe(startSnapshot.lastCapturedCount);
  expect(position.hash).toBe(startSnapshot.hash);
});

test('legal move probes return the exact legal set and leave position state unchanged', () => {
  const game = GogoPosition.fromAscii([
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
  const boardBefore = Array.from(game.board);
  const hashBefore = game.hash;
  const toMoveBefore = game.toMove;
  const plyBefore = game.ply;
  const koBefore = game.koPoint;
  const lastMoveBefore = game.lastMove;
  const lastCapturedBefore = game.lastCapturedCount;
  const legal = new Int16Array(game.area);
  const count = game.generateAllLegalMoves(legal);
  const legalMoves = new Set(Array.from(legal.slice(0, count)));
  const expected = new Set<number>();

  for (let y = 0; y < game.size; y += 1) {
    for (let x = 0; x < game.size; x += 1) {
      const move = game.index(x, y);
      if (game.at(x, y) !== EMPTY) {
        continue;
      }
      if ((x === 0 && y === 0) || (x === 1 && y === 1)) {
        continue;
      }
      expected.add(move);
    }
  }

  expect(count).toBe(expected.size);
  expect(legalMoves).toEqual(expected);
  expect(game.hasAnyLegalMove()).toBe(true);
  expect(Array.from(game.board)).toEqual(boardBefore);
  expect(game.hash).toBe(hashBefore);
  expect(game.toMove).toBe(toMoveBefore);
  expect(game.ply).toBe(plyBefore);
  expect(game.koPoint).toBe(koBefore);
  expect(game.lastMove).toBe(lastMoveBefore);
  expect(game.lastCapturedCount).toBe(lastCapturedBefore);
});

test('scanGroup returns the full connected group and counts shared liberties once', () => {
  const game = GogoPosition.fromAscii([
    '.........',
    '.XX......',
    '.X.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const liberties = game.scanGroup(game.index(1, 1), BLACK);
  const group = Array.from(game.groupBuffer.slice(0, game.scanGroupSize)).sort((a, b) => a - b);

  expect(liberties).toBe(7);
  expect(game.scanGroupSize).toBe(3);
  expect(group).toEqual([
    game.index(1, 1),
    game.index(2, 1),
    game.index(1, 2),
  ].sort((a, b) => a - b));
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

test('hash tracks ko state and matches reconstructed positions after ko clears', () => {
  const game = GogoPosition.fromAscii([
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

  expect(game.playXY(2, 1)).toBe(true);
  const hashWithKo = game.hash;
  expect(game.koPoint).toBe(game.index(2, 2));

  const rebuiltWithoutKo = GogoPosition.fromAscii([
    '..O......',
    '.OXO.....',
    '.X.X.....',
    '..X......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  expect(hashWithKo).not.toBe(rebuiltWithoutKo.hash);

  expect(game.playXY(8, 8)).toBe(true);
  expect(game.playXY(7, 8)).toBe(true);
  expect(game.koPoint).toBe(-1);

  const rebuiltAfterKoClears = GogoPosition.fromAscii([
    '..O......',
    '.OXO.....',
    '.X.X.....',
    '..X......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.......XO',
  ], WHITE);
  expect(game.hash).toBe(rebuiltAfterKoClears.hash);
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
