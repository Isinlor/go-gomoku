import { type GogoPosition } from '../../src/engine';

export function snapshotPosition(position: GogoPosition) {
  return {
    board: Array.from(position.board),
    toMove: position.toMove,
    winner: position.winner,
    koPoint: position.koPoint,
    ply: position.ply,
    stoneCount: position.stoneCount,
    lastMove: position.lastMove,
    lastCapturedCount: position.lastCapturedCount,
    hash: position.hash,
  };
}

export function boardRows(position: GogoPosition): string[] {
  const symbols = ['.', 'X', 'O'] as const;
  const rows: string[] = [];
  for (let y = 0; y < position.size; y += 1) {
    let row = '';
    for (let x = 0; x < position.size; x += 1) {
      row += symbols[position.at(x, y)];
    }
    rows.push(row);
  }
  return rows;
}
