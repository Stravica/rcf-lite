// Tool registry tests (Phase 7 §D5-D9, §D17, §D20 unit layer):
// definition shape rules, argument validation, and handler dispatch
// per tool against a scaffolded temp project. In-process - no
// subprocess, no protocol framing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { createToolRegistry, validateToolArgs } from '../../src/mcp/tools.js';
import { JsonRpcError } from '../../src/mcp/server.js';

const silentLog = { info: () => {}, error: () => {} };

const EXPECTED_NAMES = [
  'rcf_validate', 'rcf_coverage', 'rcf_trace', 'rcf_impact', 'rcf_read',
  'rcf_create', 'rcf_update', 'rcf_delete', 'rcf_link', 'rcf_unlink',
  'rcf_build',
];

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-mcp-tools-'));
  await initProject({ projectRoot: tmp, projectName: 'McpToolsTest' });
  return tmp;
}

function registryFor(projectRoot) {
  return createToolRegistry({ projectRoot, log: silentLog });
}

async function breakTree(tmp) {
  const reqPath = join(tmp, 'rcf/requirements/req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
}

// ---------------------------------------------------------------------------
// Registry shape (D5-D7, D17)
// ---------------------------------------------------------------------------

test('registry: exactly the eleven specced tools, in order', async () => {
  const registry = registryFor(await scaffold());
  assert.deepEqual(registry.definitions.map((d) => d.name), EXPECTED_NAMES);
});

test('registry: names are rcf_-prefixed, lowercase, within the MCP character guidance', async () => {
  const registry = registryFor(await scaffold());
  for (const d of registry.definitions) {
    assert.match(d.name, /^rcf_[a-z_]+$/, d.name);
    assert.ok(d.name.length >= 1 && d.name.length <= 128);
  }
});

test('registry: every inputSchema is a closed object with no $schema field and camelCase properties', async () => {
  const registry = registryFor(await scaffold());
  for (const d of registry.definitions) {
    assert.equal(d.inputSchema.type, 'object', d.name);
    assert.equal(d.inputSchema.additionalProperties, false, `${d.name} must be closed`);
    assert.equal('$schema' in d.inputSchema, false, `${d.name}: 2020-12 is the default, no $schema emitted`);
    for (const prop of Object.keys(d.inputSchema.properties ?? {})) {
      assert.match(prop, /^[a-z][a-zA-Z0-9]*$/, `${d.name}.${prop} must be camelCase`);
    }
    for (const req of d.inputSchema.required ?? []) {
      assert.ok(req in (d.inputSchema.properties ?? {}), `${d.name}: required ${req} declared`);
    }
  }
});

test('registry: every tool carries title, description and an outputSchema object', async () => {
  const registry = registryFor(await scaffold());
  for (const d of registry.definitions) {
    assert.equal(typeof d.title, 'string', d.name);
    assert.ok(d.description.length > 40, `${d.name} description leads with what it answers`);
    assert.equal(typeof d.outputSchema, 'object', d.name);
    assert.equal(d.outputSchema.type, 'object', d.name);
  }
});

test('registry: D17 annotations - readOnly on reads, destructive + idempotent on delete, idempotent on link verbs', async () => {
  const registry = registryFor(await scaffold());
  const byName = new Map(registry.definitions.map((d) => [d.name, d]));
  for (const name of ['rcf_validate', 'rcf_coverage', 'rcf_trace', 'rcf_impact', 'rcf_read', 'rcf_build']) {
    assert.equal(byName.get(name).annotations.readOnlyHint, true, name);
  }
  assert.equal(byName.get('rcf_delete').annotations.destructiveHint, true);
  assert.equal(byName.get('rcf_delete').annotations.idempotentHint, true);
  assert.equal(byName.get('rcf_link').annotations.idempotentHint, true);
  assert.equal(byName.get('rcf_unlink').annotations.idempotentHint, true);
  assert.equal(byName.get('rcf_create').annotations.destructiveHint, false);
  assert.equal(byName.get('rcf_update').annotations.destructiveHint, false);
});

test('registry: rcf_build inputSchema addresses fbsId only - no strict, no mark, no next (reconciliation carries 1+2)', async () => {
  const registry = registryFor(await scaffold());
  const build = registry.definitions.find((d) => d.name === 'rcf_build');
  assert.deepEqual(Object.keys(build.inputSchema.properties), ['fbsId']);
  assert.deepEqual(build.inputSchema.required, ['fbsId']);
  assert.equal('strict' in build.inputSchema.properties, false);
});

test('registry: coverage description states the mechanical-not-semantic boundary and the strict-gaps divergence', async () => {
  const registry = registryFor(await scaffold());
  const coverage = registry.definitions.find((d) => d.name === 'rcf_coverage');
  assert.match(coverage.description, /mechanical/i);
  assert.match(coverage.description, /data/);
});

// ---------------------------------------------------------------------------
// Argument validation (D7 pre-dispatch, D10 execution-error mapping)
// ---------------------------------------------------------------------------

test('validateToolArgs: unknown properties, missing required and bad enums are named', () => {
  const schema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      direction: { type: 'string', enum: ['forward', 'back', 'both'] },
    },
    required: ['id'],
    additionalProperties: false,
  };
  assert.deepEqual(validateToolArgs(schema, { id: 'X' }), []);
  assert.match(validateToolArgs(schema, {})[0], /id: required/);
  assert.match(validateToolArgs(schema, { id: 'X', nope: 1 })[0], /unknown property/);
  assert.match(validateToolArgs(schema, { id: 'X', direction: 'sideways' })[0], /forward \| back \| both/);
  assert.match(validateToolArgs(schema, { id: 42 })[0], /expected string/);
});

test('call: schema-invalid arguments are a tool execution error, not a protocol error', async () => {
  const registry = registryFor(await scaffold());
  const result = await registry.call('rcf_trace', { id: 'REQ-001', direction: 'sideways' });
  assert.equal(result.isError, true);
  assert.match(result.structuredContent.errors[0].message, /invalid arguments/);
});

test('call: unknown tool name throws the -32602 protocol error (spec-mandated)', async () => {
  const registry = registryFor(await scaffold());
  await assert.rejects(
    () => registry.call('rcf_nonexistent', {}),
    (err) => err instanceof JsonRpcError && err.code === -32602,
  );
});

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

test('rcf_validate: clean tree returns {ok: true, issues: []} with no isError', async () => {
  const registry = registryFor(await scaffold());
  const result = await registry.call('rcf_validate', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { ok: true, issues: [] });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test('rcf_validate: broken tree returns issues as data, NOT an error (D10 row)', async () => {
  const tmp = await scaffold();
  await breakTree(tmp);
  const result = await registryFor(tmp).call('rcf_validate', {});
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.ok, false);
  assert.ok(result.structuredContent.issues.length > 0);
  assert.equal(result.structuredContent.issues[0].kind, 'brokenReference');
});

test('rcf_coverage: envelope is the D15 CoverageResult; strict gaps are data, not error (OQ-P7-8)', async () => {
  const registry = registryFor(await scaffold());
  const shallow = await registry.call('rcf_coverage', {});
  assert.equal(shallow.isError, undefined);
  assert.equal(shallow.structuredContent.strict, false);
  assert.equal(shallow.structuredContent.totals.requirements, 1);
  const strict = await registry.call('rcf_coverage', { strict: true });
  assert.equal(strict.isError, undefined, 'strict gaps must come back as data');
  assert.equal(strict.structuredContent.ok, false);
  assert.equal(strict.structuredContent.strict, true);
});

test('rcf_coverage: below-AC scope and unknown scope are usage execution errors', async () => {
  const registry = registryFor(await scaffold());
  const belowAc = await registry.call('rcf_coverage', { scopeId: 'AC-101-1' });
  assert.equal(belowAc.isError, true);
  assert.match(belowAc.structuredContent.errors[0].message, /below the AC layer/);
  const unknown = await registry.call('rcf_coverage', { scopeId: 'REQ-999' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.structuredContent.errors[0].message, /not found/);
});

test('rcf_trace: known pivot returns the TraceResult envelope; unknown pivot is a usage error', async () => {
  const registry = registryFor(await scaffold());
  const ok = await registry.call('rcf_trace', { id: 'REQ-001' });
  assert.equal(ok.structuredContent.pivot, 'REQ-001');
  assert.equal(ok.structuredContent.direction, 'forward');
  assert.equal(ok.structuredContent.found, true);
  assert.ok(ok.structuredContent.nodes.some((n) => n.id === 'US-101'));
  const both = await registry.call('rcf_trace', { id: 'US-101', direction: 'both' });
  assert.ok(Array.isArray(both.structuredContent.ancestors));
  assert.ok(Array.isArray(both.structuredContent.descendants));
  const missing = await registry.call('rcf_trace', { id: 'REQ-404' });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.errors[0].id, 'REQ-404');
});

test('rcf_impact: returns the labelled fan-out; unknown pivot is a usage error', async () => {
  const registry = registryFor(await scaffold());
  const ok = await registry.call('rcf_impact', { id: 'AC-101-1' });
  assert.equal(ok.structuredContent.found, true);
  const pivot = ok.structuredContent.nodes.find((n) => n.role === 'pivot');
  assert.deepEqual(pivot, { id: 'AC-101-1', kind: 'ac', role: 'pivot', actionNeeded: null });
  const missing = await registry.call('rcf_impact', { id: 'ZZ-1' });
  assert.equal(missing.isError, true);
});

test('rcf_read: whole body, dot-path field, unknown id and missing field', async () => {
  const registry = registryFor(await scaffold());
  const whole = await registry.call('rcf_read', { id: 'US-101' });
  assert.equal(whole.structuredContent.id, 'US-101');
  assert.equal(whole.structuredContent.field, null);
  assert.equal(whole.structuredContent.value.usId, 'US-101');
  const field = await registry.call('rcf_read', { id: 'US-101', field: 'acceptanceCriteria[0].id' });
  assert.equal(field.structuredContent.value, 'AC-101-1');
  const inline = await registry.call('rcf_read', { id: 'AC-101-1' });
  assert.equal(inline.structuredContent.value.id, 'AC-101-1');
  const missing = await registry.call('rcf_read', { id: 'US-999' });
  assert.equal(missing.isError, true);
  const badField = await registry.call('rcf_read', { id: 'US-101', field: 'noSuchField' });
  assert.equal(badField.isError, true);
});

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

test('rcf_create: dryRun reports the intended id / path without writing; real create lands on disk', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const dry = await registry.call('rcf_create', { kind: 'req', parent: 'PRD-001', title: 'Dry req', dryRun: true });
  assert.equal(dry.isError, undefined);
  assert.deepEqual(dry.structuredContent, {
    ok: true, id: 'REQ-002', kind: 'req', filePath: 'rcf/requirements/req-002.json', dryRun: true,
  });
  await assert.rejects(access(join(tmp, 'rcf/requirements/req-002.json')), 'dryRun must not write');
  const real = await registry.call('rcf_create', { kind: 'req', parent: 'PRD-001', title: 'Real req' });
  assert.deepEqual(real.structuredContent, {
    ok: true, id: 'REQ-002', kind: 'req', filePath: 'rcf/requirements/req-002.json',
  });
  const onDisk = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-002.json'), 'utf8'));
  assert.equal(onDisk.title, 'Real req');
});

test('rcf_create: per-kind mandatory fields are usage errors; body object carries extra fields', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const noTitle = await registry.call('rcf_create', { kind: 'req', parent: 'PRD-001' });
  assert.equal(noTitle.isError, true);
  assert.match(noTitle.structuredContent.errors[0].message, /title is required/);
  const noDesc = await registry.call('rcf_create', { kind: 'ac', parent: 'US-101' });
  assert.equal(noDesc.isError, true);
  const tsMissing = await registry.call('rcf_create', { kind: 'ts', parent: 'US-101', title: 'Suite' });
  assert.equal(tsMissing.isError, true);
  const withBody = await registry.call('rcf_create', {
    kind: 'req', parent: 'PRD-001', title: 'With body',
    body: { category: 'functional', priority: 'must' },
  });
  assert.equal(withBody.isError, undefined);
  const onDisk = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-002.json'), 'utf8'));
  assert.equal(onDisk.category, 'functional');
});

test('rcf_update: sets land on disk with changedPaths echoed; JSON values pass with no string re-encoding', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const result = await registry.call('rcf_update', {
    id: 'US-101',
    sets: [{ path: 'title', value: 'Updated title' }, { path: 'acceptanceCriteria[0].testable', value: false }],
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(result.structuredContent.changedPaths, ['title', 'acceptanceCriteria[0].testable']);
  const onDisk = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(onDisk.title, 'Updated title');
  assert.equal(onDisk.acceptanceCriteria[0].testable, false);
});

test('rcf_update: immutable fields refused; empty request refused; dryRun does not write', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const immutable = await registry.call('rcf_update', { id: 'US-101', sets: [{ path: 'createdAt', value: 'now' }] });
  assert.equal(immutable.isError, true);
  assert.match(immutable.structuredContent.errors[0].message, /immutable/);
  const empty = await registry.call('rcf_update', { id: 'US-101' });
  assert.equal(empty.isError, true);
  const before = await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8');
  const dry = await registry.call('rcf_update', { id: 'US-101', sets: [{ path: 'title', value: 'x' }], dryRun: true });
  assert.equal(dry.structuredContent.dryRun, true);
  assert.equal(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'), before);
});

test('rcf_delete: refuses on dependents with the cascade remedy; cascade dryRun returns the plan', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const refused = await registry.call('rcf_delete', { id: 'REQ-001' });
  assert.equal(refused.isError, true);
  assert.match(refused.structuredContent.errors[0].message, /dependents/);
  assert.match(refused.structuredContent.errors[0].message, /cascade: true/);
  const orphaning = await registry.call('rcf_delete', { id: 'US-101', cascade: true, dryRun: true });
  assert.equal(orphaning.isError, true, 'cascade that would orphan FBS acIds is refused');
  assert.equal(orphaning.structuredContent.errors[0].rule, 'wouldOrphan');
  // Clear the AC cross-reference, then the cascade plan is legal.
  const dropFbs = await registry.call('rcf_delete', { id: 'FBS-001' });
  assert.equal(dropFbs.isError, undefined);
  const plan = await registry.call('rcf_delete', { id: 'US-101', cascade: true, dryRun: true });
  assert.equal(plan.isError, undefined);
  assert.equal(plan.structuredContent.dryRun, true);
  assert.ok(plan.structuredContent.plan.length > 0);
  await access(join(tmp, 'rcf/user-stories/us-101.json'));
});

test('rcf_delete: executed delete removes files and reports deleted ids', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const result = await registry.call('rcf_delete', { id: 'ADR-001' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent.deleted, ['ADR-001']);
  await assert.rejects(access(join(tmp, 'rcf/adrs/adr-001.json')));
});

test('rcf_link / rcf_unlink: post-state echoed, idempotent no-op, disk round-trip', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const linked = await registry.call('rcf_link', { usId: 'US-101', tacIds: ['TAC-001'] });
  assert.deepEqual(linked.structuredContent, { ok: true, usId: 'US-101', tacIds: ['TAC-001'] });
  const onDisk = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.deepEqual(onDisk.tacIds, ['TAC-001']);
  const again = await registry.call('rcf_link', { usId: 'US-101', tacIds: ['TAC-001'] });
  assert.deepEqual(again.structuredContent.tacIds, ['TAC-001'], 'idempotent no-op');
  const unlinked = await registry.call('rcf_unlink', { usId: 'US-101', tacIds: ['TAC-001'] });
  assert.deepEqual(unlinked.structuredContent.tacIds, []);
  const badTac = await registry.call('rcf_link', { usId: 'US-101', tacIds: ['TAC-999'] });
  assert.equal(badTac.isError, true);
  assert.equal(badTac.structuredContent.errors[0].kind, 'brokenReference');
});

test('write tools: walker errors block the mutation with the full issue list (D10 row)', async () => {
  const tmp = await scaffold();
  await breakTree(tmp);
  const registry = registryFor(tmp);
  const result = await registry.call('rcf_update', { id: 'US-101', sets: [{ path: 'title', value: 'x' }] });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.errors[0].kind, 'brokenReference');
});

// ---------------------------------------------------------------------------
// rcf_build (reconciliation carries 1-3)
// ---------------------------------------------------------------------------

test('rcf_build: FBS id returns the as-built D14 bundle envelope including bs / prd identity blocks', async () => {
  const registry = registryFor(await scaffold());
  const result = await registry.call('rcf_build', { fbsId: 'FBS-001' });
  assert.equal(result.isError, undefined);
  const envelope = result.structuredContent;
  assert.equal(envelope.ok, true);
  assert.equal(envelope.mode, 'bundle');
  assert.equal(envelope.fbs.fbsId, 'FBS-001');
  assert.equal(envelope.bs.bsId, 'BS-001');
  assert.equal(envelope.prd.prdId, 'PRD-001');
  assert.deepEqual(envelope.blockedBy, []);
  assert.equal(envelope.acceptanceCriteria[0].id, 'AC-101-1');
  assert.equal(envelope.acceptanceCriteria[0].usId, 'US-101');
  assert.equal(envelope.acceptanceCriteria[0].reqId, 'REQ-001');
  assert.equal(envelope.completionContract.markInProgress, 'rcf build FBS-001 --mark inProgress');
});

test('rcf_build: a US id is a usage error pointing the agent at rcf_trace (carry 1)', async () => {
  const registry = registryFor(await scaffold());
  const result = await registry.call('rcf_build', { fbsId: 'US-101' });
  assert.equal(result.isError, true);
  assert.match(result.structuredContent.errors[0].message, /user story, not an FBS id/);
  assert.match(result.structuredContent.errors[0].message, /rcf_trace/);
});

test('rcf_build: other kinds and unknown ids are usage errors', async () => {
  const registry = registryFor(await scaffold());
  const wrongKind = await registry.call('rcf_build', { fbsId: 'TAC-001' });
  assert.equal(wrongKind.isError, true);
  assert.match(wrongKind.structuredContent.errors[0].message, /addresses FBS items only/);
  const unknown = await registry.call('rcf_build', { fbsId: 'FBS-404' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.structuredContent.errors[0].message, /not found/);
});

test('rcf_build: a blocked item still returns its bundle - blockedBy is data, not an error (carry 2)', async () => {
  const tmp = await scaffold();
  const registry = registryFor(tmp);
  const created = await registry.call('rcf_create', {
    kind: 'fbs', parent: 'BS-001', title: 'Blocked item', acIds: ['AC-101-1'],
    body: { summary: 'Depends on FBS-001.', dependsOnFbsIds: ['FBS-001'] },
  });
  assert.equal(created.isError, undefined);
  const result = await registry.call('rcf_build', { fbsId: created.structuredContent.id });
  assert.equal(result.isError, undefined, 'blocked bundles are data');
  assert.deepEqual(result.structuredContent.blockedBy, ['FBS-001']);
});
