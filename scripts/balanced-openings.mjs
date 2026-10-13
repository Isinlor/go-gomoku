import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';
import { seededRandom, APP_SEARCH_OPTIONS } from './strength-match.mjs';

/** Broader and longer openings allow either color to have an advantage. */
export function createBookOpening(master, random) {
  const position = master.decodeGame('B9');
  const plies = 6 + 2 * random(10);
  for (let ply = 0; ply < plies && !position.winner; ply++) {
    const legal = [];
    for (let y = 1; y < 8; y++) {
      for (let x = 1; x < 8; x++) {
        if (position.isLegal(y * 9 + x)) legal.push(y * 9 + x);
      }
    }
    // At most 24 stones occupy the 49-cell sampling region; at least one
    // central legal move remains. The rules engine checks captures/suicide.
    position.play(legal[random(legal.length)]);
  }
  return position;
}

/** Reject tactical starts, then classify with master alone at the match budget.
 * Equal self-play winners balance the book, not arbitrary future pairings.
 */
export function screenMasterOpening(master, position) {
  if (position.winner || position.toMove !== 1) return null;
  const opening = position.encodeGame();
  const ai = new master.GogoAI(APP_SEARCH_OPTIONS);
  const result = ai.findBestMove(position, 75);
  if (['forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss'].some(flag => result[flag])) return null;
  for (let ply = 0; ply < 120 && !position.winner && position.hasAnyLegalMove(); ply++) {
    const move = ply === 0 ? result.move : ai.findBestMove(position, 75).move;
    assert(position.isLegal(move), 'Master returned an illegal move');
    position.play(move);
  }
  if (!position.winner) return null;
  return { opening, masterWinner: position.winner, screenScore: result.score, screenDepth: result.depth };
}

export function sampleBookOpening(master, random) {
  return screenMasterOpening(master, createBookOpening(master, random));
}

/** Fix each color's target before generation; candidate never participates. */
export function buildBalancedBook(master,
  { perColor = 50, seed = 2026101501, maxAttempts = 1000, masterRevision = null } = {},
  report = () => {}, sample = sampleBookOpening) {
  assert(Number.isInteger(perColor) && perColor > 0, 'Invalid per-color target');
  assert(Number.isInteger(maxAttempts) && maxAttempts >= perColor * 2, 'Invalid attempt budget');
  const random = seededRandom(seed);
  const buckets = [[], []];
  let attempted = 0;
  while (buckets.some(bucket => bucket.length < perColor) && attempted < maxAttempts) {
    attempted++;
    const entry = sample(master, random);
    if (entry === null) continue;
    const bucket = buckets[entry.masterWinner - 1];
    if (bucket.length < perColor) bucket.push(entry);
    report({ attempted, black: buckets[0].length, white: buckets[1].length });
  }
  assert(buckets.every(bucket => bucket.length === perColor),
    `Incomplete book after ${attempted} attempts: Black ${buckets[0].length}/${perColor}, White ${buckets[1].length}/${perColor}`);
  return {
    master: masterRevision, seed, moveMs: 75, searchOptions: APP_SEARCH_OPTIONS,
    method: 'Random legal 6–24 ply central 7x7 openings, reject terminal and flagged tactical starts; select equal Black and White wins from master-only 75ms selfplay, without candidate evaluation.',
    attempted, black: buckets[0].length, white: buckets[1].length,
    entries: buckets.flatMap((bucket, color) => bucket.map((entry, index) => ({ ...entry, order: index * 2 + color })))
      .sort((a, b) => a.order - b.order),
  };
}

/** JSON goes to stdout; progress and operational errors go to stderr. */
export function runBookCli(args = process.argv.slice(2), load = loadEngine,
  log = console.log, report = progress => console.error(JSON.stringify(progress)), build = buildBalancedBook) {
  try {
    assert(args[0], 'Usage: node scripts/balanced-openings.mjs MASTER_CHECKOUT [PER_COLOR=50] [SEED=2026101501] [MAX_ATTEMPTS=1000]');
    const root = realpathSync(args[0]);
    const masterRevision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const book = build(load(root), {
      perColor: Number(args[1] ?? 50), seed: Number(args[2] ?? 2026101501),
      maxAttempts: Number(args[3] ?? 1000), masterRevision,
    }, report);
    log(JSON.stringify(book, null, 2));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runBookCli();
}
