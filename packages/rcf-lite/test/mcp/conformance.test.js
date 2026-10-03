// Conformance layer (Phase 7 §D20 / §D21, the operator's binding D4
// condition): drive the hand-rolled server through the OFFICIAL
// @modelcontextprotocol/sdk client (devDependency only) against the
// pinned 2025-11-25 revision, over the real dogfood tree at the repo
// root. The SDK client validates result shapes and enforces
// outputSchema conformance on structuredContent - conformance is an
// asserted property, not a hope.
//
// This file also executes the spec §5 manual-dogfood sequence
// (rcf_validate, rcf_coverage, rcf_trace REQ-002, one rcf_update dry
// run) through a real MCP client; the human-in-the-loop client render
// check falls to the operator post-merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf.js');

async function connectClient() {
  const client = new Client({ name: 'rcf-conformance', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, 'mcp'],
    cwd: repoRoot,
    env: { ...process.env, CI: '1' },
    stderr: 'pipe',
  });
  await client.connect(transport);
  return { client, transport };
}

test('conformance: SDK client completes the 2025-11-25 handshake and sees all three capabilities', async () => {
  const { client } = await connectClient();
  try {
    const serverInfo = client.getServerVersion();
    assert.equal(serverInfo.name, 'rcf-build-lite');
    const capabilities = client.getServerCapabilities();
    assert.ok(capabilities.tools, 'tools capability declared');
    assert.ok(capabilities.resources, 'resources capability declared');
    assert.ok(capabilities.prompts, 'prompts capability declared');
    assert.equal(typeof client.getInstructions(), 'string');
    await client.ping();
  } finally {
    await client.close();
  }
});

test('conformance: SDK listTools sees fourteen tools; every schema passes the SDK schema layer', async () => {
  const { client } = await connectClient();
  try {
    const { tools } = await client.listTools();
    // REQ-186 (DEFINE step 3 PR 2) added three tools:
    // rcf_define_questions, rcf_define_readiness and
    // rcf_define_ledger (spec 2026-10-01 §6). The previous eleven
    // (validate / coverage / trace / impact / read / create / update
    // / delete / link / unlink / build) are untouched.
    assert.equal(tools.length, 14);
    const build = tools.find((t) => t.name === 'rcf_build');
    assert.equal('strict' in build.inputSchema.properties, false);
    assert.deepEqual(Object.keys(build.inputSchema.properties), ['fbsId']);
    for (const name of ['rcf_define_questions', 'rcf_define_readiness', 'rcf_define_ledger']) {
      assert.ok(tools.find((t) => t.name === name), `expected ${name} in the tool list`);
    }
  } finally {
    await client.close();
  }
});

test('conformance: the dogfood sequence through the official client - validate, coverage, trace REQ-002, update dry run', async () => {
  const { client } = await connectClient();
  try {
    // listTools first so the SDK caches outputSchema validators and
    // enforces structuredContent conformance on every call below.
    await client.listTools();

    const validate = await client.callTool({ name: 'rcf_validate', arguments: {} });
    assert.equal(validate.isError, undefined);
    assert.equal(validate.structuredContent.ok, true, 'dogfood tree is clean');

    const coverage = await client.callTool({ name: 'rcf_coverage', arguments: {} });
    assert.equal(coverage.isError, undefined);
    assert.equal(typeof coverage.structuredContent.totals.requirements, 'number');

    const trace = await client.callTool({ name: 'rcf_trace', arguments: { id: 'REQ-002' } });
    assert.equal(trace.isError, undefined);
    const golden = JSON.parse(await readFile(resolve(repoRoot, 'test/query/fixtures/trace.json'), 'utf8'));
    assert.deepEqual(trace.structuredContent, golden, 'SDK-client trace deep-equals the committed golden');

    const before = await readFile(resolve(repoRoot, 'rcf/user-stories/us-201.json'), 'utf8');
    const update = await client.callTool({
      name: 'rcf_update',
      arguments: { id: 'US-201', sets: [{ path: 'title', value: 'dogfood dry run' }], dryRun: true },
    });
    assert.equal(update.isError, undefined);
    assert.equal(update.structuredContent.dryRun, true);
    const after = await readFile(resolve(repoRoot, 'rcf/user-stories/us-201.json'), 'utf8');
    assert.equal(after, before, 'dry run must not touch the dogfood tree');
  } finally {
    await client.close();
  }
});

test('conformance: tool execution errors round-trip the SDK client with the D11 payload', async () => {
  const { client } = await connectClient();
  try {
    await client.listTools();
    const usId = await client.callTool({ name: 'rcf_build', arguments: { fbsId: 'US-201' } });
    assert.equal(usId.isError, true);
    assert.equal(usId.structuredContent.ok, false);
    assert.match(usId.structuredContent.errors[0].message, /rcf_trace/);
  } finally {
    await client.close();
  }
});

test('conformance: SDK resources - list, tree read, one methodology doc byte-faithful', async () => {
  const { client } = await connectClient();
  try {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    assert.ok(uris.includes('rcf://tree'));
    for (const slug of ['overview', 'document-model', 'build-cycle', 'harness-template']) {
      assert.ok(uris.includes(`rcf://docs/${slug}`), slug);
    }
    const tree = await client.readResource({ uri: 'rcf://tree' });
    assert.equal(tree.contents[0].mimeType, 'application/json');
    assert.equal(JSON.parse(tree.contents[0].text).project, 'RCF Lite');
    const doc = await client.readResource({ uri: 'rcf://docs/overview' });
    const expected = await readFile(resolve(repoRoot, 'guidance/overview.md'), 'utf8');
    assert.equal(doc.contents[0].text, expected);
    const missing = client.readResource({ uri: 'rcf://doc/NOPE-1' });
    await assert.rejects(missing, /Resource not found/);
  } finally {
    await client.close();
  }
});

test('conformance: SDK prompts - list and every playbook byte-faithful', async () => {
  const { client } = await connectClient();
  try {
    const { prompts } = await client.listPrompts();
    // REQ-186 (DEFINE step 3 PR 2) added two argument-free prompts:
    // rcf_define_intent and rcf_define_intake (spec 2026-10-01 §6).
    assert.deepEqual(
      prompts.map((p) => p.name).sort(),
      ['rcf_define_intake', 'rcf_define_intent', 'rcf_elicit_requirements', 'rcf_execute_build_cycle'],
    );
    for (const [name, file] of [
      ['rcf_execute_build_cycle', 'build-cycle-playbook.md'],
      ['rcf_elicit_requirements', 'elicitation-playbook.md'],
      ['rcf_define_intent', 'define-intent.md'],
      ['rcf_define_intake', 'define-intake.md'],
    ]) {
      const prompt = await client.getPrompt({ name });
      const expected = await readFile(resolve(repoRoot, 'guidance', file), 'utf8');
      assert.equal(prompt.messages[0].content.text, expected, `${name} byte-faithful`);
    }
  } finally {
    await client.close();
  }
});
