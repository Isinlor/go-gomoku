#!/usr/bin/env bash
set -euo pipefail

# Both checkouts must already have dependencies installed. Use the candidate's
# Vitest/config for both versions so runner configuration is identical.
master_root=$(cd "${1:?Usage: check-puzzle-performance.sh MASTER_CHECKOUT}" && pwd)
new_root=$(pwd)
reports=$(mktemp -d)
trap 'rm -rf "$reports"' EXIT

pattern='^Classic AI solves (generated )?puzzle '
for attempt in 1 2 3 4 5; do
  if [[ "$attempt" != 1 ]]; then
    # Anchor and escape each remaining name; IDs may contain regex characters.
    pattern=$(node --input-type=module - "$reports/pending.json" <<'JS'
import { readFileSync } from 'node:fs';
const names = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
console.log(`^(?:${names.map(escape).join('|')})$`);
JS
    )
  fi
  for run in 1 2 3; do
    for version in master new; do
      root=$new_root
      if [[ "$version" == master ]]; then root=$master_root; fi
      node "$new_root/node_modules/vitest/vitest.mjs" run \
        --root "$root" --config "$new_root/vitest.puzzles.config.ts" \
        --maxWorkers=1 --no-file-parallelism \
        --testNamePattern "$pattern" \
        --reporter=json --outputFile="$reports/$version-$run.json"
    done
  done

  # Exit 1 means a timing regression; malformed reports are errors (exit 2)
  # and must not be hidden by a retry.
  status=0
  node --input-type=module - "$reports" "$attempt" <<'JS' || status=$?
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { comparePuzzleRuns } from './scripts/puzzle-performance.mjs';
try {
  const reports = process.argv[2];
  const load = (version) => [1, 2, 3].map((run) =>
    JSON.parse(readFileSync(`${reports}/${version}-${run}.json`, 'utf8')));
  const pendingFile = `${reports}/pending.json`;
  const expected = existsSync(pendingFile) ? JSON.parse(readFileSync(pendingFile, 'utf8')) : undefined;
  const results = comparePuzzleRuns(load('master'), load('new'), expected);
  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.puzzle} (attempt ${process.argv[3]}/5): fastest new ${result.newMs.toFixed(3)} ms, slowest master ${result.masterMs.toFixed(3)} ms`);
  }
  const pending = results.filter((result) => !result.passed).map((result) => result.puzzle);
  writeFileSync(pendingFile, JSON.stringify(pending));
  process.exitCode = pending.length === 0 ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 2;
}
JS
  if [[ "$status" == 0 ]]; then exit 0; fi
  if [[ "$status" != 1 ]]; then exit "$status"; fi
  if [[ "$attempt" != 5 ]]; then
    echo 'Possible performance regression; repeating only failing puzzles with fresh samples.'
  fi
done

echo 'Performance regression confirmed after five attempts for the remaining puzzles.' >&2
exit 1
