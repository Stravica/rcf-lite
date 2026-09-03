// Unit tests for the playwright-checks module (spec 2026-09-03, sections 3
// + 4). Pure logic tests for the parsers and signature detectors; the
// probes themselves are covered by the doctor tests via dependency
// injection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findProjectPlaywrightKey,
  hasPlaywrightSignature,
  loadBrowserFacingSources,
  parseClaudeMcpListOutput,
  probeClaudeCodeMcp,
} from '../../src/setup/playwright-checks.js';

test('hasPlaywrightSignature: args string matching @playwright/mcp@... is a hit', () => {
  assert.equal(hasPlaywrightSignature({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.99'] }), true);
  assert.equal(hasPlaywrightSignature({ command: 'npx', args: ['-y', '@playwright/mcp'] }), true);
});

test('hasPlaywrightSignature: no @playwright/mcp arg is not a hit', () => {
  assert.equal(hasPlaywrightSignature({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-x'] }), false);
  assert.equal(hasPlaywrightSignature({ command: 'node', args: ['other.js'] }), false);
  assert.equal(hasPlaywrightSignature(null), false);
  assert.equal(hasPlaywrightSignature({}), false);
});

test('findProjectPlaywrightKey: returns the entry name whose args carry the signature', () => {
  const cfg = {
    mcpServers: {
      rcf: { command: 'npx', args: ['rcf-lite', 'mcp'] },
      'my-pw': { command: 'npx', args: ['-y', '@playwright/mcp@0.0.44'] },
    },
  };
  assert.equal(findProjectPlaywrightKey(cfg), 'my-pw');
});

test('findProjectPlaywrightKey: returns null when no server carries the signature', () => {
  const cfg = { mcpServers: { rcf: { command: 'npx', args: ['rcf-lite', 'mcp'] } } };
  assert.equal(findProjectPlaywrightKey(cfg), null);
  assert.equal(findProjectPlaywrightKey(null), null);
  assert.equal(findProjectPlaywrightKey({}), null);
  assert.equal(findProjectPlaywrightKey({ mcpServers: [] }), null);
});

test('parseClaudeMcpListOutput: named line with @playwright/mcp + user scope -> found', () => {
  const text = [
    'name             scope  command',
    'rcf              user   npx rcf-lite mcp',
    'playwright       user   npx -y @playwright/mcp',
  ].join('\n');
  const parsed = parseClaudeMcpListOutput(text);
  assert.equal(parsed.kind, 'found');
  assert.equal(parsed.name, 'playwright');
  assert.equal(parsed.scope, 'user');
});

test('parseClaudeMcpListOutput: no playwright line + other entries -> none', () => {
  const text = 'rcf             user   npx rcf-lite mcp\n';
  const parsed = parseClaudeMcpListOutput(text);
  assert.equal(parsed.kind, 'none');
});

test('parseClaudeMcpListOutput: empty stdout -> none', () => {
  assert.equal(parseClaudeMcpListOutput('').kind, 'none');
  assert.equal(parseClaudeMcpListOutput('\n\n').kind, 'none');
});

test('probeClaudeCodeMcp: unparseable / cli-absent -> inconclusive (with reason)', async () => {
  const missing = await probeClaudeCodeMcp({
    runProbe: async () => ({ exitCode: 127, stdout: '', timedOut: false, error: 'ENOENT' }),
  });
  assert.equal(missing.kind, 'inconclusive');
  assert.match(missing.reason, /error/);

  const timedOut = await probeClaudeCodeMcp({
    runProbe: async () => ({ exitCode: null, stdout: '', timedOut: true }),
  });
  assert.equal(timedOut.kind, 'inconclusive');
  assert.match(timedOut.reason, /timed out/);
});

test('probeClaudeCodeMcp: clean stdout with a playwright user-scope line -> found', async () => {
  const res = await probeClaudeCodeMcp({
    runProbe: async () => ({
      exitCode: 0,
      stdout: 'playwright  user  npx -y @playwright/mcp@0.0.80',
      timedOut: false,
    }),
  });
  assert.equal(res.kind, 'found');
  assert.equal(res.name, 'playwright');
  assert.equal(res.scope, 'user');
});

test('loadBrowserFacingSources: returns { browserFacing: false, sources: [] } on a manifest with no blueprints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-bfs-'));
  await mkdir(join(root, 'rcf'), { recursive: true });
  await writeFile(join(root, 'rcf', 'manifest.json'), JSON.stringify({
    version: '2.0.0',
    projectName: 'X',
    prd: { id: 'PRD-001', path: 'prd.json' },
    tad: { id: 'TAD-001', path: 'tad.json' },
    bs: { id: 'BS-001', path: 'build-sequence.json' },
  }), 'utf8');
  const res = await loadBrowserFacingSources(root);
  assert.equal(res.browserFacing, false);
  assert.deepEqual(res.sources, []);
});

test('loadBrowserFacingSources: returns { browserFacing: true } when at least one source declares browserSurface', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-bfs-'));
  await mkdir(join(root, 'rcf'), { recursive: true });
  await mkdir(join(root, 'bp'), { recursive: true });
  await writeFile(join(root, 'bp', 'blueprint.json'), JSON.stringify({
    slug: 'x-spa', version: '1.4.0', contributions: [],
    browserSurface: { declared: true, routes: [], themes: [] },
  }), 'utf8');
  await writeFile(join(root, 'rcf', 'manifest.json'), JSON.stringify({
    version: '2.0.0',
    projectName: 'X',
    prd: { id: 'PRD-001', path: 'prd.json' },
    tad: { id: 'TAD-001', path: 'tad.json' },
    bs: { id: 'BS-001', path: 'build-sequence.json' },
    blueprints: [{ slug: 'x-spa', version: '1.4.0', appliedAt: '2026-09-03T17:00:00Z', source: join(root, 'bp') }],
  }), 'utf8');
  const res = await loadBrowserFacingSources(root);
  assert.equal(res.browserFacing, true);
  assert.equal(res.sources.length, 1);
});

test('loadBrowserFacingSources: a source with .browserSurface but no declared:true is not browser-facing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-bfs-'));
  await mkdir(join(root, 'rcf'), { recursive: true });
  await mkdir(join(root, 'bp'), { recursive: true });
  await writeFile(join(root, 'bp', 'blueprint.json'), JSON.stringify({
    slug: 'x-api', version: '1.0.0', contributions: [],
    browserSurface: { declared: false },
  }), 'utf8');
  await writeFile(join(root, 'rcf', 'manifest.json'), JSON.stringify({
    version: '2.0.0',
    projectName: 'X',
    prd: { id: 'PRD-001', path: 'prd.json' },
    tad: { id: 'TAD-001', path: 'tad.json' },
    bs: { id: 'BS-001', path: 'build-sequence.json' },
    blueprints: [{ slug: 'x-api', version: '1.0.0', appliedAt: '2026-09-03T17:00:00Z', source: join(root, 'bp') }],
  }), 'utf8');
  const res = await loadBrowserFacingSources(root);
  assert.equal(res.browserFacing, false);
});

/* ------------------------------------------------------------------ */
/* Live Claude Code 1.x list-format shape + Scope parsing.            */
/* ------------------------------------------------------------------ */

test('parseClaudeMcpListOutput: Claude Code 1.x colon-form line -> found (scope unknown when list omits it)', async () => {
  const { parseClaudeMcpListOutput } = await import('../../src/setup/playwright-checks.js');
  const text = [
    'Checking MCP server health…',
    '',
    'rcf-tools: /usr/local/bin/docker exec -i rcf-tools-mcp node /app/servers/rcf-tools-mcp/dist/index.js - ✔ Connected',
    'playwright: /Users/thefoot/.n/bin/npx -y @playwright/mcp@latest - ✔ Connected',
    'rcf: node /path/to/rcf.js mcp - ⏸ Pending approval',
  ].join('\n');
  const parsed = parseClaudeMcpListOutput(text);
  assert.equal(parsed.kind, 'found');
  assert.equal(parsed.name, 'playwright');
  // The 1.x list format does not carry a scope column; the caller resolves
  // scope via `claude mcp get <name>` (see probeClaudeCodeMcp).
  assert.equal(parsed.scope, 'unknown');
});

test('parseClaudeMcpGetScope: reads Scope: User / Project / Local off `claude mcp get` output', async () => {
  const { parseClaudeMcpGetScope } = await import('../../src/setup/playwright-checks.js');
  assert.equal(parseClaudeMcpGetScope('  Scope: User config (available in all your projects)\n'), 'user');
  assert.equal(parseClaudeMcpGetScope('  Scope: Project config\n'), 'project');
  assert.equal(parseClaudeMcpGetScope('  Scope: Local config\n'), 'local');
  assert.equal(parseClaudeMcpGetScope('some unrelated output'), null);
});

test('probeClaudeCodeMcp: 1.x list + get -> found with named scope', async () => {
  const { probeClaudeCodeMcp } = await import('../../src/setup/playwright-checks.js');
  let call = 0;
  const runProbe = async (cmd, args) => {
    call += 1;
    if (call === 1) {
      // First: mcp list
      return {
        exitCode: 0,
        timedOut: false,
        stdout: 'playwright: npx -y @playwright/mcp@0.0.80 - ✔ Connected\n',
      };
    }
    // Second: mcp get playwright
    return {
      exitCode: 0,
      timedOut: false,
      stdout: 'playwright:\n  Scope: User config (available in all your projects)\n  Status: ✔ Connected\n',
    };
  };
  const res = await probeClaudeCodeMcp({ runProbe });
  assert.equal(res.kind, 'found');
  assert.equal(res.name, 'playwright');
  assert.equal(res.scope, 'user');
});
