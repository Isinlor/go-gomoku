## STRICT REQUIREMENTS

This repository enforces strict 100% code coverage rule in lines, functions and branches. No exceptions.

Always follow red green blue test driven development.

Before you are done you MUST ensure `npm run coverage` passes.

## Playwright E2E Tests

### Run
```bash
npx playwright install firefox --with-deps  # first time only
npm run test:e2e
```

### Add new tests
1. Add tests to `e2e/gomoku.spec.ts` (or create new `.spec.ts` files in `e2e/`)
2. Use `setBothHuman(page)` helper before manually clicking cells (White defaults to AI)
3. Status text uses lowercase: `"black to move"`, `"white to move"`
4. Board size changes require clicking "New game" to take effect
5. Run `npm run test:e2e` twice to verify stability