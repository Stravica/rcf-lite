import { test, expect } from '@playwright/test';
import { slugify } from '../src/index';

test.describe('slug', () => {
  test('renders the slug of a title', async ({ page }) => {
    await page.setContent(`<h1 id="s">${slugify('Hello World')}</h1>`);
    await expect(page.locator('#s')).toHaveText('hello-world');
  });
});
