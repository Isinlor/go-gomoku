import { randomInt } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import openings from './strength-openings.json' with { type: 'json' };
import { loadEngine } from './puzzle-performance.mjs';
import { AI_CONFIG } from '../src/engine/aiConfig.ts';

// For healthy expected pair score >= 0, E is a nonnegative supermartingale.
// Ville's inequality and a union bound cover both comparisons, including peeking:
// total false-regression probability <= 2/22223 < 0.0001. No independence needed.
const FAILURE_EVIDENCE = 22223;
const COMPARISONS = [{ lowMs: 25, highMs: 125 }, { lowMs: 5, highMs: 25 }];

export function timeBudgetEngine(engine, timeMs) {
  return { ...engine, GogoAI: class extends engine.GogoAI {
    constructor() { super(AI_CONFIG); }
    findBestMove(position) { return super.findBestMove(position, timeMs); }
  } };
}

/** Both budgets use the same rules and separate AI instances. */
export function playTimeStrengthGame(low, high, opening, highColor, reportLoss = () => {}) {
  const position = low.decodeGame(opening);
  const engines = [low, high];
  const seen = new Set();
  while (!position.winner && position.ply < 100) {
    if (!position.hasAnyLegalMove() || seen.has(position.hash)) break;
    seen.add(position.hash);
    const ai = new engines[Number(position.toMove === highColor)].GogoAI();
    const { move } = ai.findBestMove(position);
    if (!Number.isInteger(move) || !position.isLegal(move)) throw new Error('AI returned an illegal move');
    position.play(move);
  }
  const score = position.winner === 0 ? 0 : position.winner === highColor ? 1 : -1;
  if (score === -1) reportLoss({ opening, highColor, record: position.encodeGame() });
  return score;
}

/** Independent opening draws with replacement; a color-swapped pair is one sample. */
export function sampleTimeStrength(engine, send, random = randomInt, play = playTimeStrengthGame, { lowMs, highMs } = COMPARISONS[0]) {
  const low = timeBudgetEngine(engine, lowMs);
  const high = timeBudgetEngine(engine, highMs);
  // Report each completed loss immediately, even if its pair is unfinished at
  // the deadline. Only the subsequent pair message updates statistical evidence.
  const reportLoss = loss => send({ loss });
  for (const version of [low, high]) {
    new version.GogoAI().findBestMove(version.decodeGame('B9 e5 d5'));
  }
  for (;;) {
    const opening = openings.boards[random(openings.boards.length)].encoded;
    const color = random(2) + 1;
    const first = play(low, high, opening, color, reportLoss);
    const second = play(low, high, opening, 3 - color, reportLoss);
    send({ score: (first + second) / 2 });
  }
}

/** Deadlines include worker startup. Ignore an unfinished pair at termination. */
export function superviseTimeStrength(worker, log = console.log, { lowMs, highMs } = COMPARISONS[0], signal) {
  return new Promise((resolve, reject) => {
    let evidence = 1, pairs = 0, score = 0, finished = false;
    const finish = (status, reason, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(screen);
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve({ status, reason, evidence, pairs, score });
    };
    const abort = () => finish('cancelled', 'another comparison failed');
    const screen = setTimeout(() => {
      if (!pairs) finish('error', '', new Error('No completed opening pairs'));
      else if (evidence < 1) finish('pass', '45s stop');
    }, 45_000);
    const deadline = setTimeout(() => finish('pass', '90s limit'), 90_000);
    worker.on('message', message => {
      if (message?.loss !== undefined) {
        const loss = message.loss;
        if (typeof loss?.opening !== 'string' || ![1, 2].includes(loss?.highColor) || typeof loss?.record !== 'string') {
          finish('error', '', new Error('Invalid loss record'));
          return;
        }
        log(`${highMs}ms lost game vs. ${lowMs}ms: ${JSON.stringify(loss)}`);
        return;
      }
      if (finished) return;
      const value = message?.score;
      if (!Number.isFinite(value) || ![-1, -0.5, 0, 0.5, 1].includes(value)) {
        finish('error', '', new Error('Invalid pair score'));
        return;
      }
      pairs++;
      score += value;
      evidence *= 1 - 0.8 * value;
      if (evidence >= FAILURE_EVIDENCE) finish('fail', 'regression detected');
      else if (evidence <= 0.01) finish('pass', 'early stop');
    });
    worker.on('error', error => finish('error', '', error));
    worker.on('exit', code => finish('error', '', new Error(`Strength worker exited unexpectedly: ${code}`)));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function createTimeStrengthWorker(root, budgets) {
  return new Worker(new URL(import.meta.url), { workerData: { root, budgets }, execArgv: [] });
}

export async function runTimeStrength(root = process.cwd(), log = console.log, createWorker = createTimeStrengthWorker) {
  const controller = new AbortController();
  // Run comparisons together so their 45/90-second deadlines do not add up.
  const codes = await Promise.all(COMPARISONS.map(async budgets => {
    if (controller.signal.aborted) return 0;
    const { lowMs, highMs } = budgets;
    try {
      const result = await superviseTimeStrength(createWorker(root, budgets), log, budgets, controller.signal);
      if (result.status === 'cancelled') return 0;
      log(`${result.status.toUpperCase()} ${highMs}ms vs ${lowMs}ms: ${result.pairs} opening pairs, ${highMs}ms ${result.pairs + result.score}/${2 * result.pairs} points; evidence ${result.evidence.toPrecision(6)}/${FAILURE_EVIDENCE}; ${result.reason}; config ${JSON.stringify(AI_CONFIG)}`);
      if (result.status === 'fail') controller.abort();
      return result.status === 'fail' ? 1 : 0;
    } catch (error) {
      log(`ERROR strength-across-time-budgets (${highMs}ms vs ${lowMs}ms): ${error.message}`);
      controller.abort();
      return 2;
    }
  }));
  return Math.max(...codes);
}

if (!isMainThread) {
  sampleTimeStrength(loadEngine(workerData.root), message => parentPort.postMessage(message), undefined, undefined, workerData.budgets);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runTimeStrength();
}
