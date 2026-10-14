import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { realpathSync } from 'node:fs';
import openings from './strength-openings.json' with { type: 'json' };
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';

export const MOVE_MS = 5;
const THRESHOLD = 20;
// Five possible attempts: a 100 threshold bounds any gain claim at 5% overall.
const GAIN_THRESHOLD = 100;
const STAKES = [0.2, 0.5, 0.8];

/** Candidate pair score is the mean of two results in [-1, 1]. */
export function strengthEvidence(previous, score, stake = 0.8) {
  assert(Number.isFinite(score) && score >= -1 && score <= 1, 'Invalid pair score');
  return previous * (1 - stake * score);
}

/** Search both versions together, alternating which engine goes first. */
export function evaluateOpenings(master, candidate, boards = openings.boards) {
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
      const search = new engine.GogoAI().findBestMove(engine.decodeGame(board.encoded), MOVE_MS);
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
export function playStrengthGame(master, candidate, opening, candidateColor) {
  const positions = [master.decodeGame(opening), candidate.decodeGame(opening)];
  const ais = [new master.GogoAI(), new candidate.GogoAI()];
  const referee = positions[0];
  // Repeating a full position (including turn and ko) ends a capture cycle.
  const seen = new Set();
  while (referee.winner === 0) {
    if (!referee.hasAnyLegalMove() || seen.has(referee.hash)) break;
    seen.add(referee.hash);
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
  let gainBets = STAKES.map(() => 1);
  let score = 0;
  const shuffled = [...openings.boards];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = random(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  for (let pairs = 1; pairs <= shuffled.length; pairs++) {
    const opening = shuffled[pairs - 1].encoded;
    const firstColor = random(2) + 1;
    const pairScore = (play(master, candidate, opening, firstColor)
      + play(master, candidate, opening, 3 - firstColor)) / 2;
    score += pairScore;
    bets = bets.map((value, index) => strengthEvidence(value, pairScore, STAKES[index]));
    const evidence = bets.reduce((sum, value) => sum + value, 0) / bets.length;
    gainBets = gainBets.map((value, index) => strengthEvidence(value, -pairScore, STAKES[index]));
    const gainEvidence = gainBets.reduce((sum, value) => sum + value, 0) / gainBets.length;
    send({ pairs, score, evidence, gainEvidence });
  }
}

export function startStrengthWorker(data, send, load = loadEngine) {
  const master = load(data.masterRoot);
  const candidate = load(data.candidateRoot);
  const openingStats = evaluateOpenings(master, candidate);
  sampleStrength(master, candidate, result => send({ ...result, openingStats }));
}

/** Wait for all scheduled games; operational worker failures still reject. */
export function runStrengthIteration(masterRoot, candidateRoot,
  createWorker = (data) => new Worker(new URL(import.meta.url), { workerData: data, execArgv: [] })) {
  return new Promise((resolve, reject) => {
    const worker = createWorker({ masterRoot, candidateRoot });
    let result = { pairs: 0, score: 0, evidence: 1 };
    let finished = false;
    const finish = async (error) => {
      if (finished) return;
      finished = true;
      await worker.terminate();
      if (error) reject(error);
      else if (result.pairs === 0) reject(new Error('No complete strength pairs'));
      else resolve(result);
    };
    worker.on('message', (message) => {
      if (finished) return;
      result = message;
    });
    worker.on('error', (error) => finish(error));
    worker.on('exit', (code) => finish(code === 0 ? undefined : new Error(`Strength worker exited with code ${code}`)));
  });
}

export async function benchmarkStrength(masterRoot, candidateRoot, log = console.log, run = runStrengthIteration) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await run(masterRoot, candidateRoot);
    const { gainEvidence = 1 } = result;
    const passed = result.evidence < THRESHOLD;
    log(`${passed ? 'PASS' : 'FAIL'} strength (attempt ${attempt}/5): ${result.pairs * 2} games, candidate ${result.pairs + result.score}/${result.pairs * 2} points, loss evidence ${result.evidence.toFixed(3)} / ${THRESHOLD}, gain evidence ${gainEvidence.toFixed(3)} / ${GAIN_THRESHOLD}`);
    if (result.openingStats) {
      const { diagnostics, ...versions } = result.openingStats;
      for (const [name, stats] of Object.entries(versions)) {
        log(`${name} opening eval signs at ${MOVE_MS}ms: negative ${stats.signs.negative}, zero ${stats.signs.zero}, positive ${stats.signs.positive} (${stats.total} openings)`);
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
    if (result.gainEvidence >= GAIN_THRESHOLD) {
      log(`Strength increase detected: gain evidence ${result.gainEvidence.toFixed(3)} / ${GAIN_THRESHOLD} (one-sided 5% bound across up to five attempts).`);
    }
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
