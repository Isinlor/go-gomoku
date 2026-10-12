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

Each attempt samples complete color-swapped pairs until a **12-second wall-time
sampling deadline**, measured from before source loading. The number of games
adapts to the runner: faster CI runners play more pairs rather than stopping at
32. Both games in a pair use the same legal 4–12-ply opening, swap candidate
colors, and randomize which color plays first. Board sizes cycle equally through
9×9, 11×11, and 13×13. Opening stones occupy a randomly placed 5×5 patch, including
edges, rather than always starting in the center. Master’s board implementation
referees both versions. Each game has fresh AI instances; the seed, openings,
game results, pair counts, evidence, and runtime are logged.

Both versions receive the same fixed **2 milliseconds per move**, passed directly
to `findBestMove`, using their normal clocks. Search options are `maxDepth: 64`
and `quiescenceDepth: 6`, so the old depth-10 and quiescence-4 caps do not restrict
fast tactical searches. Games allow 256 additional plies rather than stopping at
64, to avoid concealing later losses. No-move positions and move-cap games are
draws; illegal replies are errors. The engine checks time periodically, so a
call can exceed 2ms. These remain fast games at a small time control; passing
does not establish equal Elo or strength at larger time controls. The seed
reproduces openings and order, while timing noise can change move choices.

Time-based sampling requires a test that is valid at any stopping time. A
fixed-sample binomial p-value is insufficient when game duration and results
can determine how many observations are collected. Each completed pair has
score `S = (first game result + second game result) / 2`, with game results
−1, 0, +1. Thus `S` is −1, −0.5, 0, +0.5, or +1. Keeping half-points preserves
the difference between losing both games and losing one while drawing the other;
the previous sign test discarded this margin.

The test averages six nonnegative betting processes. For each fixed bet
`b` in `{0.05, 0.1, 0.2, 0.4, 0.6, 0.8}`, start with `W_b = 1` and multiply by
`1 - b*S` after every complete pair. Define `E = average(W_b)` and flag the
attempt if **E reaches 20 at any completed-pair prefix**. Calculations use log
wealth to avoid numerical overflow affecting the decision. Under no change,
assume version-exchangeable timing noise, so `E[S | past] = 0`; more generally,
nonnegative conditional expected candidate score suffices. Each factor is
nonnegative with conditional expectation at most 1, so every `W_b` and their
mixture are nonnegative supermartingales starting at 1. Ville’s inequality gives
`P(any prefix E >= 20) <= 1/20 = 5%`. This is one aggregate test across board
sizes, not separate tests with multiple-comparison penalties. Unlike a fixed
binomial tail, this analytical bound permits adaptive sample counts, correlated
observations satisfying the conditional-mean assumption, and outcome-dependent
stopping times. It still assumes fair noise; systematic version-specific bias
is outside the null model.

Once the sampling deadline is reached, the current pair can finish with a
500ms grace period. If it cannot finish, discard the **entire** pair and stop;
never score a half-pair or turn a deadline interruption into a draw. The completed
observations remain a prefix, preserving the statistical bound. No complete pairs
is an inconclusive error. A sampling deadline normally produces a scored result,
rather than failing merely because more games could have been played.

A passing attempt ends the comparison. Failed attempts retry with fresh openings,
up to five attempts. Retaining the existing retry policy reduces sensitivity
compared with failing on one rejection, but the final statistical false-failure
probability is at most that of the first attempt, even without independence
between retries. The parent gives every attempt a **14-second hard process
timeout**, including startup and source loading. CI also enforces a 74-second
total cap, within the requested 15 seconds per attempt / 5 × 15 seconds total
budget. Checkout and Node setup are outside this execution budget. The same
per-attempt process timeout applies locally.

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
