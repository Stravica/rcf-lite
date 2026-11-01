import { describe, it, expect } from 'vitest';
import { applyDiscount } from '../src/index';

describe('cart', () => {
  it('applies a percentage discount', () => {
    expect(applyDiscount(200, 10)).toBe(180);
  });
});
