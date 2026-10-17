# All 9×9 positions at ply 2, 60-second searches

Engine: `4c9b1078a3b46e9e10dd0b338aee484a02372581` (master when the run started).
Run: 14 October 2026, 07:14–17:56 UTC; approximately 10 hours 42 minutes.
These measurements describe that commit, rather than subsequent engine changes.

| Result | Boards |
| --- | ---: |
| Proven win for Black (side to move) | 208 |
| Proven loss | 0 |
| Unresolved at timeout | 638 |
| Total | 846 |

Each position received a fresh `GogoAI` with `maxDepth: 30`,
`quiescenceDepth: 4`, `maxPly: 64`, and a 60,000 ms search budget.
The run used Node 24.19.0 and executed searches sequentially.

Rotations and reflections are equivalent; translations and color swaps are not.
All 6,480 legal ordered two-move placements were independently enumerated and
matched against the 846 representatives. Black has the next move. A timeout
means the outcome is unresolved, even when its numerical score is positive.

- `manifest.json`: exact engine revision, settings, and ordered board list.
- `results.jsonl`: one row per board, including position, move, elapsed time,
  completion timestamp, and every `SearchResult` field: score, depth, nodes,
  timeout, forced defense, forced win/loss, and heuristic win/loss.
- `summary.json`: aggregate counts, search duration, and results SHA-256.

Heuristic flags are independent result fields, not additional outcome buckets;
65 rows report `heuristicWin`. All 846 rows were checked for matching manifest
indices, unique symmetry keys, legal returned moves, and complete result fields.
