import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { slugify } from '../src/index';

// Reads fixtures/title.json relative to this package's directory; no browser fixture.
test.describe('title', () => {
  test('slugs the title of the package fixture', () => {
    const { title, slug } = JSON.parse(readFileSync('fixtures/title.json', 'utf8'));
    expect(slugify(title)).toBe(slug);
  });
});
