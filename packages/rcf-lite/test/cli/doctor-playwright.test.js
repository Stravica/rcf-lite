// Doctor's Playwright checks (spec 2026-09-03, sections 3 + 4.5). The three
// checks are conditional on manifest.blueprints containing at least one
// blueprint whose source blueprint.json declares .browserSurface.declared:
// true; non-browser-facing projects skip them with one printed reason line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main as doctorMain } from '../../src/cli/doctor.js';
import { initProject } from '../../src/core/store/init.js';
import {
  loadManagedBlock,
  writeAgentInstructions,
} from '../../src/setup/agent-setup.js';
import { writeIdentityTemplate } from '../../src/setup/identity-seed.js';
import { writeKnowledgeSeed } from '../../src/setup/knowledge-seed.js';
import {
  composeGitignoreBlock,
} from '../../src/setup/managed-gitignore.js';
import { FIX_LINES, SKIP_LINE_NON_BROWSER_FACING } from '../../src/setup/playwright-checks.js';

function capture() {
  const out = { text: '' };
  return { stream: { write: (s) => { out.text += s; } }, out };
}

async function scaffoldCleanProject(browserFacing) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-doc-pw-'));
  await initProject({ projectRoot: root, projectName: 'PwFixture' });
  const fragment = await loadManagedBlock();
  await writeAgentInstructions({ projectRoot: root, fragment });
  await writeKnowledgeSeed({ projectRoot: root });
  await writeIdentityTemplate({ projectRoot: root });
  await writeFile(join(root, '.gitignore'), composeGitignoreBlock(), 'utf8');

  if (browserFacing) {
    // Fake an applied browser-facing blueprint by pointing the manifest at
    // a shipped blueprint.json under a scratch directory that carries the
    // .browserSurface.declared flag.
    const bpRoot = join(root, 'fake-bp');
    await mkdir(bpRoot, { recursive: true });
    await writeFile(join(bpRoot, 'blueprint.json'), JSON.stringify({
      slug: 'fake-spa',
      version: '1.4.0',
      category: 'application',
      contributions: [],
      browserSurface: { declared: true, routes: ['/'], themes: ['light', 'dark'] },
    }, null, 2), 'utf8');
    const manifestPath = join(root, 'rcf', 'manifest.json');
    const { readFile } = await import('node:fs/promises');
    const m = JSON.parse(await readFile(manifestPath, 'utf8'));
    m.blueprints = [{
      slug: 'fake-spa',
      version: '1.4.0',
      appliedAt: '2026-09-03T17:00:00Z',
      source: bpRoot,
    }];
    await writeFile(manifestPath, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  }
  return root;
}

const alwaysPresent = () => ({ ok: true, resolvedFrom: '/tmp/playwright/index.js' });
const alwaysAbsent = () => ({ ok: false, resolvedFrom: null });
const browserOk = async () => ({ ok: true, source: 'path:chrome' });
const browserAbsent = async () => ({ ok: false, source: null });
const mcpReachable = async () => ({ ok: true, exitCode: 0, timedOut: false });
const mcpUnreachable = async () => ({ ok: false, exitCode: 1, timedOut: false });
const probeNone = async () => ({ kind: 'none' });
const probeFound = async () => ({ kind: 'found', name: 'playwright', scope: 'user' });

test('doctor: API-only project prints the skip line and does NOT run the three checks', async () => {
  const root = await scaffoldCleanProject(false);
  const stdout = capture();
  const code = await doctorMain([], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    checkPlaywrightPresent: alwaysAbsent,
    checkBrowserPresent: browserAbsent,
    checkPlaywrightMcpReachable: mcpUnreachable,
    probeClaudeCodeMcp: probeNone,
  });
  assert.equal(code, 0);
  assert.ok(stdout.out.text.includes(SKIP_LINE_NON_BROWSER_FACING),
    `expected skip line, got: ${stdout.out.text}`);
  // None of the three fix lines should appear.
  assert.ok(!stdout.out.text.includes(FIX_LINES['playwright-present']));
  assert.ok(!stdout.out.text.includes(FIX_LINES['browser-present']));
  assert.ok(!stdout.out.text.includes(FIX_LINES['playwright-mcp-reachable']));
});

test('doctor: browser-facing project with everything missing reports all three fix lines', async () => {
  const root = await scaffoldCleanProject(true);
  const stdout = capture();
  const code = await doctorMain([], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    checkPlaywrightPresent: alwaysAbsent,
    checkBrowserPresent: browserAbsent,
    checkPlaywrightMcpReachable: mcpUnreachable,
    probeClaudeCodeMcp: probeNone,
  });
  assert.equal(code, 3);
  for (const key of ['playwright-present', 'browser-present', 'playwright-mcp-reachable']) {
    assert.ok(stdout.out.text.includes(FIX_LINES[key]),
      `expected ${key} fix line, got: ${stdout.out.text}`);
  }
});

test('doctor: browser-facing project with everything satisfied reports clean', async () => {
  const root = await scaffoldCleanProject(true);
  const stdout = capture();
  const code = await doctorMain([], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    checkPlaywrightPresent: alwaysPresent,
    checkBrowserPresent: browserOk,
    checkPlaywrightMcpReachable: mcpReachable,
    probeClaudeCodeMcp: probeNone,
  });
  assert.equal(code, 0);
});

test('doctor --check playwright-present on an API-only project runs the check anyway (spec 3.5)', async () => {
  const root = await scaffoldCleanProject(false);
  const stdout = capture();
  const code = await doctorMain(['--check', 'playwright-present'], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    checkPlaywrightPresent: alwaysAbsent,
    checkBrowserPresent: browserAbsent,
    checkPlaywrightMcpReachable: mcpUnreachable,
    probeClaudeCodeMcp: probeNone,
  });
  assert.equal(code, 3);
  assert.ok(stdout.out.text.includes(FIX_LINES['playwright-present']),
    `expected fix line, got: ${stdout.out.text}`);
  assert.ok(!stdout.out.text.includes(SKIP_LINE_NON_BROWSER_FACING),
    `skip line should NOT print when the check was explicitly asked, got: ${stdout.out.text}`);
});

test('doctor: playwright-mcp-redundant fires when project + user both declare Playwright (browser-facing only)', async () => {
  const root = await scaffoldCleanProject(true);
  await writeFile(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      rcf: { command: 'npx', args: ['rcf-lite', 'mcp'] },
      playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.99'] },
    },
  }, null, 2), 'utf8');
  const stdout = capture();
  const code = await doctorMain([], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    checkPlaywrightPresent: alwaysPresent,
    checkBrowserPresent: browserOk,
    checkPlaywrightMcpReachable: mcpReachable,
    probeClaudeCodeMcp: probeFound,
  });
  assert.equal(code, 3);
  assert.match(stdout.out.text, /playwright-mcp-redundant/);
  assert.match(stdout.out.text, /project entry shadows the user entry/);
});

test('doctor: playwright-mcp-redundant does NOT fire on an API-only project (spec 4.5)', async () => {
  const root = await scaffoldCleanProject(false);
  await writeFile(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      rcf: { command: 'npx', args: ['rcf-lite', 'mcp'] },
      playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.99'] },
    },
  }, null, 2), 'utf8');
  const stdout = capture();
  const code = await doctorMain([], {
    cwd: root,
    stdout: stdout.stream,
    stderr: { write: () => {} },
    checkPlaywrightPresent: alwaysAbsent,
    checkBrowserPresent: browserAbsent,
    checkPlaywrightMcpReachable: mcpUnreachable,
    probeClaudeCodeMcp: probeFound,
  });
  assert.equal(code, 0);
  assert.ok(!stdout.out.text.includes('playwright-mcp-redundant'));
});

test('doctor --help lists the four new check values', async () => {
  const stdout = capture();
  const code = await doctorMain(['--help'], { stdout: stdout.stream });
  assert.equal(code, 0);
  for (const c of ['playwright-present', 'browser-present', 'playwright-mcp-reachable', 'playwright-mcp-redundant']) {
    assert.ok(stdout.out.text.includes(c), `expected ${c} in help`);
  }
});
