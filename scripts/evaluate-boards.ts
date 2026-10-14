/** Node 24+: node scripts/evaluate-boards.ts MASTER_CHECKOUT [OUTPUT_DIRECTORY]
 * Exhaustively generates B9 ply-3 boards. Restart with the same arguments to resume.
 * The 300-board screening searches up to depth 64 with a 10-second budget.
 * Keep the master checkout unchanged until collection finishes.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';
import type { SearchResult } from '../src/engine/ai.ts';
import type { EvaluatedBoard, Playout } from '../src/evaluate-boards.ts';

const masterRoot = process.argv[2];
if (!masterRoot) throw new Error('Usage: node scripts/evaluate-boards.ts MASTER_CHECKOUT [OUTPUT_DIRECTORY]');
const output = resolve(process.argv[3] ?? 'data/strength-ply3');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const { streamUniqueBoards } = require(resolve(root, 'src/engine/boardStream.ts')) as typeof import('../src/engine/boardStream.ts');
const { evaluateBoard, rankBoards, collectBoards, playOut, screenBoards } = require(resolve(root, 'src/evaluate-boards.ts')) as typeof import('../src/evaluate-boards.ts');
hooks.deregister();
const master = loadEngine(resolve(masterRoot));
const revision = execFileSync('git', ['-C', resolve(masterRoot), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (execFileSync('git', ['-C', resolve(masterRoot), 'status', '--porcelain', '--', 'src/engine'], { encoding: 'utf8' }).trim()) {
  throw new Error('Master engine checkout must be clean');
}
mkdirSync(output, { recursive: true });
const path = (name: string) => resolve(output, name);
const save = (name: string, value: unknown) => {
  writeFileSync(path(`${name}.tmp`), `${JSON.stringify(value, null, 2)}\n`);
  renameSync(path(`${name}.tmp`), path(name));
};
const metadata = { schemaVersion: 1, masterRevision: revision, ply: 3, boardSize: 9,
  includeTranslationSymmetry: false, includeColorSymmetry: false, seed: 1,
  evaluationMs: [5, 25, 100], playoutMs: 75, maxPlayoutPlies: 500, winsPerColor: 50 };
if (existsSync(path('metadata.json')) && readFileSync(path('metadata.json'), 'utf8') !== `${JSON.stringify(metadata, null, 2)}\n`) {
  throw new Error('Output belongs to a different master or configuration; use a new output directory');
}
save('metadata.json', metadata);
const boards: string[] = [];
const stats = streamUniqueBoards({ ply: 3, boardSize: 9, seed: 1,
  includeTranslationSymmetry: false, includeColorSymmetry: false }, encoded => boards.push(encoded));
save('boards.json', { stats, boards });
console.log(`Generated all ${boards.length} unique ply-3 boards.`);

// Only an interrupted final append may be incomplete; discard it before resuming.
function readJournal<T>(name: string): T[] {
  if (!existsSync(path(name))) return [];
  const content = readFileSync(path(name), 'utf8');
  const complete = content.slice(0, content.lastIndexOf('\n') + 1);
  if (content !== complete) writeFileSync(path(name), complete);
  return complete.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
const evaluated = new Map(readJournal<EvaluatedBoard>('evaluations.jsonl').map(board => [board.encoded, board]));
for (const encoded of boards) {
  if (evaluated.has(encoded)) continue;
  const board = evaluateBoard(encoded, (opening, ms) => new master.GogoAI().findBestMove(master.decodeGame(opening), ms));
  appendFileSync(path('evaluations.jsonl'), `${JSON.stringify(board)}\n`);
  evaluated.set(encoded, board);
  if (evaluated.size % 100 === 0) console.log(`Evaluated ${evaluated.size}/${boards.length}`);
}
const ranked = rankBoards(boards.map(encoded => evaluated.get(encoded)!));
if (!existsSync(path('ranked.json'))) save('ranked.json', ranked);
const screeningMetadata = { ...metadata, screeningMs: 10_000, screeningMaxDepth: 64, screenedPoolSize: 300 };
save('screening-metadata.json', screeningMetadata);
const screened = new Map(readJournal<{ encoded: string; result: SearchResult }>('screenings.jsonl')
  .map(row => [row.encoded, row.result]));
let accepted = 0;
const pool = screenBoards(ranked, (encoded, ms) => {
  const cached = screened.get(encoded);
  const result = cached ?? new master.GogoAI({ maxDepth: screeningMetadata.screeningMaxDepth })
    .findBestMove(master.decodeGame(encoded), ms);
  const eligible = !(result.forcedWin || result.forcedLoss || result.heuristicWin || result.heuristicLoss);
  if (eligible) accepted += 1;
  if (!cached) {
    appendFileSync(path('screenings.jsonl'), `${JSON.stringify({ encoded, result })}\n`);
    screened.set(encoded, result);
    console.log(`Screened ${screened.size}: ${accepted}/300 accepted, ${encoded}, score=${result.score}, depth=${result.depth}`);
  }
  return result;
});
const reranked = rankBoards(pool, 10_000);
save('screened-ranked.json', { ...screeningMetadata, boards: reranked });
const played = new Map(readJournal<{ encoded: string; playout: Playout }>('playouts-10s.jsonl')
  .map(row => [row.encoded, row.playout]));
for (const board of reranked) board.playout = played.get(board.encoded);
try {
  const collection = collectBoards(reranked, encoded => {
    const playout = playOut(master.decodeGame(encoded), new master.GogoAI());
    appendFileSync(path('playouts-10s.jsonl'), `${JSON.stringify({ encoded, playout })}\n`);
    console.log(`Played ${encoded}: winner=${playout.winner}, plies=${playout.plies}`);
    return playout;
  });
  save('collection-10s.json', { ...screeningMetadata, complete: true, boards: collection });
  console.log(`Saved 50 white wins and 50 black wins to ${path('collection-10s.json')}`);
} finally {
  save('screened-ranked.json', { ...screeningMetadata, boards: reranked });
}
