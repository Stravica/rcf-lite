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

// The release feed entry for the installed package's version (the top
// entry, by validate-releases invariant 3), read line by line.
function releaseEntry() {
  const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const feed = readFileSync(join(PACKAGE_ROOT, 'releases', 'releases.yaml'), 'utf8');
  const blocks = feed.split(/^ {2}- version: /m).slice(1);
  const block = blocks.find((b) => b.startsWith(`"${version}"`) || b.startsWith(`${version}\n`));
  assert.ok(block, `releases/releases.yaml carries an entry for the installed version ${version}`);
  const action = /^ {4}minAgentAction: *(.*)$/m.exec(block)?.[1]?.trim();
  return { version, block, minAgentAction: action === undefined || action === 'null' || action === '' ? null : action };
}

function attestAsVerbOrStage(text) {
  return [
    /\brcf attest\b/,
    /\b(?:define|build|verify|release),\s*\**\s*attest\b/i,
    /\*\*attest\*\*/i,
    /`attest`/i,
  ].filter((re) => re.test(text)).map(String);
}

test('AC-19004-1: rcf guidance build-cycle exits 0 and its Test stage names the verifier hand, rcf verify run --fbs <fbs-id> --hand verifier and rcf/verify-reports/, its Finalise stage names rcf build finalise <fbs-id> --ci-run <ref>, with no "--url <deploy-url>" and no "post-merge verify run"', async (t) => {
  const page = await guidance('build-cycle');
  const stage = stagesOf(page);

  await t.test('the Test stage names the verifier hand, rcf verify run --fbs <fbs-id> --hand verifier, the preview or version host and rcf/verify-reports/', () => {
    const s = stage.Test;
    assert.match(s, /\bverifier\b/, 'Test stage names the verifier hand');
    assert.ok(s.includes('rcf verify run --fbs <fbs-id> --hand verifier'), `Test stage names rcf verify run --fbs <fbs-id> --hand verifier\n${s}`);
    assert.match(s, /preview/i, 'Test stage names the preview host');
    assert.match(s, /version host/i, 'Test stage names the version host');
    assert.ok(s.includes('rcf/verify-reports/'), 'Test stage names the committed report under rcf/verify-reports/');
  });

  await t.test('the Test stage names the merge gate: Review MERGE plus Test PASS in one sentence', () => {
    const gate = sentences(stage.Test).find((x) => /\bReview\b/.test(x) && /\bMERGE\b/.test(x) && /\bTest\b/.test(x) && /\bPASS\b/.test(x));
    assert.ok(gate, `one sentence of the Test stage carries Review, MERGE, Test and PASS\n${stage.Test}`);
  });

  await t.test('the Finalise stage names rcf build finalise <fbs-id> --ci-run <ref> ingesting the report', () => {
    const s = stage.Finalise;
    assert.ok(s.includes('rcf build finalise <fbs-id> --ci-run <ref>'), `Finalise stage names rcf build finalise <fbs-id> --ci-run <ref>\n${s}`);
    assert.match(flat(s), /\bingest\w*\b[^.]{0,80}\breport\b/i, 'Finalise stage says finalise ingests the report');
  });

  await t.test('guard (green at Define): the Finalise stage names CI green, the merge and rcf build mark <fbs-id> complete', () => {
    const s = stage.Finalise;
    assert.match(s, /CI green/, 'Finalise stage names CI green');
    assert.match(s, /\bmerge/i, 'Finalise stage names the merge');
    assert.ok(s.includes('rcf build mark <fbs-id> complete'), 'Finalise stage names rcf build mark <fbs-id> complete');
  });

  await t.test('the output carries no "--url <deploy-url>" on a finalise line and no "post-merge verify run"', () => {
    const bad = finaliseLines(page).filter((l) => l.includes('--url <deploy-url>'));
    assert.deepEqual(bad, [], 'no rcf build finalise line carries --url <deploy-url>');
    assert.ok(!flat(page).includes('post-merge verify run'), 'the output never says "post-merge verify run"');
  });
});

test('AC-19004-2: rcf guidance build-cycle exits 0 with the Define stage naming the test-author hand and TS/TC bindings, the Build stage naming the builder for production code, Code Nodes and code-hygiene unit tests only, and every stage naming its Hand: trailer', async (t) => {
  const stage = stagesOf(await guidance('build-cycle'));

  await t.test('the Define stage names the test-author hand writing AC-based and E2E tests and TS/TC bindings', () => {
    const s = flat(stage.Define);
    assert.match(s, /\btest-author\b/, `Define stage names the test-author hand\n${s}`);
    assert.match(s, /AC-based/i, 'Define stage names AC-based tests');
    assert.match(s, /\bE2E\b/, 'Define stage names E2E tests');
    assert.match(s, /TS\s*\/\s*TC|test-suite and test-case/i, 'Define stage names the TS/TC records');
    assert.match(s, /\bbinding/i, 'Define stage names the bindings');
  });

  await t.test('the Build stage names the builder writing production code, Code Nodes and code-hygiene unit tests only', () => {
    const s = flat(stage.Build);
    assert.match(s, /\bbuilder\b/, `Build stage names the builder hand\n${s}`);
    assert.match(s, /production code/i, 'Build stage names production code');
    assert.match(s, /Code Nodes?/, 'Build stage names Code Nodes');
    assert.match(s, /code-hygiene unit tests/i, 'Build stage names code-hygiene unit tests');
    assert.match(s, /\bonly\b/i, 'Build stage limits the builder ("only")');
  });

  await t.test('every stage names its Hand: trailer value', () => {
    const missing = STAGES.filter((s) => !stage[s].includes(`Hand: ${HANDS[s]}`)).map((s) => `${s}: Hand: ${HANDS[s]}`);
    assert.deepEqual(missing, [], 'each stage names its Hand: trailer value');
  });
});

test('AC-19004-3: rcf build bundle --next --format md closes with a runbook listing the five stages and hands, rcf verify run --hand verifier, rcf audit separation and rcf build finalise <fbs-id> --ci-run <ref>, with no finalise --mode or --url', async (t) => {
  const root = await project(t);
  const r = await must(['build', 'bundle', '--next', '--format', 'md', ...FREEZE_OVERRIDE], root);
  assert.ok(r.stdout.includes('# Spec bundle: FBS-001'), 'fixture: FBS-001 is the next actionable item');
  const runbook = runbookOf(r.stdout);

  await t.test('guard (green at Define): the runbook prints the five stage headings', () => {
    stagesOf(runbook);
  });

  await t.test('each runbook stage names its hand', () => {
    const stage = stagesOf(runbook);
    const missing = STAGES.filter((s) => !new RegExp(`\\b${HANDS[s]}\\b`).test(stage[s])).map((s) => `${s}: ${HANDS[s]}`);
    assert.deepEqual(missing, [], 'each stage of the runbook names its hand');
  });

  await t.test('the runbook names the Test-stage rcf verify run with --hand verifier, rcf audit separation and rcf build finalise FBS-001 --ci-run <ref>', () => {
    assert.match(runbook, /rcf verify run\b[^\n]*--hand verifier/, 'the runbook names rcf verify run ... --hand verifier');
    assert.match(stagesOf(runbook).Test, /rcf verify run\b[^\n]*--hand verifier/, 'the rcf verify run command sits in the Test stage');
    assert.ok(runbook.includes('rcf audit separation'), 'the runbook names rcf audit separation');
    assert.ok(runbook.includes('rcf build finalise FBS-001 --ci-run <ref>'), `the runbook names rcf build finalise FBS-001 --ci-run <ref>\n${runbook.slice(-1200)}`);
  });

  await t.test('no finalise line of the runbook carries --mode or --url', () => {
    const bad = finaliseLines(runbook).filter((l) => /--mode\b|--url\b/.test(l));
    assert.deepEqual(bad, [], 'no rcf build finalise line carries --mode or --url');
  });
});

test('AC-19004-4: rcf guidance managed/agent-instructions-block states verified is written only by rcf build finalise from a Test-stage report, the release notes carry a non-null minAgentAction, and rcf doctor reports the old block as drifted', async (t) => {
  await t.test('the block states verified is written only by rcf build finalise from a Test-stage report', async () => {
    const block = await guidance('managed/agent-instructions-block');
    const said = sentences(block).find((s) => /rcf build finalise/.test(s) && /\bverified\b/.test(s) && /\bonly\b/i.test(s)
      && /Test[- ]stage(?:'s)? (?:committed )?report|report (?:of|from|written (?:at|by)) the Test stage/i.test(s));
    assert.ok(said, 'one sentence of the block says verified is written only by rcf build finalise from a Test-stage report');
  });

  await t.test('the release notes for the installed version carry a non-null minAgentAction and tell agents to refresh the block with rcf doctor', () => {
    const entry = releaseEntry();
    assert.notEqual(entry.minAgentAction, null, `release ${entry.version} carries a non-null minAgentAction`);
    assert.match(entry.block, /rcf doctor/, `release ${entry.version}'s notes tell agents to refresh the block with rcf doctor`);
    assert.match(entry.block, /managed agent-instructions block|managed block/i, `release ${entry.version}'s notes name the managed block`);
  });

  await t.test('rcf doctor reports the pre-change block as drifted', async (st) => {
    assertPreChangeBlockDrifted(await doctorOnPreChangeBlock(st));
  });
});

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

test('AC-19004-7: no rcf guidance topic and no rcf build bundle --next runbook tells a hand to run rcf build finalise with --mode or --url, or to run verification after merge', async (t) => {
  const pages = [];
  for (const topic of await topics()) pages.push({ where: `guidance ${topic}`, text: await guidance(topic) });
  const root = await project(t);
  const bundle = await must(['build', 'bundle', '--next', '--format', 'md', ...FREEZE_OVERRIDE], root);
  pages.push({ where: 'bundle --next runbook', text: runbookOf(bundle.stdout) });

  await t.test('no rcf build finalise line carries --mode or --url', () => {
    const bad = pages.flatMap(({ where, text }) => finaliseLines(text).filter((l) => /--mode\b|--url\b/.test(l)).map((l) => `${where}: ${l.trim()}`));
    assert.deepEqual(bad, [], 'no guidance topic or runbook line runs rcf build finalise with --mode or --url');
  });

  await t.test('nothing tells a hand to run verification after merge', () => {
    const bad = [];
    for (const { where, text } of pages) {
      for (const re of POST_MERGE_PATTERNS) if (re.test(flat(text))) bad.push(`${where}: ${re}`);
      if (where === 'guidance build-cycle' || where === 'bundle --next runbook') {
        if (FINALISE_VERIFY_RUN.test(flat(stagesOf(text).Finalise))) bad.push(`${where} Finalise: ${FINALISE_VERIFY_RUN}`);
      }
    }
    assert.deepEqual(bad, [], 'no guidance topic or runbook tells a hand to run verification after merge');
  });
});
