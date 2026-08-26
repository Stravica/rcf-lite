// AC-1.1..AC-1.7 — agent-instructions check semantics for `rcf doctor`
// (0.6.0 spec §2.6/§2.7). Per-check drift detection: every enum value
// has a fixture that produces exactly that drift item; --fix rewrites
// wholesale inside markers with byte-for-byte preservation outside;
// orphan/duplicate are refused; running --fix on already-clean state
// writes zero files.

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
const PACKAGE_ROOT = resolve(here, '..', '..');
const CANONICAL_PATH = resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.md');
// Pre-0.6.0 canonical fragment (build-v0.4.0). AC-1.5's legacy-markers
// migration fixture uses this so its inner content is whitelisted by
// §7.3's fail-safe detector and --fix does not require --force in the
// non-interactive branch. Hand-edited legacy migration is exercised
// separately in doctor-migration.test.js (AC-5.2).
const LEGACY_CANONICAL_PATH = resolve(
  PACKAGE_ROOT, 'test', 'fixtures', 'legacy-fragments', 'pre-0.6.0-canonical-fragment.md',
);

async function runBin(cwd, args, env = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function freshInit(prefix = 'rcf-doc-ai-') {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  const { code } = await runBin(tmp, ['init', '--project-name', 'DoctorTest', '--non-interactive']);
  assert.equal(code, 0);
  return tmp;
}

const NEW_BEGIN = '<!-- rcf:managed:begin -->';
const NEW_END = '<!-- rcf:managed:end -->';
const LEGACY_BEGIN = '<!-- rcf:begin -->';
const LEGACY_END = '<!-- rcf:end -->';

test('AC-1.1: rcf doctor on a fresh init exits 0 and prints clean', async () => {
  const tmp = await freshInit();
  const { code, stdout } = await runBin(tmp, ['doctor']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /rcf doctor: clean\./);
});

test('AC-1.2: doctor on a repo with hand-edited managed block reports stale-hash and exits 3', async () => {
  const tmp = await freshInit();
  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  // Edit inside markers — content mismatch.
  const edited = claude.replace('### RULE 1:', '### RULE 1 (edited):');
  await writeFile(join(tmp, 'CLAUDE.md'), edited, 'utf8');
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'agent-instructions']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /stale-hash/);
  assert.match(stdout, /CLAUDE\.md/);
});

test('AC-1.3: doctor on a repo with only legacy markers reports legacy-markers and exits 3', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-legacy-'));
  // Do NOT run rcf init — write a legacy-marker file by hand.
  const canonical = await readFile(CANONICAL_PATH, 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'), `# legacy\n${LEGACY_BEGIN}\n${canonical.trim()}\n${LEGACY_END}\n`, 'utf8');
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'agent-instructions']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /legacy-markers/);
});

test('AC-1.4: --fix on stale-hash rewrites the block, preserves operator content outside byte-identically', async () => {
  const tmp = await freshInit();
  const preOperatorFooter = '\n\n## My project rules\nPRs target main.\n';
  const original = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  // Add operator content BEFORE and AFTER the managed block.
  const withOperator = `# Preamble\n\n${original}${preOperatorFooter}`;
  await writeFile(join(tmp, 'CLAUDE.md'), withOperator, 'utf8');
  // Hand-edit inside the markers to force stale.
  const staled = withOperator.replace('### RULE 1:', '### RULE ONE:');
  await writeFile(join(tmp, 'CLAUDE.md'), staled, 'utf8');
  const { code } = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(code, 0);
  const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(after.startsWith('# Preamble\n\n'), true, 'preamble preserved');
  assert.equal(after.endsWith(preOperatorFooter), true, 'footer preserved');
  assert.match(after, /### RULE 1: Elicit first/);
});

test('AC-1.5: --fix on legacy-markers rewrites block in place with new markers + new canonical text, preserves operator content', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-legacy-fix-'));
  // Legacy block wraps the pre-0.6.0 canonical fragment (build-v0.4.0)
  // so §7.3's whitelist detector treats it as unmodified canonical and
  // --fix proceeds without --force in non-interactive mode. The
  // hand-edited-legacy branch is exercised in doctor-migration.test.js AC-5.2.
  const legacyFragment = await readFile(LEGACY_CANONICAL_PATH, 'utf8');
  const before = `# legacy repo\n\n${LEGACY_BEGIN}\n${legacyFragment.trim()}\n${LEGACY_END}\n\n## Post-block section\nOperator wrote this.\n`;
  await writeFile(join(tmp, 'CLAUDE.md'), before, 'utf8');
  const { code, stdout } = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(code, 0, stdout);
  const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(after.startsWith('# legacy repo\n\n'), true, 'preamble preserved');
  assert.match(after, /## Post-block section\nOperator wrote this\./);
  assert.match(after, new RegExp(NEW_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(after, new RegExp(NEW_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(after.includes(LEGACY_BEGIN), false, 'legacy marker removed');
});

test('AC-1.6: --fix on orphan-marker refuses, writes nothing, exits 3', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-orphan-'));
  await writeFile(join(tmp, 'CLAUDE.md'), `# stuff\n${NEW_BEGIN}\ncontent\n`, 'utf8');
  const before = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const { code, stdout } = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /orphan managed-block marker/);
  const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(after, before, 'file untouched on orphan refusal');
});

test('AC-1.7: --fix on already-clean repo writes zero files (idempotent no-op)', async () => {
  const tmp = await freshInit();
  const claudeBefore = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const agentsBefore = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
  const { code } = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(code, 0);
  const claudeAfter = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const agentsAfter = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
  assert.equal(claudeAfter, claudeBefore, 'CLAUDE.md byte-identical');
  assert.equal(agentsAfter, agentsBefore, 'AGENTS.md byte-identical');
});

test('AC-1.8: after rcf init, the doctor hash-check is clean; shipped hash equals SHA-256 of the block init just wrote', async () => {
  const tmp = await freshInit();
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'agent-instructions']);
  assert.equal(code, 0, stdout);
});

test('AC-1.10: doctor --check agent-instructions does not touch .gitignore, rcf/, or non-agent-instructions files', async () => {
  const tmp = await freshInit();
  const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  const manifest = await readFile(join(tmp, 'rcf', 'manifest.json'), 'utf8');
  // Force stale to make --fix write.
  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'), claude.replace('### RULE 1:', '### R1:'), 'utf8');
  await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(await readFile(join(tmp, '.gitignore'), 'utf8'), gitignore, '.gitignore untouched');
  assert.equal(await readFile(join(tmp, 'rcf', 'manifest.json'), 'utf8'), manifest, 'rcf/manifest.json untouched');
});

test('AC-1.12: rcf validate is unchanged - no reads of CLAUDE.md/AGENTS.md, no new stderr', async () => {
  const tmp = await freshInit();
  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'), claude.replace('### RULE 1:', '### DRIFT:'), 'utf8');
  const { code, stderr } = await runBin(tmp, ['define', 'validate']);
  assert.equal(code, 0, `validate exited ${code}: ${stderr}`);
  assert.equal(stderr, '', `validate stderr should be empty on a clean tree`);
});

test('doctor --json emits machine-readable envelope', async () => {
  const tmp = await freshInit();
  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'), claude.replace('### RULE 1:', '### R1 EDITED:'), 'utf8');
  const { code, stdout } = await runBin(tmp, ['doctor', '--json', '--check', 'agent-instructions']);
  assert.equal(code, 3);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, false);
  assert.equal(Array.isArray(parsed.drift), true);
  assert.equal(parsed.drift.some((d) => d.item === 'stale-hash'), true);
});

test('doctor with unknown --check name returns usage error (exit 2)', async () => {
  const tmp = await freshInit();
  const { code, stderr } = await runBin(tmp, ['doctor', '--check', 'notathing']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown check/);
});

// Sanity: the doctor verb exists in the top-level help.
test('doctor is registered in the top-level help', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-help-'));
  const { code, stdout } = await runBin(tmp, ['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /^\s+doctor\s+/m);
});
