// init's Playwright MCP pass (spec 2026-09-03, section 4). Every probe is
// injected via deps so tests run without touching an ambient claude harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main as initMain } from '../../src/cli/init.js';
import { PLAYWRIGHT_MCP_VERSION } from '../../src/verify/engine/launcher.js';

function capture() {
  const out = { text: '' };
  return { stream: { write: (s) => { out.text += s; } }, out };
}

const probeNone = async () => ({ kind: 'none' });
const probeFound = async () => ({ kind: 'found', name: 'playwright', scope: 'user' });
const probeInconclusive = async () => ({ kind: 'inconclusive', reason: 'CLI absent' });

async function tmpProject() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-init-pw-'));
  return dir;
}

test('init: fresh project + probe=none -> writes distinctly named playwright-rcf entry', async () => {
  const root = await tmpProject();
  const stdout = capture();
  const code = await initMain(['--project-name', 'X', '--non-interactive'], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    probeClaudeCodeMcp: probeNone,
  });
  assert.equal(code, 0);
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers['playwright-rcf'], 'playwright-rcf entry present');
  assert.deepEqual(mcp.mcpServers['playwright-rcf'], {
    type: 'stdio',
    command: 'npx',
    args: ['-y', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`],
    env: {},
  });
  assert.match(stdout.out.text, /wrote 'playwright-rcf' at project scope/);
});

test('init: existing project-scope Playwright signature -> left alone (spec 4.1)', async () => {
  const root = await tmpProject();
  await writeFile(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      'my-pw': { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.42'], env: {} },
    },
  }, null, 2), 'utf8');
  const stdout = capture();
  const code = await initMain(['--project-name', 'X', '--non-interactive'], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    probeClaudeCodeMcp: probeNone,
  });
  assert.equal(code, 0);
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  // 'my-pw' preserved, no 'playwright-rcf' added.
  assert.ok(mcp.mcpServers['my-pw']);
  assert.equal(mcp.mcpServers['my-pw'].args[1], '@playwright/mcp@0.0.42');
  assert.ok(!mcp.mcpServers['playwright-rcf'], 'no playwright-rcf entry added');
  assert.match(stdout.out.text, /already registered in \.mcp\.json under key 'my-pw' at project scope, left alone/);
});

test('init: probe=found at user scope -> left alone; no project entry written (spec 4.2)', async () => {
  const root = await tmpProject();
  const stdout = capture();
  const code = await initMain(['--project-name', 'X', '--non-interactive'], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    probeClaudeCodeMcp: probeFound,
  });
  assert.equal(code, 0);
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  assert.ok(!mcp.mcpServers['playwright-rcf'], 'no playwright-rcf entry added when user-scope hit');
  assert.match(stdout.out.text, /already registered under key 'playwright' at user scope in Claude Code, left alone/);
});

test('init: probe=inconclusive -> writes playwright-rcf entry AND prints the could-not-probe notice (spec 4.3)', async () => {
  const root = await tmpProject();
  const stdout = capture();
  const code = await initMain(['--project-name', 'X', '--non-interactive'], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    probeClaudeCodeMcp: probeInconclusive,
  });
  assert.equal(code, 0);
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers['playwright-rcf']);
  assert.match(stdout.out.text, /could not probe user-scope entries/);
});

test('init --no-playwright-mcp: probe still runs, but no Playwright entry is written', async () => {
  const root = await tmpProject();
  const stdout = capture();
  const code = await initMain(['--project-name', 'X', '--non-interactive', '--no-playwright-mcp'], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    probeClaudeCodeMcp: probeNone,
  });
  assert.equal(code, 0);
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  assert.ok(!mcp.mcpServers['playwright-rcf'], '--no-playwright-mcp must suppress the write');
  assert.match(stdout.out.text, /--no-playwright-mcp set; no entry written/);
});

test('init: --help lists --no-playwright-mcp', async () => {
  const stdout = capture();
  await initMain(['--help'], { stdout: stdout.stream });
  assert.match(stdout.out.text, /--no-playwright-mcp/);
});
