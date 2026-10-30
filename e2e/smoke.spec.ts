import { expect, test } from '@playwright/test';
import { mockServices } from './fixtures';

const VALUE = /\d+\.\d °C/;

test.describe('English', () => {
  test.use({ locale: 'en-US' });

  test('shows the felt temperature, ventilation advice, and works offline', async ({
    page,
    context,
  }) => {
    await mockServices(context);
    await page.goto('./');
    await expect(page.locator('.ap-val')).toHaveText(VALUE);
    await expect(page.locator('.geo-chip')).toContainText('Teststadt');
    await expect(page.getByRole('img', { name: /day forecast/ })).toBeVisible();

    await page.getByRole('button', { name: 'Ventilate', exact: true }).click();
    await expect(page.locator('.vh-verdict')).not.toBeEmpty();
    await expect(page.locator('.vt-cell')).toHaveCount(24);

    // Offline: app shell from the service worker, data from the IndexedDB cache.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'Feels like', exact: true }).click();
    await expect(page.locator('.ap-val')).toHaveText(VALUE);
  });

  test('searching pins a place', async ({ page, context }) => {
    await mockServices(context);
    await page.goto('./');
    await expect(page.locator('.ap-val')).toHaveText(VALUE);
    await page.locator('.geo-chip').click();
    await page.getByRole('searchbox').fill('München');
    await page.keyboard.press('Enter');
    await expect(page.locator('.geo-chip')).toContainText('📍 München');
  });
});

test.describe('German', () => {
  test.use({ locale: 'de-DE' });

  test('uses the German catalogue', async ({ page, context }) => {
    await mockServices(context);
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('button', { name: 'Gefühlt', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lüften', exact: true }).click();
    await expect(page.locator('.section-name', { hasText: /^Außen$/ })).toBeVisible();
  });
});
