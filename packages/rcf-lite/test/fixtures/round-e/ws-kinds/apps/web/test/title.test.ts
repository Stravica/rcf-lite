import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { slugify } from '../src/index';

// Reads fixtures/title.json relative to this package's directory.
describe('title', () => {
  it('slugs the title of the package fixture', () => {
    const { title, slug } = JSON.parse(readFileSync('fixtures/title.json', 'utf8'));
    expect(slugify(title)).toBe(slug);
  });
});
