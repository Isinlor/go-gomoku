import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/** Set both players to Human so AI doesn't interfere with manual clicks. */
async function setBothHuman(page: import('@playwright/test').Page) {
  await page.locator('input[name="white-mode"][value="human"]').check();
}

test.describe('GoGomoku App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.board');
  });

  test('page loads with title and all UI sections', async ({ page }) => {
    await expect(page).toHaveTitle('GoGomoku Demo');
    await expect(page.locator('.player-fieldset')).toHaveCount(2);
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('#status')).toBeVisible();
    await expect(page.locator('#game-record')).toBeVisible();
    await expect(page.getByText('Copy URL')).toBeVisible();
    await expect(page.locator('#load-input')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load game' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('default board is 9x9 with 81 cells', async ({ page }) => {
    const cells = page.locator('.board .cell');
    await expect(cells).toHaveCount(81);
  });

  test('play a move by clicking an empty cell', async ({ page }) => {
    await setBothHuman(page);
    await expect(page.locator('#status')).toContainText('black');

    const cells = page.locator('.board .cell');
    await cells.nth(40).click();

    await expect(cells.nth(40)).toHaveClass(/stone-black/);
    await expect(page.locator('#status')).toContainText('white');
    await expect(page.locator('#game-record')).toHaveValue(/e5/);
  });

  test('play two moves and undo', async ({ page }) => {
    await setBothHuman(page);
    const cells = page.locator('.board .cell');

    await cells.nth(40).click(); // Black at e5
    await expect(cells.nth(40)).toHaveClass(/stone-black/);

    await cells.nth(41).click(); // White at f5
    await expect(cells.nth(41)).toHaveClass(/stone-white/);

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect(cells.nth(41)).not.toHaveClass(/stone-white/);
    await expect(page.locator('#status')).toContainText('white');
  });

  test('new game resets the board', async ({ page }) => {
    await setBothHuman(page);
    const cells = page.locator('.board .cell');

    await cells.nth(40).click();
    await expect(cells.nth(40)).toHaveClass(/stone-black/);

    await page.getByRole('button', { name: 'New game' }).click();

    await expect(cells.nth(40)).not.toHaveClass(/stone-black/);
    await expect(page.locator('#status')).toContainText('black');
    await expect(page.locator('#game-record')).toHaveValue(/B9/);
  });

  test('change board size to 13x13', async ({ page }) => {
    await setBothHuman(page);
    const sizeSelect = page.locator('.board-size-select');
    await sizeSelect.selectOption('13');

    // Size takes effect on new game
    await page.getByRole('button', { name: 'New game' }).click();

    const cells = page.locator('.board .cell');
    await expect(cells).toHaveCount(169);
  });

  test('change board size to 11x11', async ({ page }) => {
    await setBothHuman(page);
    const sizeSelect = page.locator('.board-size-select');
    await sizeSelect.selectOption('11');

    await page.getByRole('button', { name: 'New game' }).click();

    const cells = page.locator('.board .cell');
    await expect(cells).toHaveCount(121);
  });

  test('load game from text input', async ({ page }) => {
    const loadInput = page.locator('#load-input');
    await loadInput.fill('B9 e5 d4');

    await page.getByRole('button', { name: 'Load game' }).click();

    const cells = page.locator('.board .cell');
    await expect(cells.nth(40)).toHaveClass(/stone-black/);
    await expect(cells.nth(30)).toHaveClass(/stone-white/);
    await expect(page.locator('#game-record')).toHaveValue(/e5/);
  });

  test('load game shows error for invalid input', async ({ page }) => {
    const loadInput = page.locator('#load-input');
    await loadInput.fill('INVALID GARBAGE');

    await page.getByRole('button', { name: 'Load game' }).click();

    await expect(page.locator('#load-error')).not.toBeEmpty();
  });

  test('player mode radio buttons work', async ({ page }) => {
    const blackHuman = page.locator('input[name="black-mode"][value="human"]');
    const blackAI = page.locator('input[name="black-mode"][value="ai"]');

    await expect(blackHuman).toBeChecked();
    await expect(blackAI).not.toBeChecked();

    const whiteHuman = page.locator('input[name="white-mode"][value="human"]');
    const whiteAI = page.locator('input[name="white-mode"][value="ai"]');

    await expect(whiteHuman).not.toBeChecked();
    await expect(whiteAI).toBeChecked();
  });

  test('occupied cell is disabled and cannot be clicked twice', async ({ page }) => {
    await setBothHuman(page);
    const cells = page.locator('.board .cell');
    await cells.nth(40).click();
    await expect(cells.nth(40)).toBeDisabled();
  });

  test('screenshot of game page with game visible', async ({ page }) => {
    await setBothHuman(page);
    const cells = page.locator('.board .cell');

    // Play several moves to make the board interesting
    await cells.nth(40).click(); // Black e5
    await cells.nth(41).click(); // White f5
    await cells.nth(31).click(); // Black d4
    await cells.nth(32).click(); // White e4
    await cells.nth(22).click(); // Black c3

    await page.waitForTimeout(200);

    // Take screenshot
    const screenshotDir = path.resolve('e2e/screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, 'game-board.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    expect(fs.existsSync(screenshotPath)).toBe(true);

    // Embed in GitHub Step Summary if running in CI
    if (process.env.GITHUB_STEP_SUMMARY) {
      const base64 = fs.readFileSync(screenshotPath).toString('base64');
      const summary = `## GoGomoku Playwright Test Screenshot\n\n<img src="data:image/png;base64,${base64}" alt="Game Board Screenshot" width="800" />\n`;
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }
  });

  test('URL hash updates with game state', async ({ page }) => {
    await setBothHuman(page);
    const cells = page.locator('.board .cell');
    await cells.nth(40).click();

    const url = page.url();
    expect(url).toContain('#');
  });

  test('AI vs AI game starts automatically when both set to AI', async ({ page }) => {
    const blackAI = page.locator('input[name="black-mode"][value="ai"]');
    await blackAI.check();

    // Wait for AI to make at least one move
    await expect(page.locator('.stone-black')).toBeVisible({ timeout: 10000 });
  });
});
