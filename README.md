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


## AI strength regression gate

A simple, robust strength check is included for pull requests.

- Script: `npm run ai:strength -- --candidate <git-ref> --baseline <git-ref>`
- CI compares the PR branch against the pull request base commit.
- Method:
  - fixed opening suite (including empty-board and corner/center patterns)
  - paired games for each opening (candidate plays both colors)
  - score rate = `(wins + 0.5 * draws) / games`
  - 95% Wilson lower confidence bound used as the pass/fail signal

By default the gate fails if:

- any invalid moves occur, or
- the 95% lower bound is not above `0.50`.

Example:

```bash
npm run ai:strength -- --candidate HEAD --baseline master --time-ms 20 --min-lower-bound 0.50
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
