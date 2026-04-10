/**
 * Empirical investigation: are the near2 candidate-generation heuristic and
 * the center-bias move-ordering/evaluation heuristic actually beneficial in
 * Go Gomoku?
 *
 * We compare all four combinations of (useNear2, useCenterBias) on the
 * hand-crafted depth-3 and depth-5 puzzles.  For each configuration we record
 * whether the correct solution is found and how many nodes were searched.
 * Lower node counts indicate better search efficiency.
 *
 * Findings are asserted so that the test suite permanently documents the
 * empirical result and guards against accidental regressions.
 */
import { test, expect } from 'vitest';
import { GogoAI, decodeGame, decodeMove, PUZZLES } from '../../src/engine';

type Config = { useNear2: boolean; useCenterBias: boolean };

const configs: Config[] = [
  { useNear2: true,  useCenterBias: true  },
  { useNear2: true,  useCenterBias: false },
  { useNear2: false, useCenterBias: true  },
  { useNear2: false, useCenterBias: false },
];

function label({ useNear2, useCenterBias }: Config): string {
  return `near2=${useNear2} centerBias=${useCenterBias}`;
}

/** Solve a puzzle with the given config and return { solved, nodes }. */
function runConfig(puzzleId: string, cfg: Config, timeLimitMs: number): { solved: boolean; nodes: number } {
  const puzzle = PUZZLES.find((p) => p.id === puzzleId)!;
  const position = decodeGame(puzzle.encoded);
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, ...cfg });
  const result = ai.findBestMove(position, timeLimitMs);
  const expected = decodeMove(puzzle.solution, position.size);
  return { solved: result.move === expected, nodes: result.nodes };
}

// ---------------------------------------------------------------------------
// 1.  Correctness: every configuration must find the correct solution
// ---------------------------------------------------------------------------

test('all four heuristic configurations solve the depth-3 puzzle correctly', () => {
  for (const cfg of configs) {
    const { solved } = runConfig('black-3-3', cfg, 2_000);
    expect(solved, `${label(cfg)} failed to solve black-3-3`).toBe(true);
  }
});

test('all four heuristic configurations solve the depth-5 puzzle correctly', () => {
  for (const cfg of configs) {
    const { solved } = runConfig('black-5-3', cfg, 10_000);
    expect(solved, `${label(cfg)} failed to solve black-5-3`).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// 2.  Near2 heuristic: restricting candidates to within-2 of existing stones
//     dramatically shrinks the search tree on an open board.
//     We expect near2=true to require fewer nodes than near2=false.
// ---------------------------------------------------------------------------

test('near2=true searches fewer nodes than near2=false on the depth-3 puzzle', () => {
  const withNear2    = runConfig('black-3-3', { useNear2: true,  useCenterBias: true }, 2_000);
  const withoutNear2 = runConfig('black-3-3', { useNear2: false, useCenterBias: true }, 2_000);

  expect(withNear2.nodes, 'near2=true should search fewer nodes').toBeLessThan(withoutNear2.nodes);
});

test('near2=true searches fewer nodes than near2=false on the depth-5 puzzle', () => {
  const withNear2    = runConfig('black-5-3', { useNear2: true,  useCenterBias: true }, 10_000);
  const withoutNear2 = runConfig('black-5-3', { useNear2: false, useCenterBias: true }, 10_000);

  expect(withNear2.nodes, 'near2=true should search fewer nodes').toBeLessThan(withoutNear2.nodes);
});

// ---------------------------------------------------------------------------
// 3.  Center-bias heuristic: adding center-proximity to move ordering should
//     improve alpha-beta cutoff rates and thereby reduce nodes visited.
//     We expect useCenterBias=true to require fewer nodes than false.
// ---------------------------------------------------------------------------

test('useCenterBias=true searches no more nodes than useCenterBias=false on the depth-3 puzzle', () => {
  const withBias    = runConfig('black-3-3', { useNear2: true, useCenterBias: true  }, 2_000);
  const withoutBias = runConfig('black-3-3', { useNear2: true, useCenterBias: false }, 2_000);

  // On this shallow puzzle the center-bias tiebreaker has no effect: the
  // tactical scores already fully determine move order, so node counts are
  // identical.  The important point is that center bias never hurts.
  expect(withBias.nodes, 'useCenterBias=true should not search more nodes').toBeLessThanOrEqual(withoutBias.nodes);
});

test('useCenterBias=true searches fewer nodes than useCenterBias=false on the depth-5 puzzle', () => {
  const withBias    = runConfig('black-5-3', { useNear2: true, useCenterBias: true  }, 10_000);
  const withoutBias = runConfig('black-5-3', { useNear2: true, useCenterBias: false }, 10_000);

  expect(withBias.nodes, 'useCenterBias=true should search fewer nodes').toBeLessThan(withoutBias.nodes);
});
