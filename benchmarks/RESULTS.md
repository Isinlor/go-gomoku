# Engine optimization results — 2026-10-14

Baseline: latest fetched `origin/master`, `6bf3c52c03ec8774790af74d6c3b36f2c89380f3`. Node v24.19.0.

All 34 puzzles and game positions retained their existing solution and result
assertions. Warmed alternating measurements used two warmup runs followed by
seven measured runs per engine; the table shows medians.

| Case | Master ms | Candidate ms | Reduction |
| --- | ---: | ---: | ---: |
| gen-complex-1 | 47.360 | 39.024 | 17.6% |
| gen-atari-escape | 99.925 | 72.841 | 27.1% |
| gen-crossfire | 53.124 | 43.015 | 19.0% |
| gen-unblockable-gap | 55.123 | 45.458 | 17.5% |
| edge-attack-forced-win | 34.608 | 30.036 | 13.2% |
| edge-forced-loss | 1160.403 | 984.803 | 15.1% |

The finalized engine's strict strength run passed on attempt 1: **121 wins,
0 draws, 79 losses (60.5%)** at 25 ms per move across 100 color-swapped opening
pairs. The exact one-sided paired sign-flip test against equal strength gives
**p = 0.00950414 after correction for up to five attempts**. An earlier run of
this engine configuration scored 123–77 (61.5%). These are observed win rates
on the repository's opening pool.

Changes: incremental board mutation journals and evaluation caches; separate
four-window masks; shared candidate scoring preparation; skipped unchanged
pattern updates. Default quiescence depth is four. Budgets below 100 ms skip
speculative early proofs; final mate claims still require independent proof.

Verification: 100% line, branch, and function coverage; production build;
strict performance and strength commands passed. Raw timings and benchmark
logs are stored alongside this report.

```sh
git worktree add --detach /tmp/gomoku-master 6bf3c52
npm run coverage
npm run build
npm run test:performance -- /tmp/gomoku-master --require-speedup
npm run test:strength -- /tmp/gomoku-master --time-ms 25 --alpha .01 --require-gain
```
