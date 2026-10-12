import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';

export const ATTEMPTS = 5;
export const MAX_PLIES = 256;
export const MOVE_TIME_MS = 2;
export const SAMPLE_TIME_MS = 12_000;
const PAIR_TIMEOUT = new Error('PAIR_TIMEOUT');
const BETS = [0.05, 0.1, 0.2, 0.4, 0.6, 0.8];

/** Mixture of nonnegative betting martingales: valid at ANY stopping time. */
export function comparePairs(outcomes) {
  let wins = 0, losses = 0, ties = 0, logEvidence = 0;
  const logWealth = BETS.map(() => 0);
  for (const score of outcomes) {
    assert([-1, -0.5, 0, 0.5, 1].includes(score), 'Invalid pair outcome');
    if (score > 0) wins++;
    else if (score < 0) losses++;
    else ties++;
    for (let index = 0; index < BETS.length; index++) {
      logWealth[index] += Math.log1p(-BETS[index] * score);
    }
    const max = Math.max(...logWealth);
    const mixture = max + Math.log(logWealth.reduce((sum, value) => sum + Math.exp(value - max), 0) / BETS.length);
    logEvidence = Math.max(logEvidence, mixture);
  }
  return { wins, losses, ties, evidence: Math.exp(logEvidence), passed: logEvidence < Math.log(20) };
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
  const originX = random(size - 4);
  const originY = random(size - 4);
  const moves = [];
  for (let y = originY; y <= originY + 4; y++) {
    for (let x = originX; x <= originX + 4; x++) moves.push(y * size + x);
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

/** Use master rules as referee and the same fixed wall time per move. */
export function playGame(master, candidate, opening, candidateColor, check) {
  const position = master.decodeGame(opening);
  const options = { maxDepth: 64, quiescenceDepth: 6 };
  const ais = [null, new (candidateColor === 1 ? candidate : master).GogoAI(options),
    new (candidateColor === 2 ? candidate : master).GogoAI(options)];
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    check();
    const result = ais[position.toMove].findBestMove(position, MOVE_TIME_MS);
    if (result.move === -1) {
      assert(!position.hasAnyLegalMove(), 'AI returned no move in a playable position');
      return 0;
    }
    assert(position.play(result.move), 'AI returned an illegal move');
    if (position.winner !== 0) return position.winner === candidateColor ? 1 : -1;
  }
  return 0; // Move-cap draws are never adjudicated by either AI's evaluation.
}

/** Sample until the wall-time deadline, scoring only complete color-swapped pairs. */
export function benchmarkStrength(master, candidate, seed, log, clock = () => performance.now(), play = playGame, deadline = clock() + SAMPLE_TIME_MS) {
  const random = seededRandom(seed);
  const outcomes = [];
  const check = () => { if (clock() >= deadline + 500) throw PAIR_TIMEOUT; };
  log(`AI strength seed: ${seed}`);
  while (clock() < deadline) {
    const pair = outcomes.length;
    const size = [9, 11, 13][pair % 3];
    const opening = makeOpening(master, random, size);
    const firstColor = 1 + random(2);
    try {
      const first = play(master, candidate, opening, firstColor, check);
      const second = play(master, candidate, opening, 3 - firstColor, check);
      outcomes.push((first + second) / 2);
      log(`pair ${pair + 1}: ${opening}; candidate color ${firstColor} first; scores ${first}, ${second}`);
    } catch (error) {
      if (error !== PAIR_TIMEOUT) throw error;
      log('Sampling deadline reached; discarding unfinished pair.');
      break;
    }
  }
  assert(outcomes.length > 0, 'No complete game pairs within runtime budget (inconclusive)');
  const result = comparePairs(outcomes);
  log(`${result.passed ? 'PASS' : 'FAIL'}: ${outcomes.length} pairs, ${result.wins} won, ${result.losses} lost, ${result.ties} tied; peak evidence=${result.evidence.toPrecision(6)} (fail at 20)`);
  return result.passed ? 0 : 1;
}

export function runStrength(masterRoot, candidateRoot = process.cwd(), seed = randomInt(1, 0x100000000), log = console.log, clock = () => performance.now()) {
  const start = clock();
  try {
    assert(masterRoot, 'Usage: node scripts/ai-strength.mjs MASTER_CHECKOUT [SEED]');
    const master = loadEngine(realpathSync(masterRoot));
    const candidate = loadEngine(realpathSync(candidateRoot));
    const status = benchmarkStrength(master, candidate, seed, log, clock, playGame, start + SAMPLE_TIME_MS);
    log(`Strength attempt time: ${(clock() - start).toFixed(0)} ms`);
    return status;
  } catch (error) {
    log(error.message);
    return 2;
  }
}

/** Each complete attempt, including Node startup, gets its own hard timeout. */
export function runStrengthChecks(masterRoot, candidateRoot = process.cwd(), seed = randomInt(1, 0x100000000), log = console.log, run = spawnSync) {
  try {
    assert(masterRoot, 'Usage: node scripts/ai-strength.mjs MASTER_CHECKOUT [SEED]');
    const random = seededRandom(seed);
    log(`AI strength replay seed: ${seed}`);
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const attemptSeed = attempt === 1 ? seed : 1 + random(0xffffffff);
      log(`Strength attempt ${attempt}/${ATTEMPTS}`);
      const result = run(process.execPath, [fileURLToPath(import.meta.url), masterRoot, String(attemptSeed), '--attempt'],
        { cwd: candidateRoot, encoding: 'utf8', timeout: 14_000, killSignal: 'SIGKILL' });
      if (result.stdout) log(result.stdout.trim());
      if (result.stderr) log(result.stderr.trim());
      if (result.error || result.signal || result.status === null) {
        log('Strength attempt failed or exceeded its process budget (inconclusive).');
        return 2;
      }
      if (result.status === 0) return 0;
      if (result.status !== 1) return 2;
      if (attempt < ATTEMPTS) log('Possible strength regression; repeating with fresh openings.');
    }
    log('Strength regression confirmed after five attempts.');
    return 1;
  } catch (error) {
    log(error.message);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = process.argv[4] === '--attempt' ? runStrength : runStrengthChecks;
  process.exitCode = run(process.argv[2], process.cwd(),
    process.argv[3] === undefined ? undefined : Number(process.argv[3]));
}
