# GoGomoku engine + browser AI

This package implements a browser-safe GoGomoku core with a Vue-based UI:

- board sizes: 9x9, 11x11, 13x13
- five-in-a-row wins horizontally, vertically, or diagonally
- Go-style captures by removing opponent groups with no liberties
- simplified ko: immediate recapture is forbidden
- suicide is illegal **unless** the move creates five-in-a-row, which wins immediately
- iterative deepening negamax / minimax with alpha-beta pruning
- quiescence search for tactical continuations
- hard time limit with best-so-far return semantics
- AI computations run in a Web Worker to keep the UI responsive
- 100% line / branch / function coverage enforced by the test command

## Project layout

- `src/engine/gogomoku.ts` — rules engine, make/undo, ko, captures, legal move checks
- `src/engine/ai.ts` — iterative deepening alpha-beta search, move ordering, quiescence
- `src/engine/index.ts` — public engine exports
- `src/worker/ai-worker.ts` — Web Worker for AI computations
- `src/composables/useGame.ts` — Vue composable managing game state and worker communication
- `src/components/` — Vue components (BoardGrid, GameToolbar, GameRecord, LoadGame)
- `src/App.vue` — root Vue component
- `src/main.ts` — application entry point
- `index.html` — Vite entry HTML
- `tests/` — full coverage test suite (Vitest)
- `vite.config.ts` — Vite build configuration
- `vitest.config.ts` — Vitest test configuration

## Build and verify

```bash
npm run build
npm run test
npm run coverage
```

The coverage command is configured with 100% thresholds for lines, branches, and functions.
Individual tests have a 250 ms timeout, including synchronous test bodies.
Measured exhaustive searches and integration tests use `{ tags: ['slow'] }`
with a comment explaining why the full workload is needed. The `slow` tag
allows 5 seconds; puzzle generation explicitly allows 15 seconds. Slow tests
remain part of CI coverage. Keep ordinary cases small before adding a slow tag.

The Puzzles workflow also compares performance against `master` on the same
runner. It alternates master and candidate runs, measuring every original and
generated puzzle three times per version. Each puzzle passes when its fastest
candidate time is no slower than its slowest master time (equality passes).
The Node script loads both engines directly from TypeScript source and measures
only `findBestMove`; board decoding, AI construction, and solution checks are
outside the timed section. Both engines solve the candidate's puzzle definitions
with identical search options and time budgets.
Each puzzle gets up to five comparisons, each with three fresh runs per
version. Retries happen immediately for that puzzle. A puzzle that passes any
comparison is validated and never rerun. CI fails if a puzzle still regresses
after its fifth comparison. Incorrect solutions or invalid timings fail
immediately.
After every puzzle passes, the script sums each puzzle's median timing from
its accepted three-run comparison. The total must not regress either.
Use `--require-half-total` to additionally require a total at most 50% of
master's runtime. The final line reports both totals and the target.

To run locally, use Node 24 and run from the new version's checkout. The benchmark
needs no installed dependencies or test runner:

```bash
npm run test:performance -- /path/to/master-checkout
# Require a 50% reduction in total puzzle solver runtime:
npm run test:performance -- /path/to/master-checkout --require-half-total
```

The Puzzles workflow also runs `test:strength` against a separate checkout of
`master`, without installing dependencies. Both engines get **5 ms per move**
with their default search options. They play from randomly selected legal
six-move central openings on 9×9 boards. Each opening is played twice, swapping
colors; the order of the two games is randomized. Both engines receive their
own version's position objects and fresh AI instances for each game. Both are
warmed before scoring, with randomized warmup order. Games use master's rules;
illegal moves or disagreement between the engines' rules are setup/protocol
errors, rather than evidence of a strength regression. No wall-clock overrun
forfeits are applied, since normal search deadline overshoot is noisy.

One comparison runs in a worker with a **14-second watchdog**, including engine
loading, warmup, opening generation, and games. Shutdown has one second of
headroom below 15 seconds. It runs up to 128 pairs, adapting the number of games
to actual runtime by stopping at the watchdog. Only complete pairs count;
an interrupted pair is discarded. Games end at a win, no legal moves, or 120
additional plies (a draw). The watchdog can interrupt even a stuck synchronous
search. No completed pairs or worker errors fail immediately with exit code 2.
A statistical pass exits with 0; a confirmed strength regression exits with 1.

For each pair, let `S` be the candidate's mean game result: win = +1, draw = 0,
loss = −1. Start three loss evidence processes at 1 and update each with
`E_b *= (1 − b S)`, for stakes `b = 0.2, 0.5, 0.8`, after each completed pair.
The reported evidence `E` is their mean. Mixing stakes provides sensitivity to
several regression sizes without choosing one after observing the results. Fail
that comparison as soon as `E >= 20`; otherwise pass when the budget ends.
Seven consecutive pairs lost in both colors cross the threshold, while
equal-score pairs leave evidence unchanged. A failed comparison is retried from scratch, using fresh openings and randomized order,
up to five comparisons. Any pass ends the test. Thus a passing comparison fits
within 15 seconds and five failing comparisons fit within 75 seconds, excluding
other CI steps.

**Analytical false-failure bound:** under unchanged, exchangeable engines,
assume `E[S | previous pairs] >= 0`. Each `E_b`, and hence their mean `E`, is
a nonnegative supermartingale starting at 1, because each multiplier has
conditional expectation at most 1.
Ville's inequality gives `P(ever E >= 20) <= 1/20 = 5%`. This bound includes
adaptive stopping, any number of pairs, and discarding an unfinished final
pair; no fixed-sample p-value or repeated-testing correction is needed. The
claim assumes equal engine treatment and exchangeable timing noise, as the
performance comparison does. Persistent version-specific runner bias violates
that assumption. Requiring five failures cannot increase the 5% bound; we do
not assume independent retries or claim a `0.05^5` bound.

This is a quick head-to-head smoke test for substantial regressions at a short
time control. A pass means insufficient evidence of a regression, not proof
of equal strength. It does not measure small Elo differences, long time
controls, or strength on larger boards; those require a longer tournament.

Run locally with Node 24 from the candidate checkout:

```bash
npm run test:strength -- /path/to/master-checkout
```

## Development

```bash
npm run dev
```

Opens a Vite dev server with hot module replacement.

## Public API

```ts
import { GogoPosition, GogoAI, BLACK, WHITE } from './src/engine';

const position = new GogoPosition(9);
const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 6, maxPly: 96 });

position.playXY(4, 4);          // black
const result = ai.findBestMove(position, 75);
position.play(result.move);      // white AI reply
```

### `GogoPosition`

Key methods:

- `play(index)` / `playXY(x, y)`
- `undo()`
- `isLegal(index)`
- `hasAnyLegalMove()`
- `generateAllLegalMoves(buffer)`
- `scanGroup(start, color)` with `scanGroupSize`
- `index(x, y)` and `at(x, y)`

Key fields:

- `board: Uint8Array`
- `toMove`
- `winner`
- `koPoint`
- `lastMove`
- `lastCapturedCount`

### `GogoAI`

Constructor options:

- `maxDepth` — iterative deepening cap
- `quiescenceDepth` — tactical extension depth
- `maxPly` — recursion safety cap
- `now` — injectable clock, useful for deterministic tests

Search result:

- `move`
- `score`
- `depth`
- `nodes`
- `timedOut`

## Optimization notes

The implementation stays allocation-light in the hot path:

- board state is a `Uint8Array`
- group search uses reusable typed-array stacks and buffers
- move generation uses reusable typed-array buffers per ply
- search relies on in-place `play()` / `undo()` rather than cloned positions
- candidate generation is locality-biased to keep branching down
- move ordering combines pattern scores, tactical pressure, center bias, and history

## Search design

The AI uses:

- iterative deepening
- alpha-beta negamax
- locality-based candidate generation
- tactical move ordering
- quiescence on forcing moves such as wins, blocks, captures, and escapes
- fallback move selection when the time budget expires before a full iteration completes

## Rule decisions encoded

A few ambiguities were fixed explicitly:

- simplified ko is implemented as standard immediate recapture prevention for single-stone ko
- five-in-a-row overrides suicide legality, but not ko illegality
- captures are resolved before the final suicide check
- a move that makes five wins immediately, even if the resulting group has no liberties

## Agents

If you are a code agent, then follow AGENTS.md
