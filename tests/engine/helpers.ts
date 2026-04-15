import { BLACK, EMPTY, GogoPosition } from '../../src/engine';
import type { Player, PositionOptions } from '../../src/engine';

export function position(rows: string[], toMove: Player = BLACK, options: PositionOptions = {}) {
  return GogoPosition.fromAscii(rows, toMove, options);
}

export function rawPosition(rows: string[], toMove: Player = BLACK, options: PositionOptions = {}) {
  const game = position(rows, toMove, options);
  game.winner = EMPTY;
  return game;
}
