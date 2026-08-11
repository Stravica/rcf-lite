// AC-1.13 — the setup-funnel gate at packages/rcf-lite/src/mcp/tools.js
// (via `hasAgentMarker`) recognises BOTH the pre-0.6.0 legacy marker
// AND the 0.6.0+ managed marker. A legacy-inited repo does NOT get
// spammed with "Setup incomplete" notices; the correct migration signal
// is doctor's `legacy-markers` drift item, which the operator sees on
// their next diagnostic run (§2.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';
import { createToolRegistry } from '../../src/mcp/tools.js';
import { hasAgentMarker } from '../../src/setup/agent-setup.js';

const silentLog = { info: () => {}, error: () => {} };

async function scaffold(prefix) {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  await initProject({ projectRoot: tmp, projectName: 'FunnelXfer' });
  return tmp;
}

function noticeBlocks(result) {
  return (result.content ?? []).filter((c) => c.type === 'text' && /Setup incomplete/.test(c.text));
}

test('AC-1.13: hasAgentMarker returns true on a legacy-marker repo', async () => {
  const tmp = await scaffold('rcf-funnel-legacy-');
  await writeFile(join(tmp, 'CLAUDE.md'), '<!-- rcf:begin -->\nlegacy content\n<!-- rcf:end -->\n', 'utf8');
  assert.equal(await hasAgentMarker(tmp), true);
});

test('AC-1.13: hasAgentMarker returns true on a new-marker repo', async () => {
  const tmp = await scaffold('rcf-funnel-new-');
  await writeFile(join(tmp, 'CLAUDE.md'), '<!-- rcf:managed:begin -->\nnew content\n<!-- rcf:managed:end -->\n', 'utf8');
  assert.equal(await hasAgentMarker(tmp), true);
});

test('AC-1.13: setup funnel is silent on a legacy-inited repo (no notice appended)', async () => {
  const tmp = await scaffold('rcf-funnel-legacy-notice-');
  await writeFile(join(tmp, 'CLAUDE.md'), '<!-- rcf:begin -->\nlegacy\n<!-- rcf:end -->\n', 'utf8');
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const result = await registry.call('rcf_validate', {});
  assert.equal(noticeBlocks(result).length, 0, 'legacy-inited repo must not be spammed with the setup notice');
});

test('AC-1.13: setup funnel is silent on a new-marker repo (regression coverage)', async () => {
  const tmp = await scaffold('rcf-funnel-new-notice-');
  await writeFile(join(tmp, 'AGENTS.md'), '<!-- rcf:managed:begin -->\nnew\n<!-- rcf:managed:end -->\n', 'utf8');
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const result = await registry.call('rcf_validate', {});
  assert.equal(noticeBlocks(result).length, 0);
});
