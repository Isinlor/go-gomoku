import { expect, test } from '@playwright/test';

test.describe('GoGomoku gameplay', () => {
  test('covers toolbar, board interactions, load game, and copy URL', async ({ page }) => {
    await page.addInitScript(() => {
      const win = window as Window & { __copiedText?: string };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            win.__copiedText = text;
          },
        },
      });
    });

    await page.goto('/');
    await expect(page.locator('#status')).toBeVisible();

    await page.locator('input[name="white-mode"][value="human"]').check();
    await expect(page.locator('#status')).toContainText(/black to move/i);

    const board = page.getByLabel('GoGomoku board');
    const cells = board.getByRole('button');
    await expect(cells).toHaveCount(81);

    await cells.nth(0).click();
    await expect(page.locator('#status')).toContainText(/white to move/i);
    await expect(page.locator('#game-record')).toHaveValue(/^[A-Za-z0-9]+/);

    await cells.nth(1).click();
    await expect(page.locator('#status')).toContainText(/black to move/i);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#status')).toContainText(/white to move/i);

    await page.getByLabel('Board size').selectOption('11');
    await page.getByRole('button', { name: 'New game' }).click();
    await expect(board.getByRole('button')).toHaveCount(121);
    await expect(page.locator('#status')).toContainText(/black to move/i);

    await page.locator('#load-input').fill('B11 f6 g6 h6');
    await page.getByRole('button', { name: 'Load game' }).click();
    await expect(page.locator('#load-error')).toHaveText('');
    await expect(page.locator('#game-record')).toHaveValue('B11 f6 g6 h6');

    await page.locator('#load-input').fill('not-a-valid-record');
    await page.getByRole('button', { name: 'Load game' }).click();
    await expect(page.locator('#load-error')).not.toHaveText('');

    await page.getByRole('button', { name: 'Copy URL' }).click();
    await expect.poll(async () => page.evaluate(() => (window as Window & { __copiedText?: string }).__copiedText ?? '')).toMatch(/^http/);
  });

  test('captures visible game screenshot', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[name="white-mode"][value="human"]').check();

    const cells = page.getByLabel('GoGomoku board').getByRole('button');
    await cells.nth(0).click();
    await cells.nth(10).click();

    await page.screenshot({ path: 'test-results/game-page-visible.png', fullPage: true });
  });
});
