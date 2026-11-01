import { describe, it, expect } from 'vitest';
import { slugify } from '../src/index';

describe('slug', () => {
  it('joins the words of a title with hyphens', () => {
    expect(slugify('Ship It Today')).toBe('ship-it-today');
  });
});
