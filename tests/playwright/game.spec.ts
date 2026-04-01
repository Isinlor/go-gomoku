import { expect, test } from '@playwright/test';

test.describe('GoGomoku app', () => {
  test('supports gameplay, controls, load, and screenshot capture', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => {} },
        configurable: true,
      });
    });

    await page.goto('/');

    await expect(page.getByText('Black to move')).toBeVisible();

    // Switch white to human so we can play both sides.
    await page.locator('input[name="white-mode"][value="human"]').check();

    const boardCells = page.locator('.board .cell');
    await expect(boardCells).toHaveCount(81);

    // Play two legal moves.
    await boardCells.nth(0).click();
    await expect(page.getByText('White to move')).toBeVisible();
    await boardCells.nth(1).click();
    await expect(page.getByText('Black to move')).toBeVisible();

    // Undo should revert latest move.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(boardCells.nth(1)).toBeEnabled();

    // New game resets board state.
    await page.getByRole('button', { name: 'New game' }).click();
    await expect(boardCells.nth(0)).toBeEnabled();

    // Change board size.
    await page.getByLabel('Board size').selectOption('11');
    await page.getByRole('button', { name: 'New game' }).click();
    await expect(page.locator('.board .cell')).toHaveCount(121);

    // Load a game record.
    await page.getByLabel('Load game').fill('B9 e5 d5 e6');
    await page.getByRole('button', { name: 'Load game' }).click();
    await expect(page.locator('#load-error')).toHaveText('');
    await expect(page.getByLabel('Game record in move notation')).toHaveValue('B9 e5 d5 e6');

    // Invalid load should show an error.
    await page.getByLabel('Load game').fill('invalid-record');
    await page.getByRole('button', { name: 'Load game' }).click();
    await expect(page.locator('#load-error')).not.toHaveText('');

    // Copy URL should be clickable and not crash.
    await page.getByRole('button', { name: 'Copy URL' }).click();

    // Capture screenshot with game visible.
    await page.screenshot({ path: 'test-results/game-page.png', fullPage: true });
  });
});
