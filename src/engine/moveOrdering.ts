export function insertMoveDescending(
  moves: Int16Array,
  scores: Int32Array,
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

export function sortMovesDescending(
  moves: Int16Array,
  scores: Int32Array,
  count: number,
): void {
  for (let i = 1; i < count; i += 1) {
    const move = moves[i];
    const score = scores[i];
    let j = i;
    while (j > 0 && scores[j - 1] < score) {
      moves[j] = moves[j - 1];
      scores[j] = scores[j - 1];
      j -= 1;
    }
    moves[j] = move;
    scores[j] = score;
  }
}
