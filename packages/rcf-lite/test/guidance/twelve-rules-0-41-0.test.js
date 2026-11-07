// FBS-243 (US-20503, US-20504): the managed agent-instructions block, the
// build-cycle guidance, the bundle runbook and the overview state the
// twelve rules of the build cycle (Baz decision 14; Dave's rulings R0 E1,
// R4 and R5; contract rows C5 and C6).
//
// Criteria: AC-20503-1 to AC-20503-3 (the block through rcf guidance, rcf
// init writing it, rcf doctor upgrading a 0.40.1 block) and AC-20504-1 to
// AC-20504-3 (rcf guidance build-cycle and rcf://docs/build-cycle, the
// bundle runbook, rcf guidance overview). Every assertion reads what the
// bin prints or what the MCP server serves; the doctor test starts from
// test/fixtures/managed-block-0-40-1/CLAUDE.md, the block the 0.40.1 bin's
// rcf init wrote, between project text of its own. Imports: Node
// builtins and test/_harness/ only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BIN, PACKAGE_ROOT, baseEnv, lines, rcf } from '../_harness/spawn.js';
import { commit, initRepo, sha } from '../_harness/git.js';
import { baseSuiteRecord, editFbs, project, scratch, writeJson } from '../_harness/fixture.js';

const BEGIN = '<!-- rcf:managed:begin -->\n';
const END = '<!-- rcf:managed:end -->';
const FIXTURE_0_40_1 = join(PACKAGE_ROOT, 'test', 'fixtures', 'managed-block-0-40-1', 'CLAUDE.md');

const guidance = async (topic) => {
  const r = await rcf(['guidance', topic], {});
  assert.equal(r.code, 0, `rcf guidance ${topic} exits 0\n${r.stderr}`);
  return r.stdout;
};
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const headingOf = (line) => /^(#{1,6})\s+(.*?)\s*$/.exec(line);
// The section under the first heading whose text matches `re`, up to the next heading of the same or a higher level.
function section(text, re) {
  const ls = lines(text);
  const at = ls.findIndex((l) => { const m = headingOf(l); return m && re.test(m[2]); });
  if (at < 0) return null;
  const level = headingOf(ls[at])[1].length;
  const end = ls.findIndex((l, i) => { const m = i > at && headingOf(l); return m && m[1].length <= level; });
  return ls.slice(at + 1, end < 0 ? undefined : end).join('\n');
}
// Ordered-list items of `text`: [{ n, text }], an item running to the next item or blank line.
function items(text) {
  const out = [];
  for (const l of lines(text)) {
    const m = /^\s*(\d{1,2})\.\s+(.*)$/.exec(l);
    if (m) out.push({ n: Number(m[1]), text: m[2] });
    else if (!l.trim()) out.push(null);
    else if (out.length && out[out.length - 1]) out[out.length - 1].text += ` ${l.trim()}`;
  }
  return out;
}
// The first run of items numbered 1 to 12 in order, or null.
function twelve(text) {
  const all = items(text);
  for (let i = 0; i < all.length; i++) {
    if (all[i]?.n !== 1) continue;
    const run = [];
    for (let j = i; j < all.length && run.length < 12; j++) {
      if (all[j] === null) continue;
      if (all[j].n !== run.length + 1) break;
      run.push(flat(all[j].text));
    }
    if (run.length === 12) return run;
  }
  return null;
}

const RULE_5 = 'The hand that writes production code never writes or edits a criterion-bound test, a binding or criterion text. The audit enforces this by path on every commit, and the merge check runs the audit.';
const RULE_6 = 'Each new test is red at the DEFINE head with its failing assertion recorded, and the suite fails on exactly the new tests.';
const DEFINE_EXIT = 'Each new test is red at the DEFINE head with its failing assertion recorded, and the suite fails on exactly the new tests. No throwaway.';

// The twelve rules, in order, as rule 3 to rule 11 must read them (rulings R0 E1 and R4).
function assertTwelve(text, where) {
  const r = twelve(text);
  assert.ok(r, `${where} carries the twelve rules as one list numbered 1 to 12\n${text.slice(0, 3000)}`);
  const at = (k, test, what) => assert.ok(test(r[k - 1]), `${where}: rule ${k} ${what}\n${r[k - 1]}`);
  at(1, (s) => /chain/i.test(s) && s.includes('rcf define validate') && s.includes('rcf audit coverage --strict'), 'is the chain, refereed by rcf define validate and rcf audit coverage --strict');
  at(2, (s) => /promise/i.test(s) && /hygiene/i.test(s), 'writes criteria only for promises, the rest hygiene tests');
  at(3, (s) => /proof level/i.test(s) && /\bfull\b/.test(s) && /\bjourney\b/.test(s) && /\bexternal\b/.test(s) && /DEFINE/.test(s) && /bound test/.test(s) && /Code Node/.test(s), 'names the proof levels full, journey and external, chosen at DEFINE, every touched criterion still with a bound test and a Code Node');
  at(4, (s) => /five stages/i.test(s) && /DEFINE, BUILD, REVIEW, TEST,? (and )?FINALISE/.test(s), 'is the five stages in order');
  at(5, (s) => s.includes(RULE_5), `states separation verbatim: "${RULE_5}"`);
  at(6, (s) => s.includes(RULE_6) && /no throwaway/i.test(s), `states red-first verbatim: "${RULE_6}" and no throwaway`);
  at(7, (s) => /BUILD/.test(s), 'is the BUILD exit');
  at(8, (s) => /REVIEW/.test(s), 'is REVIEW');
  at(9, (s) => /TEST/.test(s), 'is TEST');
  at(10, (s) => /FINALISE/.test(s) && /complete/.test(s), 'is FINALISE writing complete');
  at(11, (s) => /round budget/i.test(s) && /two DEFINE passes/.test(s), 'is the round budget of two DEFINE passes');
  at(12, (s) => /readiness/i.test(s), 'is spec readiness');
}

// ------------------------------------------------------- managed block

const KEPT = [
  'RULE 1: Elicit first; never fabricate.',
  'RULE 2: The full chain is the deliverable.',
  'RULE 3: The test layer is mandatory.',
  'RULE 4: A reported bug is a spec gap first.',
  'RULE 5: Deploy target before stack; never commit a stack blind.',
  'RULE 6: Every build lands a local preview.',
  'RULE 7: Verification claims name their runtime.',
  'RULE 8: Never skip the method for speed.',
  'RULE 9: Write what you learn.',
  'RULE 10: Read the operator profile.',
  'RULE 11: Validate the chain before you act on it.',
  "RULE 12: Surface method findings in the operator's language.",
  'RULE 14: Check freshness at session start; offer, never install.',
  'RULE 15: On blueprint apply, dispose every AC.',
  'RULE 16: Verify with positive evidence.',
  'RULE 17: Log what misbehaves; ask once before anything leaves.',
];
const GONE = ['How to talk to your operator', 'at most ONE question', "The method's failure modes are yours to catch", 'Each stage is done by its own role', 'optional through 0.37.x'];

// RULE 13 of a block: its heading text and its section.
function rule13(block) {
  const heading = lines(block).map(headingOf).find((m) => m && /^RULE 13\b/.test(m[2]));
  return { heading: heading ? heading[2] : null, body: section(block, /^RULE 13\b/) };
}
function assertBlock(block, where) {
  const { heading, body } = rule13(block);
  assert.equal(heading, 'RULE 13: Deliver in rounds: the twelve rules', `${where}: RULE 13 is headed "Deliver in rounds: the twelve rules"`);
  assertTwelve(body, `${where} RULE 13`);
  for (const g of GONE) assert.ok(!flat(block).includes(g), `${where} carries no "${g}"`);
  const hs = lines(block).map(headingOf).filter(Boolean).map((m) => m[2]);
  for (const k of KEPT) assert.ok(hs.includes(k), `${where} keeps the heading "${k}"`);
}

// DEFINE pass 2 (G3, ruling 13): AC-20503-1's test, strengthened. The
// phrase checks above can pass while most of the ruled harness text
// stays, so the block is parsed into its regions (the preamble under
// "## RCF", then one region per "###" heading) and judged region by
// region against the 0.40.1 block's own regions (the fixture the 0.40.1
// rcf init wrote; no 0.41.0 product text is authored here):
//   - the heading list is the 0.40.1 list with RULE 13 renamed, nothing
//     added, removed or moved;
//   - the operator register is absent: in 0.40.1 it is the preamble from
//     its first bulleted paragraph to its end (the bullets and the
//     "Before / after" example); no paragraph or bullet of it survives
//     anywhere in the block, and the preamble carries no list item and
//     no indented example;
//   - RULE 13 carries one numbered list, the twelve rules in order (rules
//     5 and 6 verbatim), and no other numbered item;
//   - the Build loop keeps only the retained commands: its backticked
//     rcf commands are exactly the 0.40.1 Build loop's, and the five-role
//     text is gone (no sentence of the 0.40.1 Build loop that names two
//     or more of the five hands, or the Hand: trailer, survives anywhere
//     in the block, and no Build loop sentence names two or more hands).
const HANDS = ['test-author', 'builder', 'reviewer', 'verifier', 'stage-keeper'];
const handsIn = (s) => HANDS.filter((h) => new RegExp(`\\b${h}s?\\b`, 'i').test(s)).length;
const sentences = (text) => flat(text).split(/(?<=[.!?:])\s+(?=[A-Z`"])/).filter(Boolean);
const paragraphs = (text) => text.split(/\n\s*\n/).map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim());
// { preamble, regions: [{ level, heading, body }] } of a managed block.
function regions(block) {
  const ls = lines(block);
  const out = [];
  let preamble = [];
  let cur = null;
  for (const l of ls) {
    const m = headingOf(l);
    if (m) { cur = { level: m[1].length, heading: m[2], body: [] }; out.push(cur); continue; }
    if (cur && cur.level >= 3) cur.body.push(l);
    else preamble.push(l);
  }
  return { preamble: preamble.join('\n'), regions: out.map((r) => ({ ...r, body: r.body.join('\n') })) };
}
// The bullets and paragraphs of the 0.40.1 operator register.
function register0401(pre) {
  const ps = paragraphs(pre);
  const at = ps.findIndex((p) => /^- /m.test(p));
  assert.ok(at >= 0, 'given: the 0.40.1 preamble carries the operator register (a bulleted paragraph)');
  const units = [];
  for (const p of ps.slice(at)) {
    const [lead, ...bullets] = p.split(/\n(?=- )/);
    units.push(flat(lead), ...bullets.map((b) => flat(b.replace(/^- /, ''))));
  }
  return units.filter((u) => u.length >= 20);
}
const commandsIn = (text) => [...new Set([...flat(text).matchAll(/`(rcf [^`]+)`/g)].map((m) => m[1]))].sort();

function assertRegions(block, where) {
  const was = regions(inner(readFileSync(FIXTURE_0_40_1, 'utf8'), 'the 0.40.1 fixture').inside);
  const now = regions(block);
  const name = (r) => `${'#'.repeat(r.level)} ${r.heading}`;
  const expected = was.regions.map((r) => (/^RULE 13\b/.test(r.heading) ? '### RULE 13: Deliver in rounds: the twelve rules' : name(r)));
  assert.deepEqual(now.regions.map(name), expected, `${where}: the headings are the 0.40.1 headings with RULE 13 renamed, none added, removed or moved`);

  // The operator register.
  const lead = (now.regions.find((r) => r.level === 2)?.body ?? '') + now.preamble;
  assert.deepEqual(lines(lead).filter((l) => /^\s*[-*] |^\s*\d+\. /.test(l)), [], `${where}: the preamble carries no list item`);
  assert.deepEqual(lines(lead).filter((l) => /^ {2,}\S/.test(l)), [], `${where}: the preamble carries no indented example`);
  const whole = flat(block);
  const kept = register0401(was.preamble + (was.regions.find((r) => r.level === 2)?.body ?? '')).filter((u) => whole.includes(u));
  assert.deepEqual(kept, [], `${where}: no paragraph or bullet of the 0.40.1 operator register survives`);

  // RULE 13.
  const r13 = now.regions.find((r) => /^RULE 13\b/.test(r.heading));
  assertTwelve(r13.body, `${where} RULE 13`);
  const numbered = items(r13.body).filter(Boolean).map((i) => i.n);
  assert.deepEqual(numbered, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `${where}: RULE 13 carries one numbered list, the twelve rules, and no other numbered item`);

  // The Build loop.
  const loopWas = was.regions.find((r) => r.heading === 'Build loop').body;
  const loopNow = now.regions.find((r) => r.heading === 'Build loop')?.body ?? '';
  assert.deepEqual(commandsIn(loopNow), commandsIn(loopWas), `${where}: the Build loop keeps exactly the 0.40.1 Build loop's rcf commands`);
  const roleText = sentences(loopWas).filter((s) => handsIn(s) >= 2 || s.includes('`Hand:`'));
  assert.ok(roleText.length >= 2, 'given: the 0.40.1 Build loop carries the five-role text');
  const survived = roleText.filter((s) => whole.includes(s));
  assert.deepEqual(survived.map((s) => s.slice(0, 90)), [], `${where}: no five-role sentence of the 0.40.1 Build loop survives`);
  const assigning = sentences(loopNow).filter((s) => handsIn(s) >= 2);
  assert.deepEqual(assigning.map((s) => s.slice(0, 120)), [], `${where}: no Build loop sentence names two or more of the five hands`);
}

test('AC-20503-1: rcf guidance managed/agent-instructions-block prints RULE 13 as "Deliver in rounds: the twelve rules" with the twelve rules in order, none of the operator-register or five-role text, and RULE 1 to 12 and 14 to 17 under their headings', async () => {
  const block = await guidance('managed/agent-instructions-block');
  assertRegions(block, 'the managed block');
  assertBlock(block, 'the managed block');
});

// The text between the managed markers of a file.
function inner(text, where) {
  const i = text.indexOf(BEGIN);
  const j = text.indexOf(END);
  assert.ok(i >= 0 && j > i, `${where} carries the managed markers`);
  return { before: text.slice(0, i), inside: text.slice(i + BEGIN.length, j), after: text.slice(j + END.length) };
}

test('AC-20503-2: rcf init in a fresh directory writes the twelve-rule block between the managed markers of CLAUDE.md and of AGENTS.md', async (t) => {
  const dir = join(scratch(t, 'rcf-h-init041-'), 'fresh');
  mkdirSync(dir);
  const r = await rcf(['init'], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const block = await guidance('managed/agent-instructions-block');
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    if (file === 'AGENTS.md' && !existsSync(join(dir, file))) continue;
    const { inside } = inner(readFileSync(join(dir, file), 'utf8'), file);
    assert.equal(inside, block, `${file}: the text between the markers is the block rcf guidance prints`);
    assertBlock(inside, file);
  }
});

test('AC-20503-3: on a project whose CLAUDE.md carries the 0.40.1 block, rcf doctor exits 3 naming the stale block, rcf doctor --fix rewrites only the text between the markers, and a second rcf doctor exits 0', async (t) => {
  const dir = join(scratch(t, 'rcf-h-doctor041-'), 'proj');
  mkdirSync(dir);
  const init = await rcf(['init'], { cwd: dir });
  assert.equal(init.code, 0, `${init.stdout}${init.stderr}`);
  const old = readFileSync(FIXTURE_0_40_1, 'utf8');
  const was = inner(old, 'the 0.40.1 fixture');
  assert.equal(rule13(was.inside).heading, "RULE 13: The method's failure modes are yours to catch.", 'given: the fixture carries the 0.40.1 RULE 13');
  writeFileSync(join(dir, 'CLAUDE.md'), old);

  const d1 = await rcf(['doctor'], { cwd: dir });
  assert.equal(d1.code, 3, `rcf doctor on the 0.40.1 block exits 3\n${d1.stdout}${d1.stderr}`);
  assert.ok(lines(d1.stdout).some((l) => /\[agent-instructions\]/.test(l) && /stale/.test(l) && /CLAUDE\.md/.test(l)), `rcf doctor names the stale block in CLAUDE.md\n${d1.stdout}`);

  const fix = await rcf(['doctor', '--fix'], { cwd: dir });
  assert.equal(fix.code, 0, `${fix.stdout}${fix.stderr}`);
  const now = inner(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), 'CLAUDE.md after --fix');
  assert.equal(now.before, was.before, 'the text above the begin marker is byte-identical');
  assert.equal(now.after, was.after, 'the text below the end marker is byte-identical');
  assert.equal(now.inside, await guidance('managed/agent-instructions-block'), 'the text between the markers is the shipped block');
  assertBlock(now.inside, 'CLAUDE.md after --fix');

  const d2 = await rcf(['doctor'], { cwd: dir });
  assert.equal(d2.code, 0, `a second rcf doctor exits 0\n${d2.stdout}${d2.stderr}`);
});

// --------------------------------------------------- guidance and runbook

// A minimal MCP stdio client over bin/rcf.js mcp: initialize, then each
// request in turn; resolves the results in order and the exit code.
async function mcp(cwd, requests) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { cwd, env: baseEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const results = [];
    let buf = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    const next = () => {
      const k = results.length;
      if (k === requests.length) { child.stdin.end(); return; }
      send({ jsonrpc: '2.0', id: k + 2, ...requests[k] });
    };
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); next(); }
        else if (typeof msg.id === 'number') { results.push(msg.result ?? { error: msg.error }); next(); }
      }
    });
    child.on('exit', (code) => { clearTimeout(timer); res({ code, results, stderr }); });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'twelve-rules', version: '1.0.0' } } });
  });
}

// A fixture project in git with FBS-001 titled, and a green base-suite record for HEAD.
async function bundleFixture(t) {
  const dir = await project(t, { name: 'runbook041' });
  editFbs(dir, 'FBS-001', (f) => { f.title = 'Fixture slice'; });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  initRepo(dir);
  commit(dir, 'fixture: base chain');
  const recDir = scratch(t, 'rcf-h-base041-');
  writeJson(recDir, 'base.json', baseSuiteRecord(sha(dir)));
  return { dir, rec: join(recDir, 'base.json') };
}
// The md runbook (the bundle's last section) and the json completionContract.
async function runbooks(t) {
  const { dir, rec } = await bundleFixture(t);
  const md = await rcf(['build', 'bundle', 'FBS-001', '--base-suite', rec, '--format', 'md'], { cwd: dir });
  assert.equal(md.code, 0, `${md.stdout.slice(0, 500)}${md.stderr}`);
  const ls = lines(md.stdout);
  const last = ls.map((l, i) => (headingOf(l) ? i : -1)).filter((i) => i >= 0).pop();
  const js = await rcf(['build', 'bundle', 'FBS-001', '--base-suite', rec, '--format', 'json'], { cwd: dir });
  assert.equal(js.code, 0, `${js.stdout.slice(0, 500)}${js.stderr}`);
  return { dir, md: md.stdout, runbook: ls.slice(last + 1).join('\n'), contract: JSON.parse(js.stdout).completionContract };
}
const STAGE_NAMES = ['DEFINE', 'BUILD', 'REVIEW', 'TEST', 'FINALISE'];
// The md runbook text of one stage: from its dispatch name to the next stage's.
function mdStage(runbook, stage) {
  const at = runbook.indexOf(`${stage} FBS-001: Fixture slice`);
  assert.ok(at >= 0, `the runbook names the ${stage} dispatch\n${runbook.slice(0, 1500)}`);
  const k = STAGE_NAMES.indexOf(stage);
  const end = k < 4 ? runbook.indexOf(`${STAGE_NAMES[k + 1]} FBS-001: Fixture slice`) : -1;
  return runbook.slice(at, end < 0 ? undefined : end);
}
// The json completionContract entry of one stage, as text.
function jsonStage(contract, stage) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') { if (v.stage === stage) found.push(v); Object.values(v).forEach(walk); }
  };
  walk(contract);
  assert.equal(found.length, 1, `completionContract carries one ${stage} stage\n${JSON.stringify(contract).slice(0, 1500)}`);
  return JSON.stringify(found[0]);
}
const REVIEW_STRENGTH = (s) => /test[- ]strength is recorded for the reviewer'?s adequacy verdict/i.test(s);
const PROVEN = 'proven red for the right reason';

test('AC-20504-1: rcf guidance build-cycle and rcf://docs/build-cycle state the twelve rules, the DEFINE exit reads rule 6 with "No throwaway.", the FINALISE paragraph says Finalise requires the strength record and never refuses on its result, and no guidance document or bundle runbook says "proven red for the right reason"', async (t) => {
  const cli = await guidance('build-cycle');
  const dir = await project(t, { name: 'mcp041' });
  const listed = await mcp(dir, [{ method: 'resources/list', params: {} }]);
  assert.equal(listed.code, 0, listed.stderr);
  const docs = (listed.results[0]?.resources ?? []).map((r) => r.uri).filter((u) => u.startsWith('rcf://docs/'));
  assert.ok(docs.includes('rcf://docs/build-cycle'), `the MCP server lists rcf://docs/build-cycle\n${docs.join('\n')}`);
  const read = await mcp(dir, docs.map((uri) => ({ method: 'resources/read', params: { uri } })));
  assert.equal(read.code, 0, read.stderr);
  const served = Object.fromEntries(docs.map((uri, k) => [uri, (read.results[k]?.contents ?? []).map((c) => c.text ?? '').join('\n')]));

  for (const [where, text] of [['rcf guidance build-cycle', cli], ['rcf://docs/build-cycle', served['rcf://docs/build-cycle']]]) {
    assertTwelve(text, where);
    const define = section(text, /^DEFINE\b/);
    assert.ok(define !== null, `${where} has a DEFINE section`);
    assert.ok(flat(define).includes(DEFINE_EXIT), `${where}: the DEFINE exit reads "${DEFINE_EXIT}"\n${flat(define)}`);
    const fin = section(text, /^FINALISE\b/);
    assert.ok(fin !== null, `${where} has a FINALISE section`);
    const ss = flat(fin).split(/(?<=[.!?])\s+/);
    assert.ok(ss.some((s) => /requires/.test(s) && /test-strength record/.test(s)), `${where}: the FINALISE paragraph says Finalise requires the test-strength record\n${flat(fin)}`);
    assert.ok(ss.some((s) => /never refuses on (its|the record's) result/.test(s)), `${where}: the FINALISE paragraph says Finalise never refuses on its result\n${flat(fin)}`);
  }

  const topics = await rcf(['guidance', '--list'], {});
  assert.equal(topics.code, 0, topics.stderr);
  const names = [...new Set(lines(topics.stdout).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean))];
  assert.ok(names.includes('build-cycle') && names.includes('overview'), `rcf guidance --list lists the topics\n${topics.stdout}`);
  for (const name of names) {
    const r = await rcf(['guidance', name], {});
    assert.equal(r.code, 0, `rcf guidance ${name}\n${r.stderr}`);
    assert.ok(!flat(r.stdout).includes(PROVEN), `rcf guidance ${name} carries no "${PROVEN}"`);
  }
  for (const [uri, text] of Object.entries(served)) assert.ok(!flat(text).includes(PROVEN), `${uri} carries no "${PROVEN}"`);
  const { md, contract } = await runbooks(t);
  assert.ok(!flat(md).includes(PROVEN), `the bundle (md) carries no "${PROVEN}"`);
  assert.ok(!flat(JSON.stringify(contract)).includes(PROVEN), `completionContract carries no "${PROVEN}"`);
});

test("AC-20504-2: the runbook rcf build bundle prints, in md and in the json completionContract, gives DEFINE the rule 6 text and REVIEW the line that test strength is recorded for the reviewer's adequacy verdict", async (t) => {
  const { runbook, contract } = await runbooks(t);
  const mdDefine = flat(mdStage(runbook, 'DEFINE'));
  assert.ok(mdDefine.includes(RULE_6) && /no throwaway/i.test(mdDefine), `the md DEFINE stage carries "${RULE_6}" and no throwaway\n${mdDefine}`);
  const mdReview = flat(mdStage(runbook, 'REVIEW'));
  assert.ok(REVIEW_STRENGTH(mdReview), `the md REVIEW stage says test strength is recorded for the reviewer's adequacy verdict\n${mdReview}`);
  const jDefine = flat(jsonStage(contract, 'DEFINE'));
  assert.ok(jDefine.includes(RULE_6) && /no throwaway/i.test(jDefine), `the json DEFINE stage carries "${RULE_6}" and no throwaway\n${jDefine}`);
  const jReview = flat(jsonStage(contract, 'REVIEW'));
  assert.ok(REVIEW_STRENGTH(jReview), `the json REVIEW stage says test strength is recorded for the reviewer's adequacy verdict\n${jReview}`);
});

test('AC-20504-3: rcf guidance overview keeps "The tool referees structure, never adequacy." word for word and says the test-strength report shows a gutted test and the reviewer judges it', async () => {
  const text = flat(await guidance('overview'));
  assert.ok(text.includes('The tool referees structure, never adequacy.'), 'the closer is kept word for word');
  const ss = text.split(/(?<=[.!?])\s+/);
  assert.ok(ss.some((s) => /gutted test/.test(s) && /test-strength report shows it/.test(s) && /reviewer judges it/.test(s)), `a sentence says a gutted test is shown by the test-strength report and the reviewer judges it\n${ss.filter((s) => /gutted|adequacy/.test(s)).join('\n')}`);
});
