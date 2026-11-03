import { describe, it, expect } from 'vitest';
import { slugify } from '../src/index.js';

// Collected only through the vitest config at the rcf project root, whose
// include names apps/*/checks/**/*.check.mjs.
describe('title', () => {
  it('slugs a title', () => {
    expect(slugify('Ship It Today')).toBe('ship-it-today');
  });
});
