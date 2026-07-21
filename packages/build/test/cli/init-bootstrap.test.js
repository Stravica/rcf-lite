// Theme 1: `rcf init` as the full pre-session bootstrap. Beyond the
// tree scaffold, init writes/merges the project-root .mcp.json (rcf
// server entry) and writes the guidance fragment into CLAUDE.md /
// AGENTS.md inside rcf marker comments. Matrix per the fix-cycle-2
// brief: fresh dir, merge with a foreign server, append to existing
// instructions, re-run idempotency, --no-agent-setup opt-out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

const INIT_ARGS = ['--project-name', 'BootstrapTest', '--non-interactive'];

test('fresh dir: init creates the tree, .mcp.json and BOTH CLAUDE.md + AGENTS.md', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-fresh-'));
  const { code, stdout } = await runBinInit(tmp, INIT_ARGS);
  assert.equal(code, 0);
  // High-level completion output, not a developer file list.
  assert.match(stdout, /RCF project created\./);
  assert.match(stdout, /Document chain\s+scaffolded under rcf\//);
  assert.match(stdout, /MCP server\s+registered in \.mcp\.json/);
  assert.match(stdout, /Agent instructions\s+written to CLAUDE\.md and AGENTS\.md/);
  assert.match(stdout, /Next: start your agent session/);
  // The old developer file manifest is gone.
  assert.doesNotMatch(stdout, /Scaffolded \d+ files/);
  assert.doesNotMatch(stdout, /^ {2}rcf\/manifest\.json/m);
  // Tree.
  assert.equal(await fileExists(join(tmp, 'rcf/manifest.json')), true);
  // MCP config: exact registration shape install.md documents.
  const mcp = JSON.parse(await readFile(join(tmp, '.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers.rcf.command, 'node');
  assert.equal(mcp.mcpServers.rcf.args.length, 2);
  assert.match(mcp.mcpServers.rcf.args[0], /bin\/rcf\.js$/);
  assert.equal(mcp.mcpServers.rcf.args[1], 'mcp');
  // Agent instructions written to BOTH files (vendor-neutral default),
  // each inside markers and carrying the three firm rules.
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const doc = await readFile(join(tmp, name), 'utf8');
    assert.match(doc, /<!-- rcf:begin -->/, `${name} has begin marker`);
    assert.match(doc, /<!-- rcf:end -->/, `${name} has end marker`);
    assert.match(doc, /RULE 1 - Elicit first/, `${name} has rule 1`);
    assert.match(doc, /RULE 2 - The full chain/, `${name} has rule 2`);
    assert.match(doc, /RULE 3 - The test layer/, `${name} has rule 3`);
  }
});

test('existing .mcp.json with another server: merged, other server and unknown keys intact', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-merge-'));
  const existing = {
    mcpServers: { playwright: { command: 'npx', args: ['playwright-mcp'] } },
    someUnknownKey: { keep: true },
  };
  await writeFile(join(tmp, '.mcp.json'), JSON.stringify(existing, null, 2), 'utf8');
  const { code } = await runBinInit(tmp, INIT_ARGS);
  assert.equal(code, 0);
  const mcp = JSON.parse(await readFile(join(tmp, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.playwright, existing.mcpServers.playwright, 'foreign server preserved');
  assert.deepEqual(mcp.someUnknownKey, existing.someUnknownKey, 'unknown top-level key preserved');
  assert.equal(mcp.mcpServers.rcf.command, 'node');
});

test('existing rcf entry in .mcp.json is left alone', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-kept-'));
  const existing = { mcpServers: { rcf: { command: 'node', args: ['/custom/path/rcf.js', 'mcp'] } } };
  await writeFile(join(tmp, '.mcp.json'), JSON.stringify(existing, null, 2), 'utf8');
  const { code, stdout } = await runBinInit(tmp, INIT_ARGS);
  assert.equal(code, 0);
  assert.match(stdout, /already registered in \.mcp\.json \(kept\)/);
  const mcp = JSON.parse(await readFile(join(tmp, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.rcf.args, ['/custom/path/rcf.js', 'mcp']);
});

test('unparseable .mcp.json is refused, never clobbered', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-badjson-'));
  await writeFile(join(tmp, '.mcp.json'), '{not json', 'utf8');
  const { code, stderr } = await runBinInit(tmp, INIT_ARGS);
  assert.equal(code, 2);
  assert.match(stderr, /refusing to modify/);
  assert.equal(await readFile(join(tmp, '.mcp.json'), 'utf8'), '{not json');
});

test('existing CLAUDE.md: fragment appended inside markers, prior content intact, no AGENTS.md invented', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-claude-'));
  const prior = '# My project\n\nPre-existing instructions the user wrote.\n';
  await writeFile(join(tmp, 'CLAUDE.md'), prior, 'utf8');
  const { code, stdout } = await runBinInit(tmp, INIT_ARGS);
  assert.equal(code, 0);
  assert.match(stdout, /Agent instructions\s+updated in CLAUDE\.md/);
  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(claude.startsWith(prior), true, 'prior content intact at the top');
  assert.match(claude, /<!-- rcf:begin -->/);
  // An existing instructions file is the routing target; the other
  // convention's file is NOT invented (only fresh repos get both).
  assert.equal(await fileExists(join(tmp, 'AGENTS.md')), false, 'no AGENTS.md invented');
});

test('existing AGENTS.md and no CLAUDE.md: fragment lands in AGENTS.md, no CLAUDE.md invented', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-agents-'));
  await writeFile(join(tmp, 'AGENTS.md'), '# Agents\n', 'utf8');
  const { code, stdout } = await runBinInit(tmp, INIT_ARGS);
  assert.equal(code, 0);
  assert.match(stdout, /Agent instructions\s+updated in AGENTS\.md/);
  const agents = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
  assert.match(agents, /<!-- rcf:begin -->/);
  assert.equal(await fileExists(join(tmp, 'CLAUDE.md')), false, 'no CLAUDE.md invented');
});

test('re-run idempotency: tree untouched, marked block replaced not duplicated', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-rerun-'));
  await runBinInit(tmp, ['--project-name', 'First', '--non-interactive']);
  const { code, stdout } = await runBinInit(tmp, ['--project-name', 'Second', '--non-interactive']);
  assert.equal(code, 0);
  assert.match(stdout, /already set up here - document chain left untouched/);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  assert.equal(manifest.projectName, 'First', 'tree files never overwritten');
  // Both files were written on the fresh run; re-run must not duplicate
  // the marked block in either.
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const doc = await readFile(join(tmp, name), 'utf8');
    assert.equal(doc.match(/<!-- rcf:begin -->/g).length, 1, `${name}: exactly one begin marker`);
    assert.equal(doc.match(/<!-- rcf:end -->/g).length, 1, `${name}: exactly one end marker`);
  }
});

test('--no-agent-setup: tree only, manual instructions printed, no wiring files', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-boot-optout-'));
  const { code, stdout } = await runBinInit(tmp, [...INIT_ARGS, '--no-agent-setup']);
  assert.equal(code, 0);
  assert.match(stdout, /Set up the RCF document chain under rcf\//);
  assert.match(stdout, /Agent setup skipped/);
  assert.match(stdout, /mcpServers/);
  assert.match(stdout, /harness-template\.md/);
  assert.equal(await fileExists(join(tmp, '.mcp.json')), false);
  assert.equal(await fileExists(join(tmp, 'CLAUDE.md')), false);
});
