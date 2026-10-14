import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { realpathSync } from 'node:fs';
import openings from './strength-openings.json' with { type: 'json' };
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';

export const MOVE_MS = 5;

export function parseStrengthArgs(args) {
  let masterRoot;
  let timeMs = MOVE_MS;
  let alpha = DEFAULT_ALPHA;
  let requireGain = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--time-ms') {
      timeMs = Number(args[++index]);
      assert(Number.isFinite(timeMs) && timeMs > 0, '--time-ms must be a positive finite number');
    } else if (arg === '--alpha') {
      alpha = Number(args[++index]);
      assert(Number.isFinite(alpha) && alpha > 0 && alpha < 1, '--alpha must be between 0 and 1');
    } else if (arg === '--require-gain') {
      requireGain = true;
    } else {
      assert(!arg.startsWith('-') && masterRoot === undefined, `Unexpected argument: ${arg}`);
      masterRoot = arg;
    }
  }
  return { masterRoot, timeMs, alpha, requireGain };
}
const THRESHOLD = 20;
// Correct gain claims for the five possible attempts (100 at default alpha).
const DEFAULT_ALPHA = 0.05;
const STAKES = [0.2, 0.5, 0.8];

/** Candidate pair score is the mean of two results in [-1, 1]. */
export function strengthEvidence(previous, score, stake = 0.8) {
  assert(Number.isFinite(score) && score >= -1 && score <= 1, 'Invalid pair score');
  return previous * (1 - stake * score);
}

/** Exact one-sided sign-flip test for a single, predeclared color-paired sample.
 * Do not use this fixed-sample p value for repeated looks or retry selection. */
export function fixedStrengthPValue(pairScores) {
  let distribution = new Map([[0, 1]]);
  let observed = 0;
  for (const score of pairScores) {
    assert(Number.isFinite(score) && Math.abs(score) <= 1 && Number.isInteger(score * 2), 'Invalid pair score');
    const magnitude = Math.abs(score * 2);
    observed += score * 2;
    const next = new Map();
    for (const [sum, probability] of distribution) {
      for (const sign of [-1, 1]) {
        const value = sum + sign * magnitude;
        next.set(value, (next.get(value) ?? 0) + probability / 2);
      }
    }
    distribution = next;
  }
  let probability = 0;
  for (const [sum, mass] of distribution) {
    if (sum >= observed) probability += mass;
  }
  return probability;
}

/** Search both versions together, alternating which engine goes first. */
export function evaluateOpenings(master, candidate, boards = openings.boards, timeMs = MOVE_MS) {
  const createStats = () => ({ total: boards.length, signs: { negative: 0, zero: 0, positive: 0 },
    references: { '100ms': { moves: 0, signs: 0 }, '10s': { moves: 0, signs: 0 } } });
  const result = { master: createStats(), candidate: createStats(), diagnostics: {
    'Master–candidate exact move agreement': 0,
    'Master–candidate evaluation-sign agreement': 0,
    'Candidate alone matches the 10 s move': 0,
    'Master alone matches the 10 s move': 0,
    'Both match the 10 s move': 0,
    'Neither matches the 10 s move': 0,
  } };
  for (const [index, board] of boards.entries()) {
    const engines = [['master', master], ['candidate', candidate]];
    if (index % 2) engines.reverse();
    const searches = {};
    for (const [name, engine] of engines) {
      const search = new engine.GogoAI().findBestMove(engine.decodeGame(board.encoded), timeMs);
      searches[name] = search;
      const sign = Math.sign(search.score);
      result[name].signs[sign < 0 ? 'negative' : sign > 0 ? 'positive' : 'zero']++;
      for (const [label, move, score] of [
        ['100ms', board.strongest.move, board.scores['100']],
        ['10s', board.screening.strongest.move, board.screening.score],
      ]) {
        result[name].references[label].moves += Number(search.move === move);
        result[name].references[label].signs += Number(sign === Math.sign(score));
      }
    }
    const diagnostics = result.diagnostics;
    diagnostics['Master–candidate exact move agreement'] += Number(searches.master.move === searches.candidate.move);
    diagnostics['Master–candidate evaluation-sign agreement'] += Number(Math.sign(searches.master.score) === Math.sign(searches.candidate.score));
    const masterMatches = searches.master.move === board.screening.strongest.move;
    const candidateMatches = searches.candidate.move === board.screening.strongest.move;
    const category = masterMatches
      ? (candidateMatches ? 'Both match the 10 s move' : 'Master alone matches the 10 s move')
      : (candidateMatches ? 'Candidate alone matches the 10 s move' : 'Neither matches the 10 s move');
    diagnostics[category]++;
  }
  return result;
}

/** Own-version positions avoid passing incompatible class instances to an AI. */
export function playStrengthGame(master, candidate, opening, candidateColor, timeMs = MOVE_MS) {
  const positions = [master.decodeGame(opening), candidate.decodeGame(opening)];
  const ais = [new master.GogoAI(), new candidate.GogoAI()];
  const referee = positions[0];
  // Repeating a full position (including turn and ko) ends a capture cycle.
  const seen = new Set();
  while (referee.winner === 0 && referee.ply < 100) {
    if (!referee.hasAnyLegalMove() || seen.has(referee.hash)) break;
    seen.add(referee.hash);
    const index = referee.toMove === candidateColor ? 1 : 0;
    const { move } = ais[index].findBestMove(positions[index], timeMs);
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
export function sampleStrength(master, candidate, send, random = randomInt, play = playStrengthGame, timeMs = MOVE_MS) {
  // Warm both engines before scoring; randomize warmup order too.
  const engines = random(2) ? [master, candidate] : [candidate, master];
  for (const engine of engines) new engine.GogoAI().findBestMove(engine.decodeGame('B9 e5 d5'), timeMs);
  let bets = STAKES.map(() => 1);
  let gainBets = STAKES.map(() => 1);
  let score = 0;
  const outcomes = [0, 0, 0];
  const pairScores = [];
  const shuffled = [...openings.boards];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = random(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  for (let pairs = 1; pairs <= shuffled.length; pairs++) {
    const opening = shuffled[pairs - 1].encoded;
    const firstColor = random(2) + 1;
    const first = play(master, candidate, opening, firstColor, timeMs);
    const second = play(master, candidate, opening, 3 - firstColor, timeMs);
    outcomes[first + 1]++;
    outcomes[second + 1]++;
    const pairScore = (first + second) / 2;
    score += pairScore;
    pairScores.push(pairScore);
    bets = bets.map((value, index) => strengthEvidence(value, pairScore, STAKES[index]));
    const evidence = bets.reduce((sum, value) => sum + value, 0) / bets.length;
    gainBets = gainBets.map((value, index) => strengthEvidence(value, -pairScore, STAKES[index]));
    const gainEvidence = gainBets.reduce((sum, value) => sum + value, 0) / gainBets.length;
    send({ pairs, score, evidence, gainEvidence, pairScores: pairScores.slice(), outcomes: { wins: outcomes[2], draws: outcomes[1], losses: outcomes[0] } });
  }
}

export function startStrengthWorker(data, send, load = loadEngine) {
  const master = load(data.masterRoot);
  const candidate = load(data.candidateRoot);
  const openingStats = evaluateOpenings(master, candidate, openings.boards, data.timeMs);
  sampleStrength(master, candidate, result => send({ ...result, openingStats }), randomInt, playStrengthGame, data.timeMs);
}

/** Wait for all scheduled games; operational worker failures still reject. */
export function runStrengthIteration(masterRoot, candidateRoot,
  createWorker = (data) => new Worker(new URL(import.meta.url), { workerData: data, execArgv: [] }), timeMs = MOVE_MS) {
  return new Promise((resolve, reject) => {
    const worker = createWorker({ masterRoot, candidateRoot, timeMs });
    let result = { pairs: 0, score: 0, evidence: 1 };
    let finished = false;
    const finish = async (error) => {
      if (finished) return;
      finished = true;
      await worker.terminate();
      if (error) reject(error);
      else if (result.pairs !== openings.boards.length) {
        reject(new Error(`Incomplete strength iteration: expected ${openings.boards.length} pairs, received ${result.pairs}`));
      } else resolve(result);
    };
    worker.on('message', (message) => {
      if (finished) return;
      result = message;
    });
    worker.on('error', (error) => finish(error));
    worker.on('exit', (code) => finish(code === 0 ? undefined : new Error(`Strength worker exited with code ${code}`)));
  });
}

export async function benchmarkStrength(masterRoot, candidateRoot, log = console.log, run = runStrengthIteration, timeMs = MOVE_MS, alpha = DEFAULT_ALPHA, requireGain = false) {
  const gainThreshold = 5 / alpha;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await run(masterRoot, candidateRoot, undefined, timeMs);
    const { gainEvidence = 1 } = result;
    let passed = result.evidence < THRESHOLD;
    if (requireGain) {
      assert(result.pairScores?.length === result.pairs && result.outcomes, 'Strict strength requires complete paired results');
      const winRate = result.outcomes.wins / (result.pairs * 2);
      // Union bound across the five permitted complete attempts; never inspect
      // fixed-sample significance to stop within an attempt.
      const p = Math.min(1, 5 * fixedStrengthPValue(result.pairScores));
      passed = winRate >= 0.6 && p < alpha;
      log(`Strict gain: ${(100 * winRate).toFixed(1)}% wins / 60%; corrected paired p ${p.toPrecision(6)} / ${alpha}.`);
    }
    log(`${passed ? 'PASS' : 'FAIL'} strength (attempt ${attempt}/5): ${result.pairs * 2} games, candidate ${result.pairs + result.score}/${result.pairs * 2} points, loss evidence ${result.evidence.toFixed(3)} / ${THRESHOLD}, gain evidence ${gainEvidence.toFixed(3)} / ${gainThreshold}`);
    if (result.outcomes) {
      const { wins, draws, losses } = result.outcomes;
      log(`Candidate results at ${timeMs}ms: ${wins} wins, ${draws} draws, ${losses} losses; win rate ${(100 * wins / (result.pairs * 2)).toFixed(1)}%; gain p bound ${Math.min(1, 5 / gainEvidence).toPrecision(4)}.`);
    }
    if (result.openingStats) {
      const { diagnostics, ...versions } = result.openingStats;
      for (const [name, stats] of Object.entries(versions)) {
        log(`${name} opening eval signs at ${timeMs}ms: negative ${stats.signs.negative}, zero ${stats.signs.zero}, positive ${stats.signs.positive} (${stats.total} openings)`);
        for (const [reference, matches] of Object.entries(stats.references)) {
          const percentage = count => `${count}/${stats.total} (${(100 * count / stats.total).toFixed(1)}%)`;
          log(`${name} vs ${reference}: moves ${percentage(matches.moves)}, eval signs ${percentage(matches.signs)}`);
        }
      }
      const total = result.openingStats.master.total;
      for (const [label, count] of Object.entries(diagnostics)) {
        log(`${label}: ${count}/${total} (${(100 * count / total).toFixed(1)}%)`);
      }
    }
    if (result.gainEvidence >= gainThreshold) {
      log(`Strength increase detected: gain evidence ${result.gainEvidence.toFixed(3)} / ${gainThreshold} (one-sided ${100 * alpha}% bound across up to five attempts).`);
    }
    if (passed) return 0;
  }
  log(requireGain ? 'No significant 60% win rate after five attempts.' : 'AI strength regression confirmed after five attempts.');
  return 1;
}

export async function runStrength(masterRoot, candidateRoot = process.cwd(), log = console.log, timeMs = MOVE_MS, alpha = DEFAULT_ALPHA, requireGain = false) {
  try {
    assert(masterRoot, 'Usage: node scripts/ai-strength.mjs MASTER_CHECKOUT');
    return await benchmarkStrength(realpathSync(masterRoot), realpathSync(candidateRoot), log, runStrengthIteration, timeMs, alpha, requireGain);
  } catch (error) {
    log(error.message);
    return 2;
  }
}

if (!isMainThread) {
  startStrengthWorker(workerData, (message) => parentPort.postMessage(message));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { masterRoot, timeMs, alpha, requireGain } = parseStrengthArgs(process.argv.slice(2));
    process.exitCode = await runStrength(masterRoot, process.cwd(), console.log, timeMs, alpha, requireGain);
  } catch (error) {
    console.log(error.message);
    process.exitCode = 2;
  }
}
