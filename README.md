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

To run locally, use Node 24 and run from the new version's checkout. The benchmark
needs no installed dependencies or test runner:

```bash
npm run test:performance -- /path/to/master-checkout
```

The Puzzles workflow also compares AI strength against `master`, without installing
dependencies. Run it locally with Node 24:

```bash
npm run test:strength -- /path/to/master-checkout
# Reproduce a reported seed:
npm run test:strength -- /path/to/master-checkout 123
```

Each attempt plays 32 pairs from fresh legal clustered openings (4–12 opening
plies) across 9×9, 11×11, and 13×13 boards. Both games in a pair use the same
opening, swap candidate colors, and randomize which color plays first. Master’s
board implementation referees both versions, so changes to the rules cannot
quietly change the comparison. Each game has fresh AI instances, a maximum of
64 additional plies, and search options `maxDepth: 10`, `quiescenceDepth: 4`.
No-move positions and move-cap games are draws; illegal AI replies are errors.
The seed, openings, game results, pair totals, and runtime are logged.

Both versions receive a fixed **2 milliseconds per move**, passed directly to
`findBestMove`. They use their normal wall clocks; no artificial clock or work
budget is injected. A faster engine can search further within the same time.
There are 32 × 2 × 64 = 4096 possible searched moves per attempt, so the nominal
search budget at the move cap is 8.192 seconds, leaving room for setup, search
overshoot, and result checks within 15 seconds. The engine checks time
periodically, so a call may exceed 2ms; the attempt deadlines bound total time.
A passed run is a fast regression screen, not an Elo estimate or proof of equal
strength at larger time controls. The seed reproduces openings and game order;
move choices can vary with CPU scheduling.

A pair contributes the sign of the sum of its two candidate results (win = +1,
draw = 0, loss = −1). Tied pairs are excluded. For `n` decisive pairs and `L`
lost pairs, the one-sided exact sign-test p-value is
`sum(C(n, k), k=L..n) / 2^n`; fail the attempt only when `p <= 0.05`.
For example, five losses without a won pair have p = 1/32 = 3.125%; four
have p = 1/16 = 6.25% and pass. With 32 decisive pairs, at least 22 losses
are needed (p ≈ 2.505%). Both games are one observation, never two independent
samples, and there is only one aggregate strength test per attempt.

Under no change, assume independent pair outcomes and timing noise that is
exchangeable between the two identical engines. Each pair starts with fresh
AI instances; colors are swapped and game order is randomized to avoid a fixed
seat/order advantage. Conditional on a pair being decisive, a loss and a win
then have equal probability. Thus `L ~ Binomial(n, 1/2)` and the exact tail
threshold gives a per-attempt false-fail probability at most 5%; discreteness
makes it conservative. Timing noise means identical engines need not tie.
This analytical bound assumes fair, independent noise, as the performance
comparison assumes exchangeable timing measurements; it does not cover systematic
version-specific scheduling bias. There is no separate per-board test or
multiple-testing penalty: all board sizes feed one aggregate comparison.

Retries use fresh openings and stop on any passing attempt; only five failed
attempts confirm a regression. Even without assuming independence between
retries, the final statistical false-fail probability is no greater than the
first attempt’s. The conservative retry policy reduces sensitivity to small
regressions.

Each attempt has its own 13-second internal deadline. The parent runs each
attempt in a fresh Node process with a **14-second hard timeout**, including
process startup and source loading. A passing comparison finishes after one
attempt; up to five failing attempts can take up to 70 seconds plus small
orchestration overhead. CI also enforces a 74-second total hard cap, within
the requested 5 × 15-second limit. Checkout and Node setup are outside this
execution budget. The same per-attempt process limit applies locally.

Exit codes are 0 (pass), 1 (five confirmed strength failures), and 2 (invalid
engine/configuration or an inconclusive runtime/process error). Runtime errors
stop immediately rather than being retried as strength regressions. A killed
or unfinished attempt is never accepted as a pass.

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
