# 75 ms engine experiment

The requested gate is **at least 70% raw wins and p < .01** against master
`2e59cc889790edd363abc8fd80572b5a22bb93cf`. It has **not been met**.

The final fixed sample used 100 openings, two color-swapped games per opening,
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
npm run test:strength:match -- /path/to/master-checkout 100 20261015 benchmarks/balanced-opening-book.json
npm run test:tactical:performance -- /path/to/master-checkout benchmarks/tactical-training-match.json 32 3 75
```

Wall-clock searches can vary between reruns. The saved results, opening book,
first outcome signals, baseline revision, and candidate source hashes allow the
reported run to be inspected independently.
