// Prompt layer tests (Phase 7 §D16-A): the two Phase 7.5 playbooks
// served as static, argument-free prompts, byte-faithful from the
// pack via guidance/manifest.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createPromptRegistry } from '../../src/mcp/prompts.js';
import { GUIDANCE_DIR, readGuidanceManifest } from '../../src/mcp/resources.js';
import { INVALID_PARAMS } from '../../src/mcp/server.js';

test('prompts/list: exactly the two D16-A prompts, argument-free', async () => {
  const registry = createPromptRegistry();
  const { prompts } = await registry.list();
  assert.deepEqual(prompts.map((p) => p.name), ['rcf_execute_build_cycle', 'rcf_elicit_requirements']);
  for (const p of prompts) {
    assert.equal(typeof p.description, 'string');
    assert.equal('arguments' in p, false, 'argument-free static prompts');
  }
});

test('prompts/get: rcf_execute_build_cycle serves the build-cycle playbook byte-faithful', async () => {
  const registry = createPromptRegistry();
  const result = await registry.get({ name: 'rcf_execute_build_cycle' });
  const expected = await readFile(join(GUIDANCE_DIR, 'build-cycle-playbook.md'), 'utf8');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].content.type, 'text');
  assert.equal(result.messages[0].content.text, expected);
});

test('prompts/get: rcf_elicit_requirements serves the elicitation playbook byte-faithful', async () => {
  const registry = createPromptRegistry();
  const result = await registry.get({ name: 'rcf_elicit_requirements' });
  const expected = await readFile(join(GUIDANCE_DIR, 'elicitation-playbook.md'), 'utf8');
  assert.equal(result.messages[0].content.text, expected);
});

test('prompts/get: descriptions come from the pack manifest (the pack owns content)', async () => {
  const registry = createPromptRegistry();
  const manifest = await readGuidanceManifest(GUIDANCE_DIR);
  for (const entry of manifest.prompts) {
    const result = await registry.get({ name: entry.name });
    assert.equal(result.description, entry.description);
  }
});

test('prompts/get: unknown prompt name is the -32602 protocol error', async () => {
  const registry = createPromptRegistry();
  await assert.rejects(
    () => registry.get({ name: 'rcf_no_such_prompt' }),
    (err) => err.code === INVALID_PARAMS,
  );
  await assert.rejects(() => registry.get({}), (err) => err.code === INVALID_PARAMS);
});
