// FBS-241 (US-20401, US-20402): the 0.37.0 stage contract in guidance,
// the managed block and the bundle runbook, and the docs on the 0.37.0
// model.
//
// Criteria: 14 (US-20401 9 external, US-20402 5 testOnly; AC-20402-1 was
// removed by the stage-keeper's stop ruling 1 on part A2). Every test is
// a node:test todo case ("FBS-241 round DEFINE", GR-35): it runs and is
// red until FBS-241's round DEFINE drops the marker and BUILD turns it
// green. External criteria drive bin/rcf.js as a child process: the
// harness resolves the bin beside its test/ directory, so in the
// Test-stage run inside the packed artefact installed cold the same
// tests drive the installed bin. TestOnly criteria read this
// repository's docs and READMEs through RCF_CHECKOUT when it is set, else
// from this file's location (GR-34), and assert at the current head
// (section 8.1 docs-at-slice-head). Text is read heading by heading and
// sentence by sentence. Imports: Node builtins and test/_harness/ only
// (GR-40).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { lines, rcf } from '../_harness/spawn.js';
import { commit, initRepo, sha } from '../_harness/git.js';
import { baseSuiteRecord, checkoutPackage, checkoutRoot, editFbs, project, scratch, writeJson } from '../_harness/fixture.js';


const guidance = async (topic) => {
  const r = await rcf(['guidance', ...(topic ? [topic] : [])], {});
  assert.equal(r.code, 0, `rcf guidance ${topic ?? ''} exits 0\n${r.stderr}`);
  return r.stdout;
};

// Markdown headings and sections: a section runs from its heading to the
// next heading of the same or a higher level.
const headingOf = (line) => /^(#{1,6})\s+(.*?)\s*$/.exec(line);
function headings(text) {
  return lines(text).map((l, i) => ({ i, m: headingOf(l) })).filter((x) => x.m).map((x) => ({ i: x.i, level: x.m[1].length, text: x.m[2] }));
}
function section(text, title) {
  const ls = lines(text);
  const hs = headings(text);
  const h = hs.find((x) => x.text === title);
  if (!h) return null;
  const next = hs.find((x) => x.i > h.i && x.level <= h.level);
  return ls.slice(h.i + 1, next ? next.i : undefined).join('\n');
}
// Sentences: each line is split at sentence ends; blank lines and list items break too.
const sentences = (text) => lines(text).flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z`"(])/)).map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------- US-20401

const STAGES = ['DEFINE (commit prefix DEFINE:, role test-author)', 'BUILD (BUILD:, builder)', 'REVIEW (REVIEW:, reviewer)', 'TEST (TEST:, verifier)', 'FINALISE (FINALISE:, stage-keeper)'];

test('AC-20401-1: rcf guidance build-cycle carries the five stage headings in order, TEST running the full RCF suite locally with nothing deployed, FINALISE before the merge writing complete, and a VERIFY (outside the build cycle) section with rcf verify run --record writing verified', async () => {
  const text = await guidance('build-cycle');
  const at = STAGES.map((s) => headings(text).find((h) => h.text === s)?.i ?? -1);
  assert.ok(at.every((i) => i >= 0), `the five stage headings: ${STAGES.filter((_, k) => at[k] < 0).join('; ')} missing`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in that order');
  const testSec = section(text, STAGES[3]);
  for (const p of ['the full RCF suite against a locally running app', 'nothing is deployed']) assert.ok(testSec.includes(p), `TEST section carries "${p}"`);
  const fin = section(text, STAGES[4]);
  for (const p of ['before the merge', 'writes complete']) assert.ok(fin.includes(p), `FINALISE section carries "${p}"`);
  const verify = section(text, 'VERIFY (outside the build cycle)');
  assert.ok(verify !== null, 'a section headed "VERIFY (outside the build cycle)"');
  for (const p of ['rcf verify run', '--record', 'writes verified']) assert.ok(verify.includes(p), `VERIFY section carries "${p}"`);
});

test('AC-20401-2: the Rounds section of rcf guidance build-cycle states, each in its own sentence, that a failed REVIEW (FINDINGS) or TEST closes the round, that the next round starts at DEFINE, that stage order is monotonic within a round, and that Finalise judges the last round only', async () => {
  const rounds = section(await guidance('build-cycle'), 'Rounds');
  assert.ok(rounds !== null, 'a section headed "Rounds"');
  const ss = sentences(rounds);
  const facts = [
    (s) => /REVIEW/.test(s) && /FINDINGS/.test(s) && /TEST/.test(s) && /closes the round/.test(s),
    (s) => /next round starts at DEFINE/.test(s),
    (s) => /monotonic/.test(s) && /within a round/.test(s),
    (s) => /Finalise judges the last round only/.test(s),
  ];
  const where = facts.map((f) => ss.findIndex(f));
  assert.ok(where.every((i) => i >= 0), `each fact is stated\n${ss.join('\n')}`);
  assert.equal(new Set(where).size, 4, `each in its own sentence: ${where.map((i) => ss[i]).join(' | ')}`);
});

test('AC-20401-3: the managed block names the five stages with their prefixes, carries rcf build finalise <fbs-id> --ci-run <ref> writing complete before the merge, states that verified is written only by a release Verify, and its RULE 13 names merging before Finalise has written complete and not verified on the PR branch', async () => {
  const text = await guidance('managed/agent-instructions-block');
  const firsts = ['DEFINE:', 'BUILD:', 'REVIEW:', 'TEST:', 'FINALISE:'].map((p) => text.indexOf(p));
  assert.ok(firsts.every((i) => i >= 0), 'the five commit prefixes are named');
  assert.deepEqual([...firsts].sort((a, b) => a - b), firsts, 'in stage order');
  const paras = text.split(/\n\s*\n/);
  assert.ok(paras.some((p) => p.includes('rcf build finalise <fbs-id> --ci-run <ref>') && p.includes('writes complete') && p.includes('before the merge')), 'the Finalise step writes complete before the merge');
  assert.ok(text.includes('verified is written only by a release Verify (rcf verify run --record)'));
  const ruleAt = lines(text).findIndex((l) => /RULE 13/.test(l));
  assert.ok(ruleAt >= 0, 'RULE 13 is present');
  const rest = lines(text).slice(ruleAt);
  const end = rest.findIndex((l, i) => i > 0 && (/RULE \d+/.test(l) || headingOf(l)));
  const rule = rest.slice(0, end === -1 ? undefined : end).join('\n');
  assert.ok(rule.includes('merging before Finalise has written complete'), `RULE 13 names merging before Finalise has written complete\n${rule.slice(0, 800)}`);
  assert.ok(!rule.includes('verified on the PR branch'), 'RULE 13 no longer names verified on the PR branch');
});

const RUNBOOK_STAGES = ['DEFINE', 'BUILD', 'REVIEW', 'TEST', 'FINALISE'];
const RUNBOOK_COMMANDS = ['rcf build mark FBS-001 inProgress', 'rcf build base-suite', 'rcf build verdict review', 'rcf audit test-strength --record', 'rcf build verdict test', 'rcf build finalise FBS-001 --ci-run <ref>'];
const VERIFY_LINE = 'Verify is outside the round: rcf verify run --release <label> --since <ref> --record before the promote';

// A fixture project in git with FBS-001 titled, and a green record for HEAD.
async function bundleFixture(t) {
  const dir = await project(t, { name: 'runbook' });
  editFbs(dir, 'FBS-001', (f) => { f.title = 'Fixture slice'; });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  const recDir = scratch(t, 'rcf-h-base-');
  writeJson(recDir, 'base.json', baseSuiteRecord(sha(dir)));
  return { dir, rec: join(recDir, 'base.json') };
}

test('AC-20401-4: the closing runbook of rcf build bundle FBS-001 --base-suite <green> --format md lists the five stages in order with dispatch names, commit prefixes and the round commands, ending with the Verify-outside-the-round line, and --format json carries the same in completionContract', async (t) => {
  const { dir, rec } = await bundleFixture(t);
  const md = await rcf(['build', 'bundle', 'FBS-001', '--base-suite', rec, '--format', 'md'], { cwd: dir });
  assert.equal(md.code, 0, `${md.stdout.slice(0, 500)}${md.stderr}`);
  const hs = headings(md.stdout);
  const last = hs[hs.length - 1];
  const runbook = lines(md.stdout).slice(last.i + 1).join('\n');
  const names = RUNBOOK_STAGES.map((s) => runbook.indexOf(`${s} FBS-001: Fixture slice`));
  assert.ok(names.every((i) => i >= 0), `each stage has its dispatch name "<Stage> FBS-001: Fixture slice"\n${runbook.slice(0, 1500)}`);
  assert.deepEqual([...names].sort((a, b) => a - b), names, 'the five stages in order');
  for (const s of RUNBOOK_STAGES) assert.ok(runbook.includes(`${s}:`), `the ${s}: commit prefix`);
  for (const c of RUNBOOK_COMMANDS) assert.ok(runbook.includes(c), `the runbook carries ${c}`);
  const defineAt = names[0];
  assert.ok(runbook.indexOf('rcf build mark FBS-001 inProgress') > defineAt && runbook.indexOf('rcf build mark FBS-001 inProgress') < names[1], 'rcf build mark FBS-001 inProgress sits in the DEFINE stage');
  assert.equal(lines(runbook).filter((l) => l.trim()).pop().trim().replace(/^[-*>]\s*/, ''), VERIFY_LINE, 'the runbook ends with the Verify line');
  const js = await rcf(['build', 'bundle', 'FBS-001', '--base-suite', rec, '--format', 'json'], { cwd: dir });
  assert.equal(js.code, 0, `${js.stdout.slice(0, 500)}${js.stderr}`);
  const contract = JSON.stringify(JSON.parse(js.stdout).completionContract ?? null);
  assert.notEqual(contract, 'null', 'the json carries completionContract');
  const jnames = RUNBOOK_STAGES.map((s) => contract.indexOf(`${s} FBS-001: Fixture slice`));
  assert.ok(jnames.every((i) => i >= 0), 'completionContract names each stage dispatch');
  assert.deepEqual([...jnames].sort((a, b) => a - b), jnames, 'in order');
  for (const c of [...RUNBOOK_COMMANDS, VERIFY_LINE]) assert.ok(contract.includes(c), `completionContract carries ${c}`);
});

// Every forbidden form of AC-20401-5, as a sentence test.
const FORBIDDEN = [
  ['--hand verifier as a TEST step', (s) => s.includes('--hand verifier') && /\bTEST\b|Test[- ]stage|\(Test\)/.test(s)],
  ['rcf build finalise with --report, --mode or --url in one sentence', (s) => /rcf build finalise[^.]*--(report|mode|url)\b/.test(s)],
  ['verified as something Finalise writes', (s) => (/finali[sz]e[^.]*\b(writes?|promot\w*|carries|ingest\w*)\b[^.]*\bverified\b/i.test(s) || /\bmerge carries verified\b/.test(s)) && !/never writes?[^.]*verified|not verified|written only by a release Verify|only by a release Verify/.test(s)],
  ['Hand: mixed', (s) => s.includes('Hand: mixed')],
  ['Separation-Reason', (s) => s.includes('Separation-Reason')],
  ['Hand: outside the 0.37.x transition', (s) => s.includes('Hand:') && !/0\.37/.test(s)],
  ['a Build waits for a spec to be verified', (s) => /\bBuild\b[^.]*\b(waits?|until|before)\b[^.]*\bverified\b/.test(s) && !/never/.test(s)],
];

test('AC-20401-5: no guidance topic, no part of the managed block and no bundle runbook (md or json) carries a 0.36.x verify step, a finalise report flag, Finalise writing verified, Hand: mixed, Separation-Reason, Hand: outside the 0.37.x transition, or a Build waiting for verified', async (t) => {
  const list = await guidance();
  const topics = [...new Set(lines(list).map((l) => /^\s{2}(\S+)\s{2,}/.exec(l)?.[1]).filter(Boolean))];
  assert.ok(topics.includes('build-cycle') && topics.includes('managed/agent-instructions-block'), `the topic list\n${list}`);
  const texts = [];
  for (const topic of topics) texts.push([`guidance ${topic}`, await guidance(topic)]);
  const { dir, rec } = await bundleFixture(t);
  for (const format of ['md', 'json']) {
    const r = await rcf(['build', 'bundle', 'FBS-001', '--base-suite', rec, '--format', format], { cwd: dir });
    assert.equal(r.code, 0, `${format}\n${r.stderr}`);
    const body = format === 'json' ? JSON.stringify(JSON.parse(r.stdout).completionContract ?? {}, null, 1).replace(/\\n/g, '\n') : r.stdout;
    texts.push([`bundle ${format}`, body]);
  }
  // Non-vacuity (F-2): every scanned text is non-blank and yields a
  // sentence, and the texts carrying the Finalise contract each hold a
  // sentence naming rcf build finalise, so the must-not has text to judge.
  for (const [where, text] of texts) assert.ok(text.trim().length > 0 && sentences(text).length > 0, `${where} is non-blank and yields at least one sentence`);
  for (const where of ['guidance build-cycle', 'guidance build-cycle-playbook', 'guidance managed/agent-instructions-block', 'bundle md', 'bundle json']) {
    const text = texts.find(([w]) => w === where)?.[1] ?? '';
    assert.ok(sentences(text).some((s) => s.includes('rcf build finalise')), `${where} holds a sentence naming rcf build finalise`);
  }
  const hits = [];
  for (const [where, text] of texts) {
    for (const s of sentences(text)) for (const [label, bad] of FORBIDDEN) if (bad(s)) hits.push(`${where}: ${label}: ${s.slice(0, 160)}`);
  }
  assert.deepEqual(hits, [], 'no forbidden form');
});

// The five stages and the role that does each stage's work, as the stage
// headings of AC-20401-1 name them.
const STAGE_ROLES = [['DEFINE', 'test-author'], ['BUILD', 'builder'], ['REVIEW', 'reviewer'], ['TEST', 'verifier'], ['FINALISE', 'stage-keeper']];
// A heading names a stage when the stage word stands alone in it, in any
// case, not joined by a hyphen ("Build-cycle", "self-review" name none).
const namesStage = (text, stage) => new RegExp(`(^|[^\\w-])${stage}([^\\w-]|$)`, 'i').test(text);

// Each stage's own section of the playbook (the stage-keeper's ruling F2
// on the independent check): outside fenced code and below the document
// title, the first heading that names that stage and no other of the five,
// running to the next heading of the same or a higher level. Returns
// [stage, heading text, section text], with null for a stage no heading names.
function stageSections(text) {
  const ls = lines(text);
  let fenced = false;
  const hs = [];
  ls.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; return; }
    const m = fenced ? null : headingOf(l);
    if (m) hs.push({ i, level: m[1].length, text: m[2] });
  });
  const body = hs.length && hs[0].level === 1 ? hs.slice(1) : hs;
  return STAGE_ROLES.map(([stage]) => {
    const h = body.find((x) => namesStage(x.text, stage) && STAGE_ROLES.every(([o]) => o === stage || !namesStage(x.text, o)));
    if (!h) return [stage, null, null];
    const next = hs.find((x) => x.i > h.i && x.level <= h.level);
    return [stage, h.text, ls.slice(h.i + 1, next ? next.i : undefined).join('\n')];
  });
}

test('AC-20401-6: the Finalise line of rcf guidance overview reads as a pre-merge step that writes complete with no "CI green, merge, then record", and each stage section of rcf guidance build-cycle-playbook names the role that does the work of that stage, the playbook never using hand as a process concept', async () => {
  const overview = await guidance('overview');
  assert.ok(!overview.includes('CI green, merge, then record'), 'no "CI green, merge, then record"');
  const fin = lines(overview).filter((l) => /Finalise|FINALISE/.test(l));
  assert.ok(fin.some((l) => /before the merge|pre-merge/.test(l) && /writes complete/.test(l)), `a Finalise line reads as a pre-merge step writing complete\n${fin.join('\n')}`);
  const playbook = await guidance('build-cycle-playbook');
  const secs = stageSections(playbook);
  assert.deepEqual(secs.filter(([, h]) => h === null).map(([s]) => s), [], 'the playbook has its own section for each stage (a heading naming that stage)');
  const roleless = secs.filter(([stage, , sec]) => {
    const role = STAGE_ROLES.find(([s]) => s === stage)[1];
    return !sentences(sec).some((s) => /\brole\b/i.test(s) && new RegExp(`(^|[^\\w-])${role}([^\\w-]|$)`).test(s));
  }).map(([stage, h]) => `${stage} ("${h}"): no sentence names "role" with ${STAGE_ROLES.find(([s]) => s === stage)[1]}`);
  assert.deepEqual(roleless, [], 'each stage\'s own section names "role" for who does that stage\'s work');
  const hands = sentences(playbook).filter((s) => /\bhands?\b/i.test(s.replace(/\bby hand\b/gi, '')));
  assert.deepEqual(hands, [], 'hand is never a process concept (the "by hand" idiom excepted)');
});

const TEST_STAGE_0361 = 'rcf verify run --fbs <fbs-id> --hand verifier against the preview or version host';
// The block wraps its lines and marks commands as inline code, so the
// given reads it with line wraps joined and backticks taken out.
const unwrapped = (text) => text.replace(/`/g, '').replace(/\s*\n\s*/g, ' ');

test('AC-20401-7: in a project initialised by the bin whose CLAUDE.md managed block gains back the 0.36.1 Test-stage line, rcf doctor reports the block drifted with its drift row and exit code, and a fresh rcf init project reads clean', async (t) => {
  const fresh = async (name) => {
    const dir = join(scratch(t, `rcf-h-${name}-`), 'project');
    mkdirSync(dir, { recursive: true });
    writeJson(dir, 'package.json', { name: 'fixture-app', version: '1.0.0', private: true });
    const i = await rcf(['init', '--non-interactive'], { cwd: dir });
    assert.equal(i.code, 0, `${i.stdout}${i.stderr}`);
    return dir;
  };
  const clean = await fresh('clean');
  const c = await rcf(['doctor'], { cwd: clean });
  assert.equal(c.code, 0, `${c.stdout}${c.stderr}`);
  assert.ok(lines(c.stdout).includes('rcf doctor: clean.'), c.stdout);

  const dir = await fresh('drift');
  const file = join(dir, 'CLAUDE.md');
  const text = readFileSync(file, 'utf8');
  assert.ok(!unwrapped(text).includes(TEST_STAGE_0361), 'given: the 0.37.0 block no longer carries the 0.36.1 Test-stage line');
  const anchor = text.indexOf('RULE 13');
  assert.ok(anchor > 0, 'the managed block is in CLAUDE.md');
  writeFileSync(file, `${text.slice(0, anchor)}Test stage: ${TEST_STAGE_0361}.\n\n${text.slice(anchor)}`);
  const d = await rcf(['doctor'], { cwd: dir });
  assert.equal(d.code, 3, `${d.stdout}${d.stderr}`);
  assert.ok(lines(d.stdout).includes('rcf doctor: 1 drift item.'), d.stdout);
  assert.ok(lines(d.stdout).some((l) => l.trim().endsWith('CLAUDE.md has a managed block whose text does not match the canonical hash. `rcf doctor --fix` rewrites it in place.')), `the drift row names CLAUDE.md\n${d.stdout}`);
});

// Round C (round B ruling 37 and the round B docs pass): the build loop
// and the Review stage say what the separation audit judges. Prose is
// joined paragraph by paragraph, so a sentence wrapped over lines is one.
const prose = (text) => text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ')).join('\n');

test('AC-20401-8: the Build loop section of rcf guidance managed/agent-instructions-block says every commit carries its stage prefix and that the Hand: trailer is optional through 0.37.x, and no sentence names the hand of each stage by the Hand: trailer alone', async () => {
  const loop = section(await guidance('managed/agent-instructions-block'), 'Build loop');
  assert.ok(loop !== null, 'a section headed "Build loop"');
  const ss = sentences(prose(loop));
  // Any sentence that makes the Hand: trailer mandatory (the stage-keeper's
  // ruling RC-26 on the round C DEFINE), in today's words or any other: it
  // names the trailer, says it is on every (or each, or all) commit, required
  // or mandatory, or that a commit must carry it, and does not say it is
  // optional, not needed or there only where present.
  const makesHandMandatory = (s) => /`?Hand:`?|\bHand trailer\b/.test(s)
    && (/\b(every|each|all) commits?\b/i.test(s) || /\b(required|mandatory)\b/i.test(s) || /\bmust (carry|include|have|add|name)\b/i.test(s))
    && !/\boptional\b|\bnot (?:required|mandatory|needed)\b|\bneed not\b|\bno longer\b|\b(where|when|if) present\b/i.test(s);
  assert.deepEqual(ss.filter(makesHandMandatory), [], 'no sentence makes the Hand: trailer mandatory');
  assert.ok(ss.some((s) => /\bevery commit\b/i.test(s) && /stage prefix/.test(s)), `a sentence says every commit carries its stage prefix\n${ss.join('\n')}`);
  assert.ok(ss.some((s) => /Hand:/.test(s) && /optional/.test(s) && /0\.37\.x/.test(s)), `a sentence says the Hand: trailer is optional through 0.37.x\n${ss.join('\n')}`);
});

test('AC-20401-9: every sentence of rcf guidance build-cycle naming rcf audit separation as a check judges each commit by its stage prefix against the paths it touches, and none says the audit judges the Hand: trailer of a commit', async () => {
  const ss = sentences(prose(await guidance('build-cycle'))).filter((s) => s.includes('rcf audit separation'));
  assert.ok(ss.length > 0, 'build-cycle names rcf audit separation');
  assert.deepEqual(ss.filter((s) => /Hand:`? trailer[^.]*judged|judges?[^.]*Hand:/.test(s)), [], 'no sentence says the audit judges a Hand: trailer');
  assert.ok(ss.some((s) => /stage prefix/.test(s) && /\bpaths?\b/.test(s)), `a sentence says the audit judges each commit's stage prefix against the paths it touches\n${ss.join('\n')}`);
});

// ---------------------------------------------------------------- US-20402

const docText = (rel) => readFileSync(join(checkoutPackage(), rel), 'utf8');
function filesUnder(dir) {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? filesUnder(join(dir, f)) : [join(dir, f)]));
}

test('AC-20402-2: docs/verify-reference.md has the finalise synopsis rcf build finalise <fbs-id> --ci-run <ref>, a modes section naming release mode and calling the catalog and agent modes optional probes that are never a precondition, and a forward catalog contract that no longer says the deterministic engine feeds Finalise', () => {
  const text = docText('docs/verify-reference.md');
  assert.ok(text.includes('rcf build finalise <fbs-id> --ci-run <ref>'), 'the finalise synopsis');
  const modes = headings(text).find((h) => /\bmodes?\b/i.test(h.text));
  assert.ok(modes, 'a modes section');
  const m = section(text, modes.text);
  for (const f of ['--release', '--since', '--record']) assert.ok(m.includes(f), `the modes section names release mode ${f}`);
  assert.ok(/optional probes?/.test(m) && /never a precondition/.test(m), 'catalog and agent modes are optional probes, never a precondition');
  assert.ok(/catalog/i.test(m) && /agent/i.test(m), 'the catalog and agent modes are named');
  const contract = headings(text).find((h) => /catalog contract/i.test(h.text));
  assert.ok(contract, 'the forward catalog contract section');
  const feeds = sentences(section(text, contract.text)).filter((s) => /deterministic/i.test(s) && /[Ff]inali[sz]e/.test(s) && /\bfeeds?\b|\binput\b/.test(s));
  assert.deepEqual(feeds, [], 'the deterministic engine no longer feeds Finalise');
});

test('AC-20402-3: no file under packages/rcf-lite/docs/, packages/rcf-lite/README.md or the root README.md carries rcf build finalise <fbs-id> --url, a finalise synopsis with --mode <mode>, or a sentence saying a spec is verified at Finalise or by the Test stage', () => {
  const files = [...filesUnder(join(checkoutPackage(), 'docs')).filter((f) => /\.(md|txt|html)$/.test(f)), join(checkoutPackage(), 'README.md'), join(checkoutRoot(), 'README.md')];
  // The sentence forms, finalise in any case (F-3): verified at or by
  // Finalise or the Test stage, Finalise or the Test stage writing
  // verified, and finalise promoting to verified. A negation, or a
  // release Verify as the writer, exempts a match only inside the matched
  // span, so a sentence that says "not verified" elsewhere is still judged.
  const VERIFIED_AT = [
    /\bverified\b[^.]*\b(at|by)\s+(finali[sz]e|the Test stage|the TEST stage|TEST)\b/i,
    /\b(finali[sz]e|the Test stage)\b[^.]*\bwrites?\b[^.]*\bverified\b/i,
    /\bfinali[sz]e\b[^.]*\bpromot\w*[^.]*\bverified\b/i,
  ];
  // Non-vacuity (F-3): every scanned file is non-blank, and the three
  // files whose Finalise text the criterion polices each name rcf build
  // finalise with --ci-run <ref> or the complete it writes.
  for (const f of files) assert.ok(readFileSync(f, 'utf8').trim().length > 0, `${f} is non-blank`);
  for (const f of [join(checkoutPackage(), 'docs', 'verify-reference.md'), join(checkoutPackage(), 'README.md'), join(checkoutRoot(), 'README.md')]) {
    assert.ok(sentences(readFileSync(f, 'utf8')).some((s) => s.includes('rcf build finalise') && (s.includes('--ci-run <ref>') || (/\bcomplete\b/.test(s) && /\bwrites?\b/.test(s)))), `${f} holds a sentence naming rcf build finalise with --ci-run <ref> or the complete it writes`);
  }
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (text.includes('rcf build finalise <fbs-id> --url')) hits.push(`${f}: rcf build finalise <fbs-id> --url`);
    for (const l of lines(text)) if (l.includes('rcf build finalise') && l.includes('--mode <mode>')) hits.push(`${f}: finalise synopsis with --mode <mode>`);
    for (const s of sentences(text)) {
      const m = VERIFIED_AT.map((re) => re.exec(s)).find((x) => x && !/never|\bnot\b|release Verify/.test(x[0]));
      if (m) hits.push(`${f}: ${m[0].slice(0, 160)}`);
    }
  }
  assert.deepEqual(hits, [], 'no 0.36.x finalise form and no verified at Finalise or by the Test stage');
});

test('AC-20402-4: the root README.md and packages/rcf-lite/README.md each state that the build cycle ends at complete and that a release Verify writes verified, and neither tells a reader to wait for verified before the next Build', () => {
  for (const f of [join(checkoutRoot(), 'README.md'), join(checkoutPackage(), 'README.md')]) {
    const ss = sentences(readFileSync(f, 'utf8'));
    assert.ok(ss.some((s) => /build cycle/i.test(s) && /ends at complete|ends with complete/.test(s)), `${f}: the build cycle ends at complete`);
    assert.ok(ss.some((s) => /release Verify/.test(s) && /\bwrites verified\b/.test(s)), `${f}: a release Verify writes verified`);
    const wait = ss.filter((s) => /\b(wait|until|before)\b[^.]*\bverified\b[^.]*\bBuild\b|\bBuild\b[^.]*\b(waits?|until)\b[^.]*\bverified\b/.test(s) && !/never|no longer|not/.test(s));
    assert.deepEqual(wait, [], `${f}: no wait for verified before the next Build`);
  }
});

// Round C (the round B docs pass): the audit group in how-it-works and
// the separation job's comment in CI. A sentence may open with bold
// markdown here (the verb map's "**audit**").
const docSentences = (text) => prose(text).split('\n').flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z`"(*])/)).map((x) => x.trim()).filter(Boolean);

test('AC-20402-5: the sentence of docs/how-it-works.md that introduces the audit group does not call the group read-only unless it excepts rcf audit test-strength --record, which writes a record', () => {
  const ss = docSentences(docText('docs/how-it-works.md')).filter((s) => s.startsWith('**audit**'));
  assert.ok(ss.length > 0, 'a sentence introduces the **audit** group');
  assert.deepEqual(ss.filter((s) => /read-only/.test(s) && !/test-strength --record/.test(s)), [], 'the audit group is not called read-only without excepting rcf audit test-strength --record');
});

test('AC-20402-6: the comment introducing the separation job of .github/workflows/ci.yml says the job judges the stage prefix of each commit over the range of the pull request, and does not say it judges a Hand: trailer', () => {
  const ls = readFileSync(join(checkoutRoot(), '.github', 'workflows', 'ci.yml'), 'utf8').split('\n');
  const at = ls.findIndex((l) => /^\s{2}separation:\s*$/.test(l));
  assert.ok(at > 0, 'the separation job');
  let from = at;
  while (from > 0 && /^\s*#/.test(ls[from - 1])) from -= 1;
  const comment = ls.slice(from, at).map((l) => l.replace(/^\s*#\s?/, '')).join(' ');
  assert.ok(comment.length > 0, 'a comment introduces the separation job');
  assert.ok(!/judge[^.]*Hand:/.test(comment), `the comment does not say the job judges a Hand: trailer\n${comment}`);
  assert.ok(/stage prefix/.test(comment) && /pull request's range/.test(comment), `the comment says the job judges each commit's stage prefix over the pull request's range\n${comment}`);
});
