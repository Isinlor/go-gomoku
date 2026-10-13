import { EMPTY, type GogoPosition, type Player } from '../../src/engine/gogomoku';

/** Complete bounded AND/OR search, deliberately without engine proof shortcuts. */
export function completeForcedWin(pos: GogoPosition, attacker: Player, remaining: number): boolean {
  if (pos.winner !== EMPTY) return pos.winner === attacker;
  if (remaining <= 0) return false;
  const attacking = pos.toMove === attacker;
  let anyLegal = false;
  // Probe every board point directly, independently of optimized move generators.
  for (let move = 0; move < pos.area; move += 1) {
    if (!pos.play(move)) continue;
    anyLegal = true;
    let won: boolean;
    try {
      won = completeForcedWin(pos, attacker, remaining - 1);
    } finally {
      pos.undo();
    }
    if (won === attacking) return won;
  }
  return anyLegal && !attacking;
}
