// FBS-224 (US-19004): guidance, the managed block and the README say the new stage contract, and audit is the fifth verb.
//
// One test per AC of US-19004, bound by TS-257. Every test drives
// `node bin/rcf.js` (bin resolved relative to this file, so the same file
// runs in the clone and beside the installed artefact inside
// `rcf verify run --artefact`), or, for the root README and the release
// feed, reads the real file. Fixture projects are built by `rcf init` in
// scratch dirs, with git config isolated from the host.
//
// Readings (FBS-224 Define):
// - A stage's text runs from its heading (build-cycle: `**<n>. <Stage>.**`;
//   the bundle runbook: `### Stage <n> - <Stage>`) to the next stage
//   heading, and for the last stage to the next `## ` heading or the end.
// - "names the merge gate": one sentence of the Test stage text carries
//   Review, MERGE, Test and PASS. "against the preview or version host":
//   the Test stage text names both "preview" and "version host".
// - "every stage names its Hand: trailer value": `Hand: test-author`,
//   `Hand: builder`, `Hand: reviewer`, `Hand: verifier`,
//   `Hand: stage-keeper` in Define, Build, Review, Test, Finalise.
// - "run verification after merge": "post-merge verif", "verify/verification
//   ... after (the) merge" anywhere, and, inside a Finalise stage, an
//   "independent (post-merge) verify run ... pass(es)".
// - "attest as a verb or stage name": `rcf attest`, attest in a
//   define/build/verify/release chain, or attest bolded or in backticks;
//   the English "attest to" and the attestation vocabulary are not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from '../_helpers/scratch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const BIN = join(PACKAGE_ROOT, 'bin', 'rcf.js');
// main's managed block at 253465a6 (the FBS-224 Define base), byte for byte.
const PRE_CHANGE_BLOCK = join(HERE, 'fixtures', 'agent-instructions-block.pre-fbs-224.md');

const MARKER_BEGIN = '<!-- rcf:managed:begin -->';
const MARKER_END = '<!-- rcf:managed:end -->';

// A fresh `rcf init` tree is unfrozen, and bundle --next refuses an
// unfrozen tree unless the freeze gate's own --override records a reason
// (the FBS-221 fixtures pass it the same way).
const FREEZE_OVERRIDE = ['--override', 'fixture: unfrozen tree'];

const STAGES = ['Define', 'Build', 'Review', 'Test', 'Finalise'];
const HANDS = { Define: 'test-author', Build: 'builder', Review: 'reviewer', Test: 'verifier', Finalise: 'stage-keeper' };

// A claude-free PATH for every rcf() call. `rcf init` probes the agent CLI
// (`claude mcp list`) from PATH, and under `rcf verify run --artefact` a
// recording fake `claude` sits first on the inherited one (AC-19301-8). The
// pinned PATH holds only the directory that gives the fixture `git`; node
// comes from process.execPath, so node's own directory (where an npm-global
// claude can sit) is never on it. Refuses loudly if a claude is reachable.
function claudeFreePath(inherited = process.env.PATH ?? '') {
  const dirs = inherited.split(delimiter).filter(Boolean);
  const gitDir = dirs.find((d) => existsSync(join(d, 'git')));
  if (!gitDir) throw new Error(`fixture: no git on the inherited PATH\n${inherited}`);
  const pinned = [gitDir];
  const claude = pinned.map((d) => join(d, 'claude')).find((p) => existsSync(p));
  if (claude) throw new Error(`fixture: the pinned PATH reaches an agent CLI at ${claude}; refusing to run`);
  return pinned.join(delimiter);
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
  return r;
}

async function guidance(topic) {
  return (await must(['guidance', topic])).stdout;
}

async function topics() {
  const listed = (await must(['guidance', '--list'])).stdout.split('\n').filter(Boolean);
  return [...new Set([...listed, 'build-cycle-playbook'])];
}

function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function sentences(text) {
  return flat(text).split(/(?<=[.!?])\s+(?=[A-Z`*(])/);
}

const STAGE_HEAD = /^(?:#{1,4}\s*)?(?:\*\*)?(?:Stage\s+)?([1-5])\s*[.)]?\s*-?\s*(Define|Build|Review|Test|Finalise)\b/;

// Map stage name -> its text, cut by the stage headings the output prints.
function stagesOf(text) {
  const lines = text.split('\n');
  const heads = [];
  lines.forEach((line, i) => {
    const m = STAGE_HEAD.exec(line);
    if (m && STAGES[Number(m[1]) - 1] === m[2]) heads.push({ i, stage: m[2] });
  });
  const out = {};
  heads.forEach((h, k) => {
    let end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    if (k + 1 === heads.length) {
      const nextH2 = lines.findIndex((l, j) => j > h.i && /^## /.test(l));
      if (nextH2 !== -1) end = nextH2;
    }
    out[h.stage] ??= lines.slice(h.i, end).join('\n');
  });
  for (const s of STAGES) assert.ok(out[s], `the output prints a heading for the ${s} stage\n${text.slice(0, 2000)}`);
  return out;
}

function runbookOf(md) {
  const start = md.search(/^## \d+\. Build-cycle runbook/m);
  assert.ok(start !== -1, 'the bundle prints its closing runbook section');
  const rest = md.slice(start);
  const next = rest.slice(3).search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

function finaliseLines(text) {
  return text.split('\n').filter((l) => /rcf build finalise/.test(l));
}

const POST_MERGE_PATTERNS = [
  /post-merge verif/i,
  /\bverif(?:y|ication)\b[^.]{0,40}\bafter (?:the )?merge/i,
];
const FINALISE_VERIFY_RUN = /independent (?:post-merge )?verify run[^.]{0,20}\bpass/i;

// A project built by `rcf init` in a scratch dir, with one actionable FBS
// (FBS-001). `claudeBlock`, when given, replaces the inner text of the
// managed block in CLAUDE.md.
async function project(t, { claudeBlock } = {}) {
  const root = await scratchDir(t, 'rcf-fbs224-');
  await must(['init', '--project-name', 'StageContract', '--non-interactive'], root);
  if (claudeBlock !== undefined) {
    const path = join(root, 'CLAUDE.md');
    const text = await readFile(path, 'utf8');
    const b = text.indexOf(MARKER_BEGIN);
    const e = text.indexOf(MARKER_END, b);
    assert.ok(b !== -1 && e !== -1, 'fixture: rcf init writes a managed block into CLAUDE.md');
    await writeFile(path, `${text.slice(0, b)}${MARKER_BEGIN}\n${claudeBlock.trim()}\n${text.slice(e)}`, 'utf8');
  }
  return root;
}

function agentInstructionRows(envelope) {
  return envelope.drift.filter((d) => d.file === 'CLAUDE.md' || d.file === 'AGENTS.md');
}

async function doctorOnPreChangeBlock(t) {
  const root = await project(t, { claudeBlock: readFileSync(PRE_CHANGE_BLOCK, 'utf8') });
  const r = await rcf(['doctor', '--json'], root);
  const envelope = JSON.parse(r.stdout);
  return { r, envelope };
}

function assertPreChangeBlockDrifted({ r, envelope }) {
  const rows = agentInstructionRows(envelope).filter((d) => d.file === 'CLAUDE.md');
  assert.equal(rows.length, 1, `rcf doctor reports the pre-change block in CLAUDE.md as drifted\n${r.stdout}`);
  assert.equal(rows[0].item, 'stale-hash', `the drift row is the managed block's stale hash\n${r.stdout}`);
  assert.match(rows[0].message, /`rcf doctor --fix`/, 'the drift row names rcf doctor --fix as the refresh command');
  assert.notEqual(r.code, 0, 'rcf doctor does not exit 0');
  assert.equal(envelope.ok, false, 'the doctor envelope is not ok');
}

// The repository root holding this package: walk up from this file (the
// clone) and from the shell's working directory the run inherited (PWD,
// or INIT_CWD under a package manager: inside `rcf verify run --artefact`
// this file runs from a scratch copy, and the verifier's shell sits in the
// clone). The root is the first directory holding both README.md and
// packages/rcf-lite/package.json; the package's own README never stands in.
function rootReadme() {
  const starts = [HERE, process.env.PWD, process.env.INIT_CWD].filter(Boolean);
  for (const start of starts) {
    let dir = resolve(start);
    for (;;) {
      if (existsSync(join(dir, 'README.md')) && existsSync(join(dir, 'packages', 'rcf-lite', 'package.json'))) return join(dir, 'README.md');
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return assert.fail(`no repository root with README.md and packages/rcf-lite/package.json above ${starts.join(', ')}`);
}

// One sentence of a feed entry's notes saying the managed block is
// unchanged since an earlier release, as every patch that keeps the block
// says ("the managed agent-instructions block and the ... pin are unchanged
// since 0.36.0."). A dot followed by a non-space (a version number) does
// not end the sentence.
const BLOCK_UNCHANGED_SINCE = /managed agent-instructions block\b(?:[^\n".]|\.(?=\S))*?\bunchanged since (\d+\.\d+\.\d+)\b/i;

// The release feed, newest first, read line by line.
function feedEntries() {
  const feed = readFileSync(join(PACKAGE_ROOT, 'releases', 'releases.yaml'), 'utf8');
  return feed.split(/^ {2}- version: /m).slice(1).map((block) => {
    const version = block.split('\n', 1)[0].trim().replace(/^"(.*)"$/, '$1');
    const action = /^ {4}minAgentAction: *(.*)$/m.exec(block)?.[1]?.trim();
    return { version, block, minAgentAction: action === undefined || action === 'null' || action === '' ? null : action };
  });
}

// The feed entry of the release that first shipped the managed block the
// installed package carries. Reading (AC-19004-4, 2026-10-24): "the
// release notes" are those of the release that changed the block, not of
// every later release, since a patch that leaves the block unchanged
// rightly carries a null minAgentAction (feed header rule 5). The repo
// records only the current block hash, not one per release, so the walk
// reads the feed: start at the installed version's entry and, while an
// entry's notes say the managed block is unchanged since <version>, move
// to that version's entry. The first entry that does not say so shipped
// the current block. The walk reads only the newer entries' pointers,
// never the minAgentAction, rcf doctor or managed-block wording the test
// asserts of the entry it lands on, so a fault there cannot move it.
function blockReleaseEntry() {
  const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const entries = feedEntries();
  let at = entries.findIndex((e) => e.version === version);
  assert.ok(at !== -1, `releases/releases.yaml carries an entry for the installed version ${version}`);
  const walk = [version];
  for (;;) {
    const since = BLOCK_UNCHANGED_SINCE.exec(entries[at].block)?.[1];
    if (!since) return { ...entries[at], installed: version, walk };
    const next = entries.findIndex((e) => e.version === since);
    assert.ok(next > at, `release ${entries[at].version} says the managed block is unchanged since ${since}, an older release the feed carries`);
    at = next;
    walk.push(since);
  }
}

function attestAsVerbOrStage(text) {
  return [
    /\brcf attest\b/,
    /\b(?:define|build|verify|release),\s*\**\s*attest\b/i,
    /\*\*attest\*\*/i,
    /`attest`/i,
  ].filter((re) => re.test(text)).map(String);
}

test('AC-19004-5: the root README and every rcf guidance topic read define, build, verify, release, audit as the stage chain and never name attest as a verb or stage, leaving AC attestation and --litmus-attested as they are', async (t) => {
  await t.test('the root README reads define, build, verify, release, audit and never names attest', () => {
    const readme = readFileSync(rootReadme(), 'utf8');
    assert.match(readme, /define, build, verify, release, audit\b/, 'the root README stage chain reads define, build, verify, release, audit');
    const lines = readme.split('\n').filter((l) => /\battest\b/i.test(l));
    assert.deepEqual(lines, [], 'the root README never names attest');
  });

  await t.test('guard (green at Define): no guidance topic names attest as a verb or stage, and any stage chain a topic prints ends in audit', async () => {
    const all = await topics();
    for (const want of ['build-cycle', 'build-cycle-playbook', 'managed/agent-instructions-block']) assert.ok(all.includes(want), `rcf guidance lists ${want} (${all.length} topics)`);
    const hits = [];
    for (const topic of all) {
      const text = await guidance(topic);
      const found = attestAsVerbOrStage(text);
      if (found.length) hits.push(`${topic}: ${found.join(', ')}`);
      const chain = /define, build, verify, release, (\w+)/i.exec(flat(text));
      if (chain && chain[1].toLowerCase() !== 'audit') hits.push(`${topic}: chain ends in ${chain[1]}`);
    }
    assert.deepEqual(hits, [], 'no guidance topic names attest as a verb or stage');
  });

  await t.test('guard (green at Define): the AC attestation vocabulary and the --litmus-attested flag stay as they are', async () => {
    const playbook = await guidance('build-cycle-playbook');
    assert.ok(playbook.includes('--mode <attestationMode>'), 'the playbook keeps --mode <attestationMode> on rcf build fbs depends-on');
    assert.match(playbook, /\battestation\b/, 'the playbook keeps the attestation vocabulary');
    const freeze = await must(['help', 'define', 'freeze']);
    assert.match(freeze.stdout, /--litmus-attested <D3,\.\.>/, 'rcf help define freeze keeps --litmus-attested');
  });
});

test('AC-19004-6: rcf doctor on a project whose CLAUDE.md or AGENTS.md carries the pre-change managed block reports it drifted, names rcf doctor --fix and exits non-zero', async (t) => {
  await t.test('the pre-change block (main at 253465a6, byte for byte) is reported drifted, names rcf doctor --fix and does not exit 0', async (st) => {
    assertPreChangeBlockDrifted(await doctorOnPreChangeBlock(st));
  });

  await t.test('control (green at Define): the same project carrying the installed canonical block reads clean for the managed-block check', async (st) => {
    const root = await project(st, { claudeBlock: await guidance('managed/agent-instructions-block') });
    const r = await rcf(['doctor', '--json'], root);
    const rows = agentInstructionRows(JSON.parse(r.stdout));
    assert.deepEqual(rows, [], `the canonical block reads clean\n${r.stdout}`);
  });
});
