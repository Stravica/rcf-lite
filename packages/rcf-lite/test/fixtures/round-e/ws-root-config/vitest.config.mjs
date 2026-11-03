import { defineConfig } from 'vitest/config';

// The rcf project root's vitest config: the nested package's checks are
// collected through this include alone (no default test file name).
export default defineConfig({
  test: { include: ['apps/*/checks/**/*.check.mjs'] },
});
