# 75 ms engine experiment

The requested gate is **at least 70% raw wins and p < .01** against master
`2e59cc889790edd363abc8fd80572b5a22bb93cf`. It has **not been met**.

The recorded pre-follow-up sample used 100 openings, two color-swapped games per opening,
75 ms per move, depth ceiling 30, quiescence depth 4, and maximum ply 96 for both
versions. Candidate scored **121 wins / 79 losses / 0 draws (60.5%)**. The exact
two-sided paired sign-flip p-value is **0.0000057220458984375**. Candidate won
68/100 games as Black and 53/100 as White. See `strength-balanced-75ms.json`.

The user-approved book was selected without evaluating candidate: generate
random legal 6–24-ply central 7x7 openings on a 9x9 board, reject terminal starts
and starts where master reports a forced/heuristic outcome, then select equal
numbers of Black and White winners from master-only 75 ms self-play. Selection
required 307 generated openings. The book records the seed, search settings,
master winner, and initial score. Balance in master self-play does not guarantee
balance between other engine pairings.

With identical application settings, the 32-case, three-repeat tactical replay
found verified outcomes in **13 candidate cases versus 12 master cases**.
Candidate alone verified one of the 16 previous-turn positions. Total detection
cost was 1229 versus 1428 ms, including 150 ms penalties for missed targets;
this is a screening metric, not a measured throughput or tournament win rate.
See `tactical-performance.json`. Saved heuristics are observations, not truth labels.

Earlier default-setting validation results are retained: 110/200 wins
(`strength-initial-75ms.json`) and 53/100 (`strength-validation-2-75ms.json`).
The initial replay used different default depth ceilings and quiescence depth 6;
its larger detection advantage is historical, not the application-setting result.

```bash
npm run --silent test:strength:book -- /path/to/master-checkout 50 2026101501 1000 > book.json
npm run --silent test:strength:match -- /path/to/master-checkout 100 20261015 benchmarks/balanced-opening-book.json
npm run --silent test:tactical:performance -- /path/to/master-checkout benchmarks/tactical-training-match.json 32 3 75
```

Wall-clock searches can vary between reruns. The saved results, opening book,
first outcome signals, baseline revision, and candidate source hashes allow the
reported run to be inspected independently.

The CI timing follow-up delays root scouts to depth three and searched-score
ordering to depth four, reuses cached group member lists for tactical moves,
and prepares patterns once per move batch. The existing 31-case performance
gate passes locally: accepted median totals are **4119.630 ms candidate versus
6309.606 ms master**. Full comparisons and source hashes are recorded in
`puzzle-performance-ci-fix.json`; neither the tolerance nor retry policy changed.
The 200-game and initial tactical figures above describe the source hashes in
their saved reports and precede this follow-up.
The follow-up tactical replay (`tactical-performance-ci-fix.json`) still finds
13 candidate verified outcomes versus 12 for master, including one candidate-only
previous-turn verification. Penalized detection costs are 1224 versus 1404 ms.

A fresh fixed 200-game run after the CI timing follow-up confirms the user's
60% win-rate / p < .01 check: **126 wins, 74 losses, no draws (63%)**, exact
two-sided paired **p = 0.000000867992639541626**. It uses the same 100-opening
book, seed 20261016 for game order, 75 ms per move, and identical app settings.
Candidate revision is `4ef9c0f3f009daecf63acf9af57b81c45a88e2c6`; master is
`80cf077096f659cb836c6026555d42753daefe25`. Complete signals, engine source
hashes and the book hash are in `strength-balanced-ci-fix-75ms.json`. Its
`requestedConfirmation.passed` is true; the original `passed` field still
represents the stricter 70% gate and is false.

The incremental cache follow-up addresses the remaining timing regression
without changing search results or the CI tolerance. Groups touching placements
or captures are invalidated during the existing window update; other groups
retain their member lists, liberties and evaluated stone contributions. All
31 cases pass the local performance gate on the first attempt. Accepted median
totals are **3983.936 ms candidate versus 6145.600 ms master**. In 41-sample
warmed diagnostics, candidate medians are 4.993 versus 5.404 ms on
`gen-intermediate-2`, 3.711 versus 3.846 ms on `gen-intermediate-5`, and 18.645
versus 18.677 ms on `gen-advanced-1`. Every SearchResult field on all 31 cases
also agrees with the previous candidate when the clock is fixed. Raw timings,
method and source hashes are in `puzzle-performance-incremental-cache.json`.

GitHub CI also passes for the incremental cache version, including the formerly
failing `gen-intermediate-5` on its first attempt. CI's accepted median totals
are **4080.931 ms candidate versus 6538.965 ms master**, with detailed
comparisons appended to the same performance report. A fresh fixed 200-game
75 ms match on the unchanged book (seed 20261017) scores **124 wins / 76 losses
(62%)**, exact two-sided paired **p = 0.000003032386302947998**. This still meets
the requested 60% / p < .01 check, while the original 70% gate remains unmet.
See `strength-balanced-incremental-cache-75ms.json` for the actual tested engine
revision, source hashes, opening-book hash and first tactical signals.
