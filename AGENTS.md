## STRICT REQUIREMENTS

This repository enforces strict 100% code coverage rule in lines, functions and branches. No exceptions.

ALWAYS follow red green blue test driven development. You MUST write tests BEFORE.

Before you are done you MUST ensure `npm run coverage` passes.

## RECOMMENDATIONS

Avoid mocks when testing logic.

Do not add spurious tests. Keep tests fast.

## Playwright E2E Tests

### Run
```bash
npx playwright install firefox --with-deps  # first time only
npm run test:e2e
```

## New dependencies
New dependencies - languages, libraries - can be introduced only on explicit request.

## README

Any additions to README must be very carefully considered and concise. No long tirades are allowed.

## Continuous integration

When you start always make sure you working with the latest `master` branch.

## Benchmark changes (performance, strength)

Unless specifically asked you are not allowed to change benchmarks. You can make suggestions.

## Result artifacts

Avoid adding results to the repo unless asked or the results are the main deliverable. Prefer to summarize results in pr description.
