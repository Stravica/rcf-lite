import { expect, test } from '@playwright/test';

test('AC-101-2 the preview page shows the slug of the title a user submits', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Title').fill('Crème Brûlée Recipes, Volume 3');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('output#slug')).toHaveText('creme-brulee-recipes-volume-3');
  await expect(page.getByLabel('Title')).toHaveValue('Crème Brûlée Recipes, Volume 3');
});

test('AC-101-2 the preview page with nothing submitted shows the nothing-to-preview message', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empty')).toHaveText('Nothing to preview yet.');
  await expect(page.locator('output#slug')).toHaveCount(0);
});
