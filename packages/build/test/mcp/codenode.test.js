// Phase 10 (X2 CodeNode bridge, D18) MCP adapter tests: the CN kind
// through rcf_create, --to-code on rcf_trace / rcf_impact, path-mode on
// rcf_trace, --with-code on rcf_coverage, --no-code on rcf_validate.
// In-process registry, no protocol framing (mirrors test/mcp/tools.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { createToolRegistry } from '../../src/mcp/tools.js';

const silentLog = { info: () => {}, error: () => {} };

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-mcp-cn-'));
  await initProject({ projectRoot: tmp, projectName: 'McpCnTest' });
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  return tmp;
}

function registryFor(projectRoot) {
  return createToolRegistry({ projectRoot, log: silentLog });
}

test('rcf_create with kind cn requires no parent, writes a Code Node', async () => {
  const registry = registryFor(await scaffold());
  const result = await registry.call('rcf_create', {
    kind: 'cn', path: 'src/save.js#save', acIds: ['AC-101-1'],
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.id, 'CN-001');
  const read = await registry.call('rcf_read', { id: 'CN-001' });
  assert.deepEqual(read.structuredContent.value.implementsAcIds, ['AC-101-1']);
});

test('rcf_create cn without path is a usage error', async () => {
  const registry = registryFor(await scaffold());
  const result = await registry.call('rcf_create', { kind: 'cn' });
  assert.equal(result.isError, true);
  assert.match(result.structuredContent.errors[0].message, /path is required/);
});

test('rcf_trace resolves a source path to its CN and traces backward', async () => {
  const registry = registryFor(await scaffold());
  await registry.call('rcf_create', { kind: 'cn', path: 'src/save.js#save', acIds: ['AC-101-1'] });
  const result = await registry.call('rcf_trace', { id: 'src/save.js#save' });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.pivot, 'CN-001');
  const ids = result.structuredContent.nodes.map((n) => n.id);
  assert.ok(ids.includes('AC-101-1'));
  assert.ok(ids.includes('PRD-001'));
});

test('rcf_trace toCode reaches the implementing CN; omitted it does not (byte-identical default)', async () => {
  const registry = registryFor(await scaffold());
  await registry.call('rcf_create', { kind: 'cn', path: 'src/save.js#save', acIds: ['AC-101-1'] });
  const withCode = await registry.call('rcf_trace', { id: 'AC-101-1', direction: 'forward', toCode: true });
  assert.ok(withCode.structuredContent.nodes.some((n) => n.id === 'CN-001'));
  const without = await registry.call('rcf_trace', { id: 'AC-101-1', direction: 'forward' });
  assert.ok(!without.structuredContent.nodes.some((n) => n.id === 'CN-001'));
});

test('rcf_impact toCode labels the CN descendant re-verify-code', async () => {
  const registry = registryFor(await scaffold());
  await registry.call('rcf_create', { kind: 'cn', path: 'src/save.js#save', acIds: ['AC-101-1'] });
  const result = await registry.call('rcf_impact', { id: 'AC-101-1', toCode: true });
  const cnNode = result.structuredContent.nodes.find((n) => n.id === 'CN-001');
  assert.equal(cnNode.actionNeeded, 're-verify-code');
});

test('rcf_coverage withCode reports codeClass and codeNodeOrphans, never errors', async () => {
  const registry = registryFor(await scaffold());
  await registry.call('rcf_create', { kind: 'cn', path: 'src/save.js#save', acIds: ['AC-101-1'] });
  await registry.call('rcf_create', { kind: 'cn', path: 'src/orphan.js' });
  const result = await registry.call('rcf_coverage', { withCode: true });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.withCode, true);
  assert.deepEqual(result.structuredContent.codeNodeOrphans, ['CN-002']);
});

test('rcf_validate reports staleCode by default; noCode skips the pass', async () => {
  const registry = registryFor(await scaffold());
  await registry.call('rcf_create', { kind: 'cn', path: 'src/does-not-exist.js' });
  const stale = await registry.call('rcf_validate', {});
  assert.equal(stale.structuredContent.ok, false);
  assert.ok(stale.structuredContent.issues.some((i) => i.kind === 'staleCode'));
  const skipped = await registry.call('rcf_validate', { noCode: true });
  assert.equal(skipped.structuredContent.ok, true);
});
