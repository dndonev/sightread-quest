import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page) {
  await page.goto('/');
  await expect(page.getByText('What do you play?')).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page.getByText('Daily Training')).toBeVisible();
}

test('onboarding, note hunter answer and persistence', async ({ page }) => {
  await onboard(page);
  await page.goto('/#/notes?level=1&mode=practice');
  await page.getByRole('button', { name: 'Start' }).click();
  // Real notation is rendered as SVG by VexFlow
  await expect(page.locator('.notation svg').first()).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'E', exact: true }).click();
    await expect(page.getByText(/Correct|Not quite/)).toBeVisible();
    const next = page.getByRole('button', { name: 'Next' });
    if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(450);
  }
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByText('Session complete')).toBeVisible();
  await page.reload();
  await page.goto('/#/stats');
  await expect(page.getByText('1 sessions')).toBeVisible();
});

test('chord decoder renders a chord with four options', async ({ page }) => {
  await onboard(page);
  await page.goto('/#/chords?level=6&mode=name');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.notation svg')).toBeVisible();
  const options = page.locator('.grid.grid-cols-2 > button');
  await expect(options).toHaveCount(4);
  await options.first().click();
  await expect(page.getByText(/Correct|Not quite/)).toBeVisible();
});

test('sight-reading phrase runs to a review', async ({ page }) => {
  await onboard(page);
  await page.goto('/#/reading?level=1&mode=identify');
  await page.getByLabel('Tempo').first().fill('200');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.getByText(/named correctly/)).toBeVisible({ timeout: 15_000 });
});

test('no horizontal overflow on a phone', async ({ page }) => {
  await onboard(page);
  for (const route of ['/#/home', '/#/levels?stage=reading', '/#/reading?level=9&mode=perform', '/#/settings', '/#/stats', '/#/lab']) {
    await page.goto(route);
    await page.waitForTimeout(300);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, route).toBeLessThanOrEqual(iw);
  }
});

test('installable PWA manifest and service worker', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  await page.goto('/');
  const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.ready));
  expect(sw).toBe(true);
});
