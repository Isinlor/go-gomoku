/**
 * Stable insertion keeps parallel move/score buffers aligned without allocation.
 * Strict comparison preserves ties, including fractional scores and infinities.
 */
export function insertMoveDescending(
  moves: Int16Array,
  scores: Float64Array | Int32Array,
  count: number,
  move: number,
  score: number,
): void {
  let index = count;
  while (index > 0 && score > scores[index - 1]) {
    moves[index] = moves[index - 1];
    scores[index] = scores[index - 1];
    index -= 1;
  }
  moves[index] = move;
  scores[index] = score;
}

/** Sort only the populated prefix, preserving the order of equal scores. */
export function sortMovesDescending(
  moves: Int16Array,
  scores: Float64Array | Int32Array,
  count: number,
): void {
  for (let i = 1; i < count; i += 1) {
    insertMoveDescending(moves, scores, i, moves[i], scores[i]);
  }
}
