// Brownfield entry path: `rcf init` run in a repo that already has code,
// an authored rcf/ tree, a populated .mcp.json and a tuned CLAUDE.md.
// These tests pin the per-file promises docs/install.md section 8 makes,
// so the documented contract cannot drift away from the behaviour.
//
// init-bootstrap.test.js already covers the fresh-dir matrix and the
// individual wiring rules. What is pinned HERE is the brownfield
// composite: an authored tree left byte-identical, prose outside the
// markers preserved, true byte-level idempotency across a re-run, and
// the one caveat the docs state explicitly - the tree guard keys on
// rcf/manifest.json, not on the rcf/ directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBinInit(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'init', ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

const AUTHORED_REQ = JSON.stringify({
  reqId: 'REQ-001',
  prdId: 'PRD-001',
  title: 'Authored requirement that must survive init',
  description: 'Hand-written content. Init must not rewrite this file.',
  category: 'functional',
  domain: 'legacy',
  priority: 'must',
  version: '0.1.0',
  status: 'approved',
  createdAt: '2020-01-01T00:00:00Z',
  updatedAt: '2020-01-01T00:00:00Z',
}, null, 2);

const AUTHORED_MANIFEST = JSON.stringify({
  version: '2.0.0',
  projectName: 'Pre-existing project',
  description: 'Authored manifest.',
  prd: { id: 'PRD-001', path: 'prd.json' },
  tad: { id: 'TAD-001', path: 'tad.json' },
  bs: { id: 'BS-001', path: 'build-sequence.json' },
}, null, 2);

const PRIOR_CLAUDE = '# legacy-app\n\nHouse rules that predate RCF.\n\n## Style\n- Tabs, not spaces.\n';

/** A repo that already has code, a tree, MCP servers and instructions. */
async function makeBrownfieldRepo() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-brownfield-'));
  await mkdir(join(tmp, 'src'), { recursive: true });
  await mkdir(join(tmp, 'rcf', 'requirements'), { recursive: true });
  await writeFile(join(tmp, 'src', 'app.js'), 'export const hello = () => "hi";\n', 'utf8');
  await writeFile(join(tmp, 'rcf', 'manifest.json'), AUTHORED_MANIFEST, 'utf8');
  await writeFile(join(tmp, 'rcf', 'requirements', 'req-001.json'), AUTHORED_REQ, 'utf8');
  await writeFile(join(tmp, '.mcp.json'), JSON.stringify({
    $schema: 'https://example.com/mcp.schema.json',
    mcpServers: { postgres: { command: 'npx', args: ['-y', '@company/mcp-postgres'] } },
    customTeamSetting: { reviewers: ['alice', 'bob'], enforce: true },
  }, null, 2), 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'), PRIOR_CLAUDE, 'utf8');
  return tmp;
}

test('brownfield repo: authored tree untouched, foreign MCP config preserved, prior prose intact', async () => {
  const tmp = await makeBrownfieldRepo();
  const { code, stdout } = await runBinInit(tmp, ['--project-name', 'Renamed', '--non-interactive']);
  assert.equal(code, 0);
  assert.match(stdout, /already set up here - document chain left untouched/);

  // 1. The authored tree is byte-identical: not rewritten, not renumbered,
  // and the project name passed on this run is NOT applied to it.
  assert.equal(await readFile(join(tmp, 'rcf/requirements/req-001.json'), 'utf8'), AUTHORED_REQ);
  assert.equal(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'), AUTHORED_MANIFEST);

  // 2. .mcp.json merged: foreign server, unknown top-level keys and the
  // $schema pointer all survive alongside the added rcf entry.
  const mcp = JSON.parse(await readFile(join(tmp, '.mcp.json'), 'utf8'));
  assert.equal(mcp.$schema, 'https://example.com/mcp.schema.json');
  assert.deepEqual(mcp.mcpServers.postgres, { command: 'npx', args: ['-y', '@company/mcp-postgres'] });
  assert.deepEqual(mcp.customTeamSetting, { reviewers: ['alice', 'bob'], enforce: true });
  assert.equal(mcp.mcpServers.rcf.command, 'npx');
  assert.deepEqual(mcp.mcpServers.rcf.args, ['rcf-lite', 'mcp']);

  // 3. CLAUDE.md: prose outside the markers preserved verbatim, block appended.
  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(claude.startsWith(PRIOR_CLAUDE), true, 'prior instructions intact and unmoved');
  assert.match(claude, /<!-- rcf:managed:begin -->/);

  // 4. The other convention's file is not invented.
  assert.equal(await fileExists(join(tmp, 'AGENTS.md')), false, 'no AGENTS.md invented');

  // 5. Source code is not touched.
  assert.equal(await readFile(join(tmp, 'src/app.js'), 'utf8'), 'export const hello = () => "hi";\n');
});

test('brownfield re-run is byte-identical: nothing changes on a second init', async () => {
  const tmp = await makeBrownfieldRepo();
  await runBinInit(tmp, ['--project-name', 'First', '--non-interactive']);
  const after1 = {
    mcp: await readFile(join(tmp, '.mcp.json'), 'utf8'),
    claude: await readFile(join(tmp, 'CLAUDE.md'), 'utf8'),
  };

  const { code } = await runBinInit(tmp, ['--project-name', 'Second', '--non-interactive']);
  assert.equal(code, 0);

  assert.equal(await readFile(join(tmp, '.mcp.json'), 'utf8'), after1.mcp, '.mcp.json byte-identical');
  assert.equal(await readFile(join(tmp, 'CLAUDE.md'), 'utf8'), after1.claude, 'CLAUDE.md byte-identical');
  assert.equal(await readFile(join(tmp, 'rcf/requirements/req-001.json'), 'utf8'), AUTHORED_REQ);
});

test('the tree guard keys on rcf/manifest.json, not on the rcf/ directory', async () => {
  // The caveat docs/install.md section 8.1 states explicitly: an rcf/
  // directory with no manifest is a fresh scaffold target, so a file on
  // a scaffold path is overwritten while unrelated files survive. Pinned
  // so the documented caveat and the behaviour move together.
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-brownfield-nomanifest-'));
  await mkdir(join(tmp, 'rcf', 'requirements'), { recursive: true });
  await writeFile(join(tmp, 'rcf', 'notes.txt'), 'unrelated notes\n', 'utf8');
  await writeFile(join(tmp, 'rcf', 'requirements', 'req-001.json'), AUTHORED_REQ, 'utf8');

  const { code, stdout } = await runBinInit(tmp, ['--project-name', 'Fresh', '--non-interactive']);
  assert.equal(code, 0);
  assert.match(stdout, /RCF project created\./, 'treated as a fresh scaffold, not an existing project');

  // A file on a scaffold path IS replaced by the placeholder.
  const req = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-001.json'), 'utf8'));
  assert.match(req.title, /^TODO:/, 'colliding scaffold path overwritten');
  // A file that is not on a scaffold path is left alone.
  assert.equal(await readFile(join(tmp, 'rcf/notes.txt'), 'utf8'), 'unrelated notes\n');
});

test('init exposes no --dry-run: the documented preview route is git', async () => {
  // docs/install.md section 8.3 tells the reader plainly that no preview
  // flag exists. If one is ever added, this test fails and the doc gets
  // corrected rather than silently going stale.
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-brownfield-dryrun-'));
  const { code, stderr } = await runBinInit(tmp, ['--dry-run', '--project-name', 'X', '--non-interactive']);
  assert.equal(code, 2);
  assert.match(stderr, /Unknown option '--dry-run'/);
});
