// Theme 1, touchpoint (iii): server running, tree present, but the rcf
// marker block is ABSENT from the project-root CLAUDE.md / AGENTS.md -
// the session started without the init bootstrap. Every tool response
// carries ONE firm instruction funnelling to `npx rcf init` + session
// restart. The notice disappears once the marker exists, and never
// touches structuredContent (envelope identity preserved).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { createToolRegistry } from '../../src/mcp/tools.js';
import { MARKER_BEGIN, MARKER_END } from '../../src/setup/agent-setup.js';

const silentLog = { info: () => {}, error: () => {} };

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-funnel-'));
  await initProject({ projectRoot: tmp, projectName: 'FunnelTest' });
  return tmp;
}

function noticeBlocks(result) {
  return (result.content ?? []).filter((c) => c.type === 'text' && /Setup incomplete/.test(c.text));
}

test('marker absent: every tool response carries exactly one firm funnel instruction', async () => {
  const tmp = await scaffold();
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const validate = await registry.call('rcf_validate', {});
  const notices = noticeBlocks(validate);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /npx rcf init/);
  assert.match(notices[0].text, /restart their\s+agent session/);
  // structuredContent stays the verbatim envelope; content[0] parity holds.
  assert.deepEqual(JSON.parse(validate.content[0].text), validate.structuredContent);
  // A second tool carries it too.
  const read = await registry.call('rcf_read', { id: 'US-101' });
  assert.equal(noticeBlocks(read).length, 1);
});

test('marker present in CLAUDE.md: no notice', async () => {
  const tmp = await scaffold();
  await writeFile(join(tmp, 'CLAUDE.md'), `${MARKER_BEGIN}\nwired\n${MARKER_END}\n`, 'utf8');
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const validate = await registry.call('rcf_validate', {});
  assert.equal(noticeBlocks(validate).length, 0);
});

test('marker present in AGENTS.md counts as wired', async () => {
  const tmp = await scaffold();
  await writeFile(join(tmp, 'AGENTS.md'), `${MARKER_BEGIN}\nwired\n${MARKER_END}\n`, 'utf8');
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const validate = await registry.call('rcf_validate', {});
  assert.equal(noticeBlocks(validate).length, 0);
});

test('notice disappears once the marker lands mid-session (absent is re-checked, present is cached)', async () => {
  const tmp = await scaffold();
  const registry = createToolRegistry({ projectRoot: tmp, log: silentLog });
  const first = await registry.call('rcf_validate', {});
  assert.equal(noticeBlocks(first).length, 1);
  await writeFile(join(tmp, 'CLAUDE.md'), `${MARKER_BEGIN}\nwired\n${MARKER_END}\n`, 'utf8');
  const second = await registry.call('rcf_validate', {});
  assert.equal(noticeBlocks(second).length, 0);
});
