# Unit-test boundary audit

The existing suite did not consistently test a condition's positive case and its nearest counterexample. This audit reviewed all 36 existing test files at the behavior-group level, then added two test files. Complementary cases can live in different tests or files; unconditional wiring and fixed catalog invariants do not need artificial negative inputs.

## Confirmed bugs and fixes

1. **Missed forced capture win in ForcedWinSearcher.** The single-counter-threat attacker shortcut tried only a block, omitting captures. In the legal history `B9 b2 a1 c3 b3 d4 c2 e5 d3 i1 c5 i3 c6 i5 c7 i7`, White to move wins in three plies with `c4`, capturing `c3` and creating distinct completion cells `c3` and `c8`. Before the fix, the position-level search returned false while the complete oracle and move-specific search returned true. The blocking shortcut now applies only when the attacker cannot capture an opponent group. Moving White's earlier `d3` to `a9` gives `c3` an extra liberty and removes the forced win; that nearest counterexample is tested too, with caching enabled and disabled.

2. **Missing streamed boards.** Board-stream recursion reused one move buffer. A descendant overwrote the parent's unvisited moves. One- and two-ply tests passed, but the three-ply stream omitted 15 colored boards: 32,273 instead of 32,288. Each recursion depth now owns its move buffer. Independent Burnside counts cover one, two and three plies without calling the traversal or canonicalizer to calculate the expected number. Emitted histories are also replayed legally.

3. **Silently truncated integer CLI flags.** `Number.parseInt` accepted `12x` as 12 and fractional strings such as `0.5` as 0. Parsing now validates the entire numeric value as an integer and rejects empty strings. Tests cover accepted integers, malformed/fractional values, and the streaming CLI path.

4. **Immediate-win proof ignored a nonpositive horizon.** `forcedWinDepthForMove` returned 1 even with a zero or negative ply budget. It now returns -1 before trying a move, matching `hasForcedWinAfterMove`. Adjacent budgets -1, 0, 1 and 2 test the exact minimum and board restoration.

All four production changes followed failing regression tests.

## Targeted proof enumeration

- Enumerate all 2,187 assignments of empty/attacker/defender stones to a seven-cell line.
- Test both attacking colors, all four line directions, and three placements including both board edges.
- Exclude already-terminal boards from the threat sweep; test no ko and a ko restriction at every empty pattern cell.
- Each of the 24 line cases checks exactly 7,216 bounded proof queries: **173,184 total**.
- Add **128 three-ply capture-neighborhood queries**, covering both colors, all eight board symmetries, six individual stone removals, and their combined removal.
- Total: **173,312 oracle queries**, each compared with ForcedWinSearcher and the AI prover. No mismatches remain in this enumerated space after the fixes.
- The independent AND/OR judge probes every point with real legal play/undo. It has no heuristic move selection, window shortcuts or transposition cache. It uses the same underlying board rules, so it checks search logic rather than independently proving the board-rule implementation.

## Assertion and boundary improvements

Removed boolean-type-only proof assertions and a validator test that could pass with no validation assertions. Corrected mocks that wrote injected candidates into the position argument rather than the move buffers. The rejected candidates are now explicitly observed. Replaced misleading fallback tests with a real exhaustive-defense case, including distant defenses. Added equality and immediately adjacent values for outcome scores, mate-score normalization, candidate capping, sorting ties, time limits, CLI values and strength evidence. Fixed data and unconditional event forwarding are distinguished from conditional behavior.

These changes provide explicit outcomes and nearby counterexamples for the identified weak behavior groups. This is a test audit, not a formal certificate that every Boolean subexpression or all possible proof horizons have been exhaustively checked. Existing white-box tests remain useful for control flow and cache plumbing; their strongest evidence comes from complementary real-position and independent-oracle tests.

## Validation

- `npm run coverage`: **899 tests across 36 files passed**, with 100% lines, functions and branches in the existing configured coverage scope. Existing exclusions, including puzzleGenerator.ts, are unchanged.
- `npm run test:puzzles`: **36 puzzle/game-position checks passed**.
- `npm run build`: passed.
- `git diff --check`: passed.
- Test-inclusive `vue-tsc --noEmit -p tsconfig.json`: **25 existing diagnostics**, identical to a clean checkout of current master after normalizing line offsets. No new diagnostics. The production build typecheck passes.
- The full enumerated proof suite takes about 7 seconds without coverage and about 60 seconds with V8 coverage instrumentation in this environment. The final complete coverage run took 83 seconds. Enumeration timeouts are local to these tests; the global fast-test timeout is unchanged.

## File-by-file review

Test counts below come from the final coverage run; the two integration benchmark files run separately. “Already paired” describes relevant behavior groups across the suite, not a requirement that each individual test contain both outcomes.

| Test file | Executed tests | Audit result |
| --- | ---: | --- |
| `ai-strength.test.ts` | 31 | Added 19.999 / 20 / 20.001 threshold cases; score endpoints, retry limits, worker exit/error and watchdog cases were already paired. |
| `cliArgs.test.ts` | 16 | Added whole-value integer acceptance/rejection; exposed and fixed prefix/fraction truncation. |
| `compare.test.ts` | 27 | Added exact timeout boundary; strengthened success-path assertions alongside existing invalid-move/exit cases. |
| `components/App.behavior.test.ts` | 5 | Real fresh responses and cancelled/stale responses paired with human/AI mode behavior. |
| `components/App.test.ts` | 11 | Clipboard success/failure paired; strengthened actual player-mode ref updates. Other handlers are unconditional event wiring. |
| `components/BoardGrid.test.ts` | 8 | Empty/occupied cells and enabled/disabled guards already paired; rendering and event wiring unconditional. |
| `components/GameRecord.test.ts` | 4 | Unconditional record rendering and copy-event forwarding; no conditional rule to negate. |
| `components/GameToolbar.test.ts` | 22 | Added -1 / 1 / 2 and zero/blank time-limit cases for both players; human/AI controls already paired. |
| `components/LoadGame.test.ts` | 5 | Error present/empty already paired; text-input/event/placeholder tests unconditional. |
| `components/PuzzleSelect.test.ts` | 6 | Valid ID / unknown ID / empty selection already paired; selection reset and label tests inspect fixed behavior. |
| `composables/useGame.test.ts` | 72 | Human/AI/thinking/winner guards, undo 0/1/2, valid/invalid loads, proof/heuristic labels, active/stale worker responses and errors already paired across groups. |
| `engine/ai.boards.test.ts` | 6 | Nearby suicide, ko and double-threat counterexamples already present; capture-only and counter-win cases supplemented by proof enumeration. |
| `engine/ai.boundaries.test.ts` | 13 | New score/mate normalization equality and adjacent values, constructor lower bounds, candidate count 11 / 12 / 13. |
| `engine/ai.earlyProof.test.ts` | 9 | Successful, failed, depth-limited, timed-out and unexpected-error proofs already paired with restoration checks. |
| `engine/ai.forcedDefensiveMove.scenarios.test.ts` | 256 | Existing independent legal-reply oracle covers directions, sizes, symmetries, capture/ko, counter-wins and 0.999 / 1 / 2 deadline values. |
| `engine/ai.forcedDefensiveMove.test.ts` | 6 | Unique block vs multiple defenses, immediate win vs ko/blocker already paired. |
| `engine/ai.fractionalScores.test.ts` | 9 | Existing independent one-ply scores, cutoff/noncutoff bounds for both signs, fractional order and stable ties. |
| `engine/ai.lossProof.test.ts` | 15 | Existing complete two-ply loss oracle and false-proof counterexamples; time/error state restoration. |
| `engine/ai.optimizations.test.ts` | 11 | Immediate/non-immediate and heuristic/proven outcomes paired across groups; cache sweeps use independent board counts. |
| `engine/ai.proofResponses.test.ts` | 4 | Counter-threat refusal and immediate counter-win paired; new capture-neighborhood enumeration supplements these cases. |
| `engine/ai.test.ts` | 104 | Replaced seven boolean-type assertions with outcomes, corrected mock argument indexing, forced the actual fallback, replaced misleading fallback tests with real distant-defense exhaustion; terminal/cutoff/TT/control-flow families paired across files. |
| `engine/boardStream.test.ts` | 28 | Added independent 1/2/3-ply counts and exact deadline boundary; strengthened canonical key equality/inequality. Exposed 15 missing three-ply boards. |
| `engine/engine.test.ts` | 26 | Coordinate limits, occupancy, winning suicide/ordinary suicide, ko release, captures, wins/terminal states already paired; replaced an assertion about an unrelated fresh buffer with actual legal-move checks. |
| `engine/gamePositions.test.ts` | separate benchmark | Game-position integration benchmarks; complementary win/loss and depth/budget cases live in unit suites. |
| `engine/gamePositions.unit.test.ts` | 1 | Fixed catalog metadata invariants; no input acceptance function to test with a fabricated negative entry. |
| `engine/moveOrdering.test.ts` | 8 | Added adjacent insertion scores, ties, empty/single-element sort and untouched tails; fractional tests also cover stable ties. |
| `engine/proofPatterns.test.ts` | 40 | New complete seven-cell ternary enumeration and capture-neighborhood perturbations against an independent complete legal-move oracle. |
| `engine/puzzleGenerator.test.ts` | 47 | Added nonpositive / one-ply proof budgets, legal capture win / extra-liberty refutation, exact history clean/blunder pair and accepted/rejected validator pair; removed vacuous conditional and type-only checks. |
| `engine/puzzleSimilarity.test.ts` | 13 | Existing each-cutoff just-below/equality pair, metadata mismatch, locality 2/3 and rotation/reflection distinctions. |
| `engine/puzzles.test.ts` | separate benchmark | Catalog integration benchmarks; negative proof cases are in engine unit/oracle suites, not invented catalog entries. |
| `engine/puzzles.unit.test.ts` | 3 | Existing found/missing lookup pair; remaining tests check fixed catalog invariants. |
| `engine/uniqueness.test.ts` | 36 | Existing equal/different shapes, isolated/adjacent stones, valid/out-of-range history indices and independent canonical packing across symmetry options. |
| `main.test.ts` | 1 | Unconditional application bootstrap; no conditional acceptance predicate to negate. |
| `puzzle-performance-runner.test.ts` | 15 | Pass/fail comparisons, retry 5 success/exhaustion, empty/duplicate inputs and operational errors already paired. |
| `puzzle-performance.test.ts` | 12 | Comparison equality/failure, three-sample validation, valid/invalid timings and solver outputs already paired. |
| `stream-boards.test.ts` | 14 | Added malformed/fractional ply inputs; valid/missing flags and CLI success/errors already paired. |
| `vite-config.test.ts` | 6 | Added false/nonliteral CI flag values beside exact true and omitted values. |
| `worker/ai-worker.test.ts` | 9 | Existing legal/terminal/exhausted-budget and ordinary/forced outcomes; transport setup itself unconditional. |

## Rule for future tests

For a conditional behavior, include a concrete positive example and the nearest example that changes the outcome. For a numeric cutoff, test just below, at, and just above it. For a conjunction of guards, vary each guard while holding the others valid. For proof optimizations, use a complete independent shallow judge where practical and check position restoration. A result's type, a conditional assertion that can be skipped, or agreement between two versions sharing the same shortcut does not establish correctness.
