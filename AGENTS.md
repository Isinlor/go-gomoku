## STRICT REQUIREMENTS

This repository enforces strict 100% code coverage rule in lines, functions and branches. No exceptions.

Always follow red green blue test driven development.

Before you are done you MUST ensure `npm run coverage` passes.

## Playwright (very short)

- Run E2E in Firefox: `npm run test:e2e`.
- Stability/idempotence check is mandatory: run it twice in a row.
- For full validation run twice each: `npm run coverage && npm run coverage && npm run test:e2e && npm run test:e2e`.
- Add new Playwright tests in `playwright-tests/*.spec.ts` and keep Firefox as default project.
- Any new/updated Playwright suite must pass twice consecutively before completion.
