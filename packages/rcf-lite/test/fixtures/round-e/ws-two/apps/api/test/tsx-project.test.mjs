import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run by a nodeTest runners entry with "cwd": "project", whose argv starts
// with a bare tsx; the import is relative to this file, so any cwd runs it.
test('P1 clampPort keeps a port in range at the rcf project root', async () => {
  const { clampPort } = await import('../src/index.js');
  assert.equal(clampPort(8080), 8080);
  assert.equal(clampPort(0), 80);
});
