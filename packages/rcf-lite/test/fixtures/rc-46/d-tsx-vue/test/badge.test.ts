import { describe, it, expect } from 'vitest';
import { Badge } from '../src/index';

describe('badge', () => {
  it('caps the label at 99+', () => {
    expect(Badge({ count: 120 })).toBe('<span>99+</span>');
  });
});
