import { expect, test } from 'vitest';

// Run by a vitest runners entry; vitest sits in the repository root's
// node_modules/.bin alone, nothing of it in this package.
test('V1 clampPort keeps a port in range', async () => {
  const { clampPort } = await import('../src/index.js');
  expect(clampPort(8080)).toBe(8080);
  expect(clampPort(0)).toBe(80);
});
