import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';

export const PAIRS = 24;
export const ATTEMPTS = 5;
export const MAX_PLIES = 64;
const WORK_BUDGET = 12;

/** Each color-swapped pair is ONE observation; ties carry no evidence. */
export function comparePairs(outcomes) {
  let wins = 0, losses = 0, ties = 0;
  for (const outcome of outcomes) {
    assert([-1, 0, 1].includes(outcome), 'Invalid pair outcome');
    if (outcome === 1) wins++;
    else if (outcome === -1) losses++;
    else ties++;
  }
  const n = wins + losses;
  let coefficient = 1, tail = 0;
  for (let k = 0; k <= n; k++) {
    if (k >= losses) tail += coefficient;
    coefficient = coefficient * (n - k) / (k + 1);
  }
  const p = tail / 2 ** n;
  return { wins, losses, ties, p, passed: p > 0.05 };
}

export function seededRandom(seed) {
  assert(Number.isInteger(seed) && seed > 0 && seed <= 0xffffffff, 'Seed must be a nonzero uint32');
  let state = seed;
  return (limit) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % limit;
  };
}

/** Legal clustered openings, independent of either AI's move preferences. */
export function makeOpening(engine, random, size) {
  const position = engine.decodeGame(`B${size}`);
  const center = Math.floor(size / 2);
  const moves = [];
  for (let y = center - 2; y <= center + 2; y++) {
    for (let x = center - 2; x <= center + 2; x++) moves.push(y * size + x);
  }
  const plies = 4 + random(9);
  for (let ply = 0; ply < plies; ply++) {
    const legal = moves.filter(move => position.isLegal(move));
    assert(legal.length > 0, 'No legal opening moves');
    const move = legal[random(legal.length)];
    assert(position.play(move), 'Illegal opening move');
    // Exclude already won openings; retain the valid prefix.
    if (position.winner !== 0) { position.undo(); break; }
  }
  return position.encodeGame();
}

/** Use master rules as referee and a deterministic search-check budget. */
export function playGame(master, candidate, opening, candidateColor, check) {
  const position = master.decodeGame(opening);
  let ticks = 0;
  const now = () => { check(); return ++ticks; };
  const options = { maxDepth: 3, quiescenceDepth: 2, now };
  const ais = [null, new (candidateColor === 1 ? candidate : master).GogoAI(options),
    new (candidateColor === 2 ? candidate : master).GogoAI(options)];
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    check();
    ticks = 0;
    const result = ais[position.toMove].findBestMove(position, WORK_BUDGET);
    if (result.move === -1) {
      assert(!position.hasAnyLegalMove(), 'AI returned no move in a playable position');
      return 0;
    }
    assert(position.play(result.move), 'AI returned an illegal move');
    if (position.winner !== 0) return position.winner === candidateColor ? 1 : -1;
  }
  return 0; // Move-cap draws are never adjudicated by either AI's evaluation.
}

export function benchmarkStrength(master, candidate, seed, log, check, play = playGame) {
  const random = seededRandom(seed);
  log(`AI strength seed: ${seed}`);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const outcomes = [];
    for (let pair = 0; pair < PAIRS; pair++) {
      check();
      const size = [9, 9, 11, 13][pair % 4];
      const opening = makeOpening(master, random, size);
      const firstColor = 1 + random(2);
      const first = play(master, candidate, opening, firstColor, check);
      const second = play(master, candidate, opening, 3 - firstColor, check);
      const outcome = Math.sign(first + second);
      outcomes.push(outcome);
      log(`attempt ${attempt} pair ${pair + 1}: ${opening}; candidate color ${firstColor} first; scores ${first}, ${second}`);
    }
    const result = comparePairs(outcomes);
    log(`${result.passed ? 'PASS' : 'FAIL'} attempt ${attempt}/${ATTEMPTS}: ${result.wins} won, ${result.losses} lost, ${result.ties} tied pairs; p=${result.p.toFixed(6)}`);
    if (result.passed) return 0;
    if (attempt < ATTEMPTS) log('Possible strength regression; repeating with fresh openings.');
  }
  log('Strength regression confirmed after five attempts.');
  return 1;
}

export function runStrength(masterRoot, candidateRoot = process.cwd(), seed = randomInt(1, 0x100000000), log = console.log, clock = () => performance.now()) {
  const start = clock();
  const check = () => assert(clock() - start < 13_000, 'Strength test exceeded its 13s runtime budget (inconclusive)');
  try {
    assert(masterRoot, 'Usage: node scripts/ai-strength.mjs MASTER_CHECKOUT [SEED]');
    const master = loadEngine(realpathSync(masterRoot));
    const candidate = loadEngine(realpathSync(candidateRoot));
    const status = benchmarkStrength(master, candidate, seed, log, check);
    log(`Total strength test time: ${(clock() - start).toFixed(0)} ms`);
    return status;
  } catch (error) {
    log(error.message);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runStrength(process.argv[2], process.cwd(),
    process.argv[3] === undefined ? undefined : Number(process.argv[3]));
}
