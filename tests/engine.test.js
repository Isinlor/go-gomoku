import test from 'node:test';
import assert from 'node:assert/strict';

import { BLACK, EMPTY, GogoPosition, WHITE, playerName } from '../build/src/index.js';

function position(rows, toMove = BLACK, options = {}) {
  return GogoPosition.fromAscii(rows, toMove, options);
}

function rawPosition(rows, toMove = BLACK, options = {}) {
  const game = position(rows, toMove, options);
  game.winner = EMPTY;
  return game;
}

test('constructor, parser, coordinates, and helpers validate inputs', () => {
  assert.throws(() => new GogoPosition(10), /Unsupported board size/);
  assert.throws(() => position(['.........'], BLACK), /Unsupported board size/);
  assert.throws(() => position(['.........', '........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']), /invalid width/);
  assert.throws(() => position(['?........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']), /Unsupported board symbol/);

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
  assert.equal(symbolGame.at(1, 0), BLACK);
  assert.equal(symbolGame.at(2, 0), BLACK);
  assert.equal(symbolGame.at(3, 0), WHITE);
  assert.equal(symbolGame.at(4, 0), WHITE);

  const game = new GogoPosition(9);
  assert.equal(game.index(-1, 0), -1);
  assert.equal(game.index(0, 9), -1);
  assert.equal(game.at(-1, 0), EMPTY);
  assert.equal(game.at(0, 9), EMPTY);
  assert.equal(game.playXY(-1, 0), false);
  assert.equal(game.play(-1), false);
  assert.equal(game.playXY(4, 4), true);
  assert.equal(game.playXY(4, 4), false);
  assert.equal(game.play(game.index(4, 4)), false);
  game.undo();
  assert.equal(game.undo(), false);
  assert.equal(playerName(BLACK), 'black');
  assert.equal(playerName(WHITE), 'white');
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
  assert.equal(detected.winner, BLACK);

  const vertical = new GogoPosition(9);
  assert.equal(vertical.playXY(0, 0), true);
  assert.equal(vertical.playXY(1, 0), true);
  assert.equal(vertical.playXY(0, 1), true);
  assert.equal(vertical.playXY(1, 1), true);
  assert.equal(vertical.playXY(0, 2), true);
  assert.equal(vertical.playXY(1, 2), true);
  assert.equal(vertical.playXY(0, 3), true);
  assert.equal(vertical.playXY(1, 3), true);
  assert.equal(vertical.playXY(0, 4), true);
  assert.equal(vertical.winner, BLACK);
  assert.equal(vertical.playXY(8, 8), false);
  assert.equal(vertical.hasAnyLegalMove(), false);

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
  assert.equal(antiDiagonal.playXY(4, 0), true);
  assert.equal(antiDiagonal.winner, BLACK);
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
  assert.equal(single.playXY(1, 2), true);
  assert.equal(single.lastCapturedCount, 1);
  assert.equal(single.at(1, 1), EMPTY);
  assert.equal(single.undo(), true);
  assert.equal(single.at(1, 1), WHITE);
  assert.equal(single.lastMove, -1);
  assert.equal(single.lastCapturedCount, 0);

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
  assert.equal(multi.playXY(2, 1), true);
  assert.equal(multi.lastCapturedCount, 2);
  assert.equal(multi.at(1, 1), EMPTY);
  assert.equal(multi.at(3, 1), EMPTY);

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
  assert.equal(growth.playXY(2, 2), true);
  assert.equal(growth.lastCapturedCount, 3);
  assert.equal(growth.at(1, 1), EMPTY);
  assert.equal(growth.at(2, 1), EMPTY);
  assert.equal(growth.at(1, 2), EMPTY);
  assert.equal(growth.undo(), true);
  assert.equal(growth.at(1, 1), WHITE);
  assert.equal(growth.at(2, 1), WHITE);
  assert.equal(growth.at(1, 2), WHITE);

  assert.equal(growth.playXY(8, 8), true);
  assert.equal(growth.playXY(7, 8), true);
  assert.equal(growth.undo(), true);
  assert.equal(growth.undo(), true);
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
  assert.equal(suicide.isLegal(suicidePoint), false);
  assert.equal(suicide.play(suicidePoint), false);
  assert.equal(suicide.at(1, 1), EMPTY);

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
  assert.equal(winningSuicide.isLegal(winPoint), true);
  assert.equal(winningSuicide.play(winPoint), true);
  assert.equal(winningSuicide.winner, BLACK);

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
  assert.equal(ko.playXY(2, 1), true);
  assert.equal(ko.lastCapturedCount, 1);
  assert.equal(ko.koPoint, ko.index(2, 2));
  assert.equal(ko.isLegal(ko.index(2, 2)), false);
  assert.equal(ko.play(ko.index(2, 2)), false);
  assert.equal(ko.playXY(8, 8), true);
  assert.equal(ko.playXY(7, 8), true);
  assert.equal(ko.isLegal(ko.index(2, 2)), true);
  assert.equal(ko.playXY(2, 2), true);
  assert.equal(ko.at(2, 1), EMPTY);
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
  assert.equal(game.hasAnyLegalMove(), true);
  const legal = new Int16Array(game.area);
  const count = game.generateAllLegalMoves(legal);
  assert.ok(count > 0);
  assert.ok(legal.includes(game.index(2, 2)));
  assert.equal(game.scanGroup(game.index(1, 1), WHITE), 4);
  assert.equal(game.scanGroupSize, 2);

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
  assert.equal(won.generateAllLegalMoves(new Int16Array(won.area)), 0);

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
  assert.equal(mixedLegality.hasAnyLegalMove(), true);
  assert.ok(!Array.from(new Int16Array(mixedLegality.area).fill(-1)).includes(999));

  const noLegal = new GogoPosition(9);
  noLegal.board.fill(BLACK);
  noLegal.stoneCount = noLegal.area;
  noLegal.winner = EMPTY;
  assert.equal(noLegal.hasAnyLegalMove(), false);
});

test('white-box internals cover helper branches that are otherwise hard to trigger', () => {
  const game = new GogoPosition(9, { historyCapacity: 1, captureCapacity: 1 });
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
  assert.ok(game.historyMoves.length >= 4);
  assert.ok(game.capturePositions.length >= 4);

  game.board[0] = BLACK;
  game.board[1] = WHITE;
  game.stoneCount = 1;
  game.capturePositions[0] = 1;
  game.captureTop = 1;
  game.rollbackIllegalMove(0, WHITE, 0, 1);
  assert.equal(game.board[0], EMPTY);
  assert.equal(game.board[1], WHITE);
  assert.equal(game.captureTop, 0);
  assert.equal(game.stoneCount, 1);

  game.board.fill(EMPTY);
  game.stoneCount = 0;
  game.board[game.index(0, 0)] = BLACK;
  game.board[game.index(1, 1)] = BLACK;
  game.board[game.index(2, 2)] = BLACK;
  game.board[game.index(3, 3)] = BLACK;
  assert.equal(game.checkFiveFrom(game.index(3, 3), BLACK), false);
  game.board[game.index(4, 4)] = BLACK;
  assert.equal(game.checkFiveFrom(game.index(4, 4), BLACK), true);
});
