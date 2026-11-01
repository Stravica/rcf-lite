import { describe, it, expect } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { Counter } from '../src/index';

describe('counter', () => {
  it('clamps the start value to ten', async () => {
    const html = await renderToString(createSSRApp(Counter, { start: 42 }));
    expect(html).toContain('>10<');
  });
});
