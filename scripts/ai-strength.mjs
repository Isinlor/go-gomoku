import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';

export const ITERATION_MS = 14_000; // One second of headroom below the 15s requirement.
export const MOVE_MS = 5;
const THRESHOLD = 20;
const MAX_PAIRS = 128;
const STAKES = [0.2, 0.5, 0.8];

/** Candidate pair score is the mean of two results in [-1, 1]. */
export function strengthEvidence(previous, score, stake = 0.8) {
  assert(Number.isFinite(score) && score >= -1 && score <= 1, 'Invalid pair score');
  return previous * (1 - stake * score);
}

/** Six random legal central moves cannot already contain a five-in-a-row. */
export function createOpening(engine, random = randomInt) {
  const position = engine.decodeGame('B9');
  for (let ply = 0; ply < 6; ply++) {
    const legal = [];
    for (let y = 2; y <= 6; y++) {
      for (let x = 2; x <= 6; x++) {
        const move = y * 9 + x;
        if (position.isLegal(move)) legal.push(move);
      }
    }
    assert(legal.length > 0, 'No legal opening moves');
    assert(position.play(legal[random(legal.length)]), 'Illegal opening move');
  }
  return position.encodeGame();
}

/** Own-version positions avoid passing incompatible class instances to an AI. */
export function playStrengthGame(master, candidate, opening, candidateColor) {
  const positions = [master.decodeGame(opening), candidate.decodeGame(opening)];
  const ais = [new master.GogoAI(), new candidate.GogoAI()];
  const referee = positions[0];
  // Captures can prolong a game indefinitely. A capped game is a draw.
  for (let ply = 0; ply < 120 && referee.winner === 0; ply++) {
    if (!referee.hasAnyLegalMove()) break;
    const index = referee.toMove === candidateColor ? 1 : 0;
    const { move } = ais[index].findBestMove(positions[index], MOVE_MS);
    assert(Number.isInteger(move) && referee.isLegal(move), 'AI returned an illegal move');
    for (const position of positions) {
      assert(position.play(move), 'Engine rules disagree');
    }
    assert.equal(positions[1].winner, referee.winner, 'Engine winners disagree');
  }
  if (referee.winner === 0) return 0;
  return referee.winner === candidateColor ? 1 : -1;
}

/** Only completed color-swapped pairs are reported to the supervisor. */
export function sampleStrength(master, candidate, send, random = randomInt, play = playStrengthGame) {
  // Warm both engines before scoring; randomize warmup order too.
  const engines = random(2) ? [master, candidate] : [candidate, master];
  for (const engine of engines) new engine.GogoAI().findBestMove(engine.decodeGame('B9 e5 d5'), MOVE_MS);
  let bets = STAKES.map(() => 1);
  let score = 0;
  for (let pairs = 1; pairs <= MAX_PAIRS; pairs++) {
    const opening = createOpening(master, random);
    const firstColor = random(2) + 1;
    const pairScore = (play(master, candidate, opening, firstColor)
      + play(master, candidate, opening, 3 - firstColor)) / 2;
    score += pairScore;
    bets = bets.map((value, index) => strengthEvidence(value, pairScore, STAKES[index]));
    const evidence = bets.reduce((sum, value) => sum + value, 0) / bets.length;
    send({ pairs, score, evidence });
    if (evidence >= THRESHOLD) break;
  }
}

export function startStrengthWorker(data, send, load = loadEngine) {
  sampleStrength(load(data.masterRoot), load(data.candidateRoot), send);
}

/** Kill synchronous searches at the deadline; discard any incomplete pair. */
export function runStrengthIteration(masterRoot, candidateRoot,
  createWorker = (data) => new Worker(new URL(import.meta.url), { workerData: data, execArgv: [] }),
  durationMs = ITERATION_MS) {
  return new Promise((resolve, reject) => {
    const worker = createWorker({ masterRoot, candidateRoot });
    let result = { pairs: 0, score: 0, evidence: 1 };
    let finished = false;
    const finish = async (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      await worker.terminate();
      if (error) reject(error);
      else if (result.pairs === 0) reject(new Error('No complete strength pairs within the time budget'));
      else resolve(result);
    };
    const timer = setTimeout(() => finish(), durationMs);
    worker.on('message', (message) => {
      if (finished) return;
      result = message;
      if (result.evidence >= THRESHOLD) finish();
    });
    worker.on('error', (error) => finish(error));
    worker.on('exit', (code) => finish(code === 0 ? undefined : new Error(`Strength worker exited with code ${code}`)));
  });
}

export async function benchmarkStrength(masterRoot, candidateRoot, log = console.log, run = runStrengthIteration) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await run(masterRoot, candidateRoot);
    const passed = result.evidence < THRESHOLD;
    log(`${passed ? 'PASS' : 'FAIL'} strength (attempt ${attempt}/5): ${result.pairs * 2} games, candidate ${result.pairs + result.score}/${result.pairs * 2} points, loss evidence ${result.evidence.toFixed(3)} / ${THRESHOLD}`);
    if (passed) return 0;
  }
  log('AI strength regression confirmed after five attempts.');
  return 1;
}

export async function runStrength(masterRoot, candidateRoot = process.cwd(), log = console.log) {
  try {
    assert(masterRoot, 'Usage: node scripts/ai-strength.mjs MASTER_CHECKOUT');
    return await benchmarkStrength(realpathSync(masterRoot), realpathSync(candidateRoot), log);
  } catch (error) {
    log(error.message);
    return 2;
  }
}

if (!isMainThread) {
  startStrengthWorker(workerData, (message) => parentPort.postMessage(message));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runStrength(process.argv[2]);
}
