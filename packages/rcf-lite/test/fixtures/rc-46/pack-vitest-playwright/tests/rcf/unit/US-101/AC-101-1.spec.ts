import { describe, expect, it } from 'vitest';

import { isSlug, slugify } from '../../../../src/slug.ts';

describe('AC-101-1: a slug holds only lower-case letters and digits joined by single hyphens and is cut back to a whole word at the limit', () => {
  it('TC-001: spaces and punctuation become single hyphens with none at either end', () => {
    expect(slugify('  Hello,   World!  ')).toBe('hello-world');
    expect(slugify('--a__b..c--')).toBe('a-b-c');
  });

  it('TC-002: accented letters fold to their base letters', () => {
    expect(slugify('Crème Brûlée Déjà Vu')).toBe('creme-brulee-deja-vu');
  });

  it('TC-003: text with no letters or digits gives the empty string', () => {
    expect(slugify('!!! ??? ...')).toBe('');
  });

  it('TC-004: a slug over the limit is cut back to the last whole word', () => {
    expect(slugify('alpha beta gamma delta', { maxLength: 13 })).toBe('alpha-beta');
    expect(slugify('alpha beta gamma', { maxLength: 10 })).toBe('alpha-beta');
    expect(slugify('abcdefghijklmnop', { maxLength: 5 })).toBe('abcde');
  });

  it('TC-005: the default limit is 60 characters', () => {
    const slug = slugify('word '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('word')).toBe(true);
    expect(slug).toBe(Array.from({ length: 12 }, () => 'word').join('-'));
  });

  it('TC-006: a limit that is not a positive integer is refused', () => {
    expect(() => slugify('a', { maxLength: 0 })).toThrow(RangeError);
    expect(() => slugify('a', { maxLength: 2.5 })).toThrow(RangeError);
  });

  it('TC-007: isSlug accepts exactly the slug form', () => {
    expect(isSlug('hello-world-2')).toBe(true);
    expect(isSlug('hello')).toBe(true);
    expect(isSlug('Hello-World')).toBe(false);
    expect(isSlug('-hello')).toBe(false);
    expect(isSlug('hello--world')).toBe(false);
    expect(isSlug('')).toBe(false);
    expect(isSlug(slugify('Any Title At All'))).toBe(true);
  });
});
