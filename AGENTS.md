## STRICT REQUIREMENTS

This repository enforces strict 100% code coverage rule in lines, functions and branches. No exceptions.

ALWAYS follow red green blue test driven development.

Before you are done you MUST ensure `npm run coverage` passes.

## RECOMMENDATIONS

Avoid mocks when testing logic.

## Playwright E2E Tests

### Run
```bash
npx playwright install firefox --with-deps  # first time only
npm run test:e2e
```