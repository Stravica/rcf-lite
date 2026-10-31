import { test, expect } from '@playwright/test';
import { slugify } from '../src/index';

test.describe('slug', () => {
  test('slugs a title', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
});
