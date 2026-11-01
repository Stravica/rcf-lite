import { defineConfig } from 'vitest/config';

// Only the in-process specs. The browser spec under tests/rcf/ui/ belongs to Playwright.
export default defineConfig({
  test: {
    include: ['tests/rcf/unit/**/*.spec.ts'],
  },
});
