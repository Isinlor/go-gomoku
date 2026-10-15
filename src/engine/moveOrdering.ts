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

/** Stably order the best `limit` moves; the unused tail is unspecified. */
export function sortMovesDescending(
  moves: Int16Array,
  scores: Float64Array | Int32Array,
  count: number,
  limit = count,
): void {
  if (limit === 0) return;
  for (let i = 1; i < count; i += 1) {
    if (i < limit || scores[i] > scores[limit - 1]) {
      insertMoveDescending(moves, scores, Math.min(i, limit - 1), moves[i], scores[i]);
    }
  }
}
