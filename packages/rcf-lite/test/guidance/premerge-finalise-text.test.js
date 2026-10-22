// FBS-230 (US-19005, AC-19005-10): the shipped text describes Finalise on the
// PR branch before the merge and accepted loopback targets with a served sha,
// and no longer tells a hand to mark complete or finalise after the merge.
//
// Every surface is read through the real entry point, `node bin/rcf.js`:
// rcf build finalise --help, rcf build --help, rcf guidance build-cycle,
// rcf guidance build-cycle-playbook, the managed block rcf init writes into
// CLAUDE.md, and the closing runbook of rcf build bundle --next --format md in
// that project. Children run with a PATH pinned to the directory holding git
// (claudeFreePath, as in test/guidance/stage-contract.test.js), so rcf init
// can never reach the agent CLI.
//
// Readings: a surface "contains" a phrase when its text, with whitespace
// collapsed and markdown emphasis and backticks removed, contains it
// case-insensitively. The forbidden shapes are read on the same flattened
// text, within one sentence (no full stop between the parts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scratchDir } from '../_helpers/scratch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const BIN = join(PACKAGE_ROOT, 'bin', 'rcf.js');

const MARKER_BEGIN = '<!-- rcf:managed:begin -->';
const MARKER_END = '<!-- rcf:managed:end -->';
const FREEZE_OVERRIDE = ['--override', 'fixture: unfrozen tree'];

const PRE_MERGE = 'on the PR branch before the merge';
const SERVED_SHA = /served sha|servedSha/i;
const FORBIDDEN = [
  ['"the CI run that passed on the merged head"', /the CI run that passed on the merged head/i],
  ['a mark-complete step after the merge', /\bmark\b[^.]{0,60}\bcomplete\b[^.]{0,40}\bafter (?:the )?merge\b/i],
  ['"After the merge" followed by rcf build mark or rcf build finalise', /\bafter (?:the )?merge\b[^.]{0,10}rcf build (?:mark|finalise)\b/i],
  ['"marking complete before the merge" or "marking complete pre-merge"', /\bmarking complete (?:before the merge|pre-merge)/i],
];

function claudeFreePath(inherited = process.env.PATH ?? '') {
  const dirs = inherited.split(delimiter).filter(Boolean);
  const gitDir = dirs.find((d) => existsSync(join(d, 'git')));
  if (!gitDir) throw new Error(`fixture: no git on the inherited PATH\n${inherited}`);
  const claude = join(gitDir, 'claude');
  if (existsSync(claude)) throw new Error(`fixture: the pinned PATH reaches an agent CLI at ${claude}; refusing to run`);
  return gitDir;
}

const ENV = {
  ...process.env,
  PATH: claudeFreePath(),
  CI: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
};

function rcf(args, cwd = PACKAGE_ROOT) {
  return new Promise((res) => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 90_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function must(args, cwd) {
  const r = await rcf(args, cwd);
  assert.equal(r.code, 0, `rcf ${args.join(' ')} exits 0\nstderr:\n${r.stderr}`);
  return r.stdout;
}

function flat(text) {
  return text.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
}

// The text between a heading matching `from` and the next heading matching `to`.
function section(text, from, to) {
  const start = text.search(from);
  assert.ok(start !== -1, `the text carries a heading matching ${from}`);
  const rest = text.slice(start);
  const eol = rest.indexOf('\n') + 1 || rest.length;
  const end = rest.slice(eol).search(to);
  return end === -1 ? rest : rest.slice(0, eol + end);
}

// Every surface AC-19005-10 names, read through bin/rcf.js. `whole` is the
// text the forbidden shapes are read on; `part` the text the positive phrases
// must appear in.
async function surfaces() {
  const root = await scratchDir('rcf-fbs230-text-');
  await must(['init', '--project-name', 'PreMergeText', '--non-interactive'], root);
  const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8');
  const b = claude.indexOf(MARKER_BEGIN);
  const e = claude.indexOf(MARKER_END, b);
  assert.ok(b !== -1 && e !== -1, 'fixture: rcf init writes a managed block into CLAUDE.md');
  const block = claude.slice(b, e);

  const bundle = await must(['build', 'bundle', '--next', '--format', 'md', ...FREEZE_OVERRIDE], root);
  const runbook = section(bundle, /^## \d+\. Build-cycle runbook/m, /^## /m);
  const stage5 = section(runbook, /^### Stage 5 - Finalise/m, /^#{2,3} /m);

  const playbook = await must(['guidance', 'build-cycle-playbook']);
  const playbook67 = section(playbook, /^## 6\. /m, /^## 8\. /m);

  const finaliseHelp = await must(['build', 'finalise', '--help']);
  const buildHelp = await must(['build', '--help']);
  const buildCycle = await must(['guidance', 'build-cycle']);
  return [
    { name: 'rcf build finalise --help', part: finaliseHelp, whole: finaliseHelp },
    { name: 'rcf build --help', part: buildHelp, whole: buildHelp },
    { name: 'rcf guidance build-cycle', part: buildCycle, whole: buildCycle },
    { name: 'rcf guidance build-cycle-playbook (sections 6 and 7; whole playbook for the forbidden shapes)', part: playbook67, whole: playbook },
    { name: 'the managed block in CLAUDE.md', part: block, whole: block },
    { name: 'the rcf build bundle --next runbook (Stage 5; whole runbook for the forbidden shapes)', part: stage5, whole: runbook },
  ];
}

test('AC-19005-10: rcf build finalise --help, rcf build --help, rcf guidance build-cycle, the playbook (sections 6 and 7), the managed block and the bundle runbook Stage 5 say "on the PR branch before the merge" and name loopback targets with a served sha, and none says "the CI run that passed on the merged head" or puts mark complete or finalise after the merge', async (t) => {
  const all = await surfaces();
  for (const s of all) {
    await t.test(`${s.name}: says "${PRE_MERGE}" and names loopback targets with a served sha`, () => {
      const text = flat(s.part);
      assert.ok(text.toLowerCase().includes(PRE_MERGE.toLowerCase()), `${s.name} contains "${PRE_MERGE}"\n${s.part}`);
      assert.match(text, /\bloopback\b/i, `${s.name} names loopback targets`);
      assert.match(text, SERVED_SHA, `${s.name} names the served sha`);
    });
  }
  for (const s of all) {
    await t.test(`${s.name}: carries none of the after-the-merge Finalise shapes`, () => {
      const text = flat(s.whole);
      const bad = FORBIDDEN.filter(([, re]) => re.test(text)).map(([label, re]) => `${label}: "${text.match(re)[0]}"`);
      assert.deepEqual(bad, [], `${s.name} carries no after-the-merge Finalise shape`);
    });
  }
});
