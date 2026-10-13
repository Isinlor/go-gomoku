import assert from 'node:assert/strict';
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createOpening, playStrengthGame } from './ai-strength.mjs';
import { loadEngine } from './puzzle-performance.mjs';

export const APP_SEARCH_OPTIONS = { maxDepth: 30, quiescenceDepth: 4, maxPly: 96 };

/** A specified nonzero uint32 seed makes the opening suite reproducible. */
export function seededRandom(seed) {
  assert(Number.isInteger(seed) && seed > 0 && seed < 2 ** 32, 'Invalid seed');
  return (bound) => {
    assert(Number.isInteger(bound) && bound > 0, 'Invalid random bound');
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % bound;
  };
}

/** Exact paired sign-flip test: swap version labels independently per opening.
 * Keep the two color-swapped games together to avoid assuming independence.
 * Draws count against the requested raw win rate, and as half a score point.
 */
export function pairedStatistics(pairs) {
  assert(pairs.length > 0, 'Expected completed pairs');
  let wins = 0, losses = 0, draws = 0, observed = 0;
  let distribution = new Map([[0, 1]]);
  for (const pair of pairs) {
    assert(pair.length === 2 && pair.every(value => [-1, 0, 1].includes(value)), 'Invalid game pair');
    for (const value of pair) {
      if (value === 1) wins++;
      else if (value === -1) losses++;
      else draws++;
    }
    const sum = pair[0] + pair[1];
    observed += sum;
    const next = new Map();
    for (const [score, probability] of distribution) {
      for (const sign of [-1, 1]) {
        const value = score + sign * sum;
        next.set(value, (next.get(value) ?? 0) + probability / 2);
      }
    }
    distribution = next;
  }
  let pValue = 0;
  for (const [score, probability] of distribution) {
    if (Math.abs(score) >= Math.abs(observed)) pValue += probability;
  }
  const games = pairs.length * 2;
  const winRate = wins / games;
  return { games, wins, losses, draws, winRate, scoreRate: (wins + draws / 2) / games,
    pValue, passed: winRate >= 0.7 && pValue < 0.01 };
}

/** Complete the fixed sample even when interim results look significant. */
export function runMatch(master, candidate, { pairs = 100, seed = 20261013, openings } = {},
  report = () => {}, play = playStrengthGame) {
  assert(Number.isInteger(pairs) && pairs > 0, 'Invalid number of pairs');
  assert(openings === undefined || openings.length === pairs, 'Opening book must match the fixed sample');
  const random = seededRandom(seed);
  const results = [];
  for (let i = 0; i < pairs; i++) {
    const opening = openings === undefined ? createOpening(master, random) : openings[i];
    const firstColor = random(2) + 1;
    const games = [firstColor, 3 - firstColor].map(candidateColor => {
      const seen = new Set();
      const signals = [];
      const score = play(master, candidate, opening, candidateColor, 75, (index, position, result, elapsedMs) => {
        const flags = ['forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss'].filter(flag => {
          const key = `${index}:${flag}`;
          if (!result[flag] || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (flags.length === 0) return;
        signals.push({ engine: index === 0 ? 'master' : 'candidate', flags,
          encoded: position.encodeGame(), elapsedMs, result });
      }, APP_SEARCH_OPTIONS);
      return { candidateColor, score, signals };
    });
    const scores = games.map(game => game.score);
    results.push({ opening, firstColor, scores, games });
    report({ pairs: i + 1, ...pairedStatistics(results.map(result => result.scores)) });
  }
  return { moveMs: 75, searchOptions: APP_SEARCH_OPTIONS, seed, pairs, ...pairedStatistics(results.map(result => result.scores)), results };
}

/** Hash searched sources as well as HEAD, so a dirty checkout remains identifiable. */
export function engineIdentity(root) {
  return {
    revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceSha256: Object.fromEntries(['src/engine/ai.ts', 'src/engine/gogomoku.ts'].map(file => [file,
      createHash('sha256').update(readFileSync(join(root, file))).digest('hex') ])),
  };
}

export function runMatchCli(args = process.argv.slice(2), load = loadEngine, log = console.log,
  report = progress => console.error(JSON.stringify(progress))) {
  try {
    assert(args[0], 'Usage: node scripts/strength-match.mjs MASTER_CHECKOUT [PAIRS=100] [SEED=20261013] [OPENING_BOOK_JSON]');
    const masterRoot = realpathSync(args[0]);
    const master = load(masterRoot);
    const candidate = load(process.cwd());
    // Exercise both search implementations before scoring any games.
    for (let i = 0; i < 8; i++) {
      for (const engine of [master, candidate]) {
        new engine.GogoAI(APP_SEARCH_OPTIONS).findBestMove(engine.decodeGame('B9 e5 d5'), 75);
      }
    }
    const openings = args[3] === undefined ? undefined : JSON.parse(readFileSync(args[3], 'utf8')).entries.map(entry => entry.opening);
    const result = runMatch(master, candidate, { pairs: Number(args[1] ?? 100), seed: Number(args[2] ?? 20261013), openings }, report);
    result.engines = { master: engineIdentity(masterRoot), candidate: engineIdentity(process.cwd()) };
    log(JSON.stringify(result, null, 2));
    return result.passed ? 0 : 1;
  } catch (error) {
    log(error.message);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runMatchCli();
}
