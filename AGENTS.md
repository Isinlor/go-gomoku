## STRICT REQUIREMENTS

This repository enforces strict 100% code coverage rule in lines, functions and branches. No exceptions.

Always follow red green blue test driven development.

Before you are done you MUST ensure `npm run coverage` passes.

## Playwright (very short)

- Default browser is Firefox. Run: `npm run e2e`.
- Stability/idempotence rule: run E2E twice in a row every time.
- CI workflow: `.github/workflows/playwright.yml`.
- Add new E2E tests in `tests/playwright/*.spec.ts`.
- When adding tests, keep them deterministic and run them twice in a row before finishing.
