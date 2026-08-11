// B5 MCP regression: the write tools share the writer's post-write gate,
// so the p2-opus wedge (malformed TS-003 wedging every mutation) is
// escapable over MCP exactly as over the CLI: repair-update and delete
// of the offending doc succeed; net-new breakage still errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';
import { createToolRegistry } from '../../src/mcp/tools.js';

const silentLog = { info: () => {}, error: () => {} };

const MALFORMED_TS_003 = {
  id: 'TS-003',
  usId: 'US-101',
  title: 'Wedged suite',
  purpose: 'Reproduces the p2-opus wedge',
  testLevel: 'unit',
  acIds: ['AC-101-1'],
  testCases: [],
  status: 'NOT-A-STATUS',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

async function scaffoldWedge() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-b5-mcp-'));
  await initProject({ projectRoot: tmp, projectName: 'B5McpTest' });
  await writeFile(
    join(tmp, 'rcf/test-suites/ts-003.json'),
    `${JSON.stringify(MALFORMED_TS_003, null, 2)}\n`,
    'utf8',
  );
  return tmp;
}

test('rcf_update repairs the wedged doc, rcf_validate confirms the heal', async () => {
  const tmp = await scaffoldWedge();
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const before = await registry.call('rcf_validate', {});
  assert.equal(before.structuredContent.ok, false);
  const repair = await registry.call('rcf_update', {
    id: 'TS-003',
    sets: [{ path: 'status', value: 'draft' }],
  });
  assert.equal(repair.isError, undefined, JSON.stringify(repair.structuredContent));
  assert.equal(repair.structuredContent.ok, true);
  const after = await registry.call('rcf_validate', {});
  assert.equal(after.structuredContent.ok, true);
});

test('rcf_delete removes the wedged doc, rcf_validate confirms the heal', async () => {
  const tmp = await scaffoldWedge();
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const del = await registry.call('rcf_delete', { id: 'TS-003' });
  assert.equal(del.isError, undefined, JSON.stringify(del.structuredContent));
  assert.deepEqual(del.structuredContent.deleted, ['TS-003']);
  const after = await registry.call('rcf_validate', {});
  assert.equal(after.structuredContent.ok, true);
});

test('rcf_create of an unrelated doc proceeds on the wedged tree', async () => {
  const tmp = await scaffoldWedge();
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const created = await registry.call('rcf_create', {
    kind: 'req', parent: 'PRD-001', title: 'Written while wedged',
  });
  assert.equal(created.isError, undefined, JSON.stringify(created.structuredContent));
  assert.equal(created.structuredContent.id, 'REQ-002');
});

test('net-new breakage on the wedged tree still errors with the postWriteValidation rule', async () => {
  const tmp = await scaffoldWedge();
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const bad = await registry.call('rcf_update', {
    id: 'US-101',
    patch: { acceptanceCriteria: [{ id: 'AC-101-2', description: 'replaced', testable: true }] },
  });
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.errors[0].rule, 'postWriteValidation');
});
