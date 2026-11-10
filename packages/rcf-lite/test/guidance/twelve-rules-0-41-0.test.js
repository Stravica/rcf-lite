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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
// Rule 6 and the DEFINE exit as the process states them since round 3:
// red is measured against the named base-suite record, changed cases
// count beside new ones, and an unrecorded baseline failure is BLOCKED.
const RULE_6 = 'From the named base-suite record, only the newly added or changed test cases fail at the DEFINE head, and each fails at its recorded assertion; an unrecorded baseline failure makes DEFINE BLOCKED.';
const NO_THROWAWAY = "There is no throwaway implementation: the test-author proves red, and green is the builder's to prove.";
const DEFINE_EXIT = `${RULE_6} ${NO_THROWAWAY}`;
// The superseded texts: the old rule 6, and REVIEW recording test
// strength. TEST owns the record; REVIEW runs the audit read-only.
const OLD_RULE_6 = 'the suite fails on exactly the new tests';
const RECORDED_FOR_REVIEW = (s) => /test[- ]strength is recorded for the reviewer'?s adequacy verdict/i.test(s);

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
  at(8, (s) => /REVIEW/.test(s) && !RECORDED_FOR_REVIEW(s), "is REVIEW, with no sentence that test strength is recorded for the reviewer's adequacy verdict");
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
  const readOnly = (c) => /^rcf audit test-strength\b/.test(c) && !/--record\b/.test(c);
  assert.deepEqual(commandsIn(loopNow).filter((c) => !readOnly(c)), commandsIn(loopWas), `${where}: the Build loop keeps exactly the 0.40.1 Build loop's rcf commands, beside REVIEW's read-only rcf audit test-strength`);
  // Round 3: TEST owns test strength. The Build loop's REVIEW passage runs
  // rcf audit test-strength read-only, with no --record; its TEST passage
  // records it; no sentence of the block says REVIEW records it.
  const loopFlat = flat(loopNow);
  const reviewAt = loopFlat.indexOf('REVIEW (`REVIEW:`)');
  const testAt = loopFlat.indexOf('TEST (`TEST:`)');
  const finaliseAt = loopFlat.indexOf('FINALISE (`FINALISE:`)');
  assert.ok(reviewAt >= 0 && testAt > reviewAt && finaliseAt > testAt, `${where}: the Build loop names REVIEW, TEST and FINALISE in that order\n${loopFlat}`);
  const reviewPart = commandsIn(loopFlat.slice(reviewAt, testAt));
  const testPart = commandsIn(loopFlat.slice(testAt, finaliseAt));
  assert.ok(reviewPart.some(readOnly) && !reviewPart.some((c) => /test-strength/.test(c) && /--record\b/.test(c)), `${where}: the Build loop's REVIEW runs rcf audit test-strength read-only, with no --record\n${reviewPart.join('\n')}`);
  assert.ok(testPart.some((c) => /^rcf audit test-strength\b/.test(c) && /--record\b/.test(c)), `${where}: the Build loop's TEST runs rcf audit test-strength --record\n${testPart.join('\n')}`);
  assert.ok(!whole.includes(OLD_RULE_6), `${where} carries no "${OLD_RULE_6}"`);
  assert.ok(!RECORDED_FOR_REVIEW(whole), `${where} carries no sentence that test strength is recorded for the reviewer's adequacy verdict`);
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

// Every file under `dir` (outside .git/) as { path: bytes in base64 }.
function snapshot(dir, at = '') {
  const out = {};
  for (const e of readdirSync(join(dir, at), { withFileTypes: true })) {
    const rel = at ? `${at}/${e.name}` : e.name;
    if (rel === '.git') continue;
    if (e.isDirectory()) Object.assign(out, snapshot(dir, rel));
    else out[rel] = readFileSync(join(dir, rel)).toString('base64');
  }
  return out;
}

test('AC-20503-4: on a project whose CLAUDE.md carries a stale managed block with a CRLF line ending, or the end of the file, right after the end marker, rcf doctor --fix exits 2 naming CLAUDE.md and writes nothing', async (t) => {
  const old = readFileSync(FIXTURE_0_40_1, 'utf8');
  const at = old.indexOf(END);
  assert.ok(at > 0 && old[at + END.length] === '\n' && old.length > at + END.length + 1, 'given: the 0.40.1 fixture has its end marker followed by LF and project text below it');
  const cases = [
    ['a CRLF line ending after the end marker', `${old.slice(0, at + END.length)}\r\n${old.slice(at + END.length + 1)}`],
    ['the end of the file right after the end marker', old.slice(0, at + END.length)],
  ];
  for (const [what, text] of cases) {
    const dir = join(scratch(t, 'rcf-h-doctoreol-'), 'proj');
    mkdirSync(dir);
    const init = await rcf(['init'], { cwd: dir });
    assert.equal(init.code, 0, `${init.stdout}${init.stderr}`);
    writeFileSync(join(dir, 'CLAUDE.md'), text);
    const d1 = await rcf(['doctor'], { cwd: dir });
    assert.ok(lines(d1.stdout).some((l) => /\[agent-instructions\]/.test(l) && /stale/.test(l) && /CLAUDE\.md/.test(l)), `given (${what}): rcf doctor names the stale block in CLAUDE.md\n${d1.stdout}${d1.stderr}`);
    const before = snapshot(dir);
    const fix = await rcf(['doctor', '--fix'], { cwd: dir });
    assert.equal(fix.code, 2, `${what}: rcf doctor --fix exits 2\n${fix.stdout}${fix.stderr}`);
    assert.ok(/CLAUDE\.md/.test(`${fix.stdout}${fix.stderr}`), `${what}: rcf doctor --fix names CLAUDE.md\n${fix.stdout}${fix.stderr}`);
    assert.deepEqual(snapshot(dir), before, `${what}: rcf doctor --fix writes nothing (every file byte-identical)`);
  }
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
  return found[0];
}
const PROVEN = 'proven red for the right reason';
// The md runbook commands of one stage: its indented code lines.
const mdCommands = (stageText) => lines(stageText).filter((l) => /^ {4}rcf /.test(l)).map((l) => l.trim());
const mdProse = (stageText) => flat(lines(stageText).filter((l) => !/^ {4}rcf /.test(l)).join('\n'));
const strengthRun = (c) => /^rcf audit test-strength\b/.test(c);
const recordsStrength = (c) => strengthRun(c) && /--record\b/.test(c);
// A sentence that runs the recording audit beside the REVIEW verdict:
// a backticked rcf audit test-strength command carrying --record in any
// argument position, or the contiguous command written out.
const recordAtReview = (text) => flat(text).split(/(?<=[.!?])\s+/).filter((s) => (commandsIn(s).some(recordsStrength) || s.includes('rcf audit test-strength --record')) && s.includes('rcf build verdict review'));

test('AC-20504-1: rcf guidance build-cycle and rcf://docs/build-cycle state the twelve rules, the DEFINE exit reads rule 6 with no throwaway, REVIEW runs test strength read-only and TEST records it, the FINALISE paragraph says Finalise requires the strength record and never refuses on its result, and no guidance document or bundle runbook carries the superseded rule 6 or REVIEW-recording text', async (t) => {
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
    const review = section(text, /^REVIEW\b/);
    assert.ok(review !== null, `${where} has a REVIEW section`);
    assert.ok(flat(review).includes('rcf audit test-strength') && !commandsIn(review).some(recordsStrength) && !flat(review).includes('rcf audit test-strength --record') && !RECORDED_FOR_REVIEW(flat(review)) && /read-only|unrecorded/i.test(review), `${where}: the REVIEW section runs rcf audit test-strength read-only, with no --record in any of its commands and no line that strength is recorded for the reviewer's verdict\n${flat(review)}`);
    const testStage = section(text, /^TEST\b/);
    assert.ok(testStage !== null, `${where} has a TEST section`);
    assert.ok(flat(testStage).includes('rcf audit test-strength --record'), `${where}: the TEST section runs rcf audit test-strength --record\n${flat(testStage)}`);
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
  // Every served document and both runbook forms, swept for the
  // superseded texts; a served document also carries no sentence that
  // runs the recording audit beside the REVIEW verdict.
  const stale = [];
  const sweep = (where, text, sentences = true) => {
    const f = flat(text);
    if (f.includes(PROVEN)) stale.push(`${where}: "${PROVEN}"`);
    if (f.includes(OLD_RULE_6)) stale.push(`${where}: "${OLD_RULE_6}"`);
    if (RECORDED_FOR_REVIEW(f)) stale.push(`${where}: test strength recorded for the reviewer's adequacy verdict`);
    if (sentences) for (const s of recordAtReview(text)) stale.push(`${where}: records strength beside the REVIEW verdict: "${s.slice(0, 160)}"`);
  };
  for (const name of names) {
    const r = await rcf(['guidance', name], {});
    assert.equal(r.code, 0, `rcf guidance ${name}\n${r.stderr}`);
    sweep(`rcf guidance ${name}`, r.stdout);
  }
  for (const [uri, text] of Object.entries(served)) sweep(uri, text);
  const { md, contract } = await runbooks(t);
  sweep('the bundle (md)', md, false);
  sweep('completionContract', JSON.stringify(contract), false);
  assert.deepEqual(stale, [], `no guidance document or bundle runbook carries "${PROVEN}", "${OLD_RULE_6}" or REVIEW recording test strength (${stale.length} found)`);
});

// AC-20504-4: the inline code spans of a markdown document (fenced blocks
// left out), whitespace flattened.
function inlineSpans(markdown) {
  const kept = [];
  let fence = false;
  for (const l of lines(markdown)) {
    if (/^\s*(?:```|~~~)/.test(l)) { fence = !fence; continue; }
    if (!fence) kept.push(l);
  }
  return [...flat(kept.join('\n')).matchAll(/(`+)([^`]+?)\1(?!`)/g)].map((m) => m[2].trim());
}
const isRcfCommand = (span) => /^(?:npx\s+)?rcf\s/.test(span);
// A command read as one command with its arguments: { argv } or { error }.
// Quotes and <...> / [...] placeholders must balance; a shell operator
// outside a quote or a placeholder means the span is not one command.
function readCommand(span) {
  const s = span.trim();
  const argv = [];
  let cur = '';
  let open = false;
  const pairs = { '<': '>', '[': ']' };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/\s/.test(c)) { if (open) { argv.push(cur); cur = ''; open = false; } i++; continue; }
    if (c === "'" || c === '"') {
      const j = s.indexOf(c, i + 1);
      if (j < 0) return { error: `an unclosed ${c} quote` };
      cur += s.slice(i, j + 1); open = true; i = j + 1; continue;
    }
    if (pairs[c]) {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === c) depth++;
        else if (s[j] === pairs[c] && --depth === 0) break;
      }
      if (j >= s.length) return { error: `an unclosed ${c} placeholder` };
      cur += s.slice(i, j + 1); open = true; i = j + 1; continue;
    }
    if (c === '>' || c === ']') return { error: `a stray ${c}` };
    if ('|;&\\'.includes(c) || (c === '$' && s[i + 1] === '(')) return { error: `the shell operator ${c === '$' ? '$(' : c} outside a quote or a placeholder` };
    cur += c; open = true; i++;
  }
  if (open) argv.push(cur);
  return { argv };
}

test('guidance command reader canaries: readCommand reads plain commands, quotes and placeholders, and names every span it cannot read', () => {
  assert.deepEqual(readCommand('rcf audit test-strength --acs <AC ids> --record').argv, ['rcf', 'audit', 'test-strength', '--acs', '<AC ids>', '--record']);
  assert.deepEqual(readCommand('rcf build verdict test --runtime "<text>" [--tap <file>]').argv, ['rcf', 'build', 'verdict', 'test', '--runtime', '"<text>"', '[--tap <file>]']);
  for (const [span, error] of [
    ['rcf build verdict review --code MERGE|FINDINGS', /shell operator \|/],
    ['rcf audit test-strength; rcf build verdict review', /shell operator ;/],
    ['rcf audit test-strength && rcf build finalise', /shell operator &/],
    ['rcf build verdict test --runtime "unclosed', /unclosed " quote/],
    ['rcf audit test-strength --acs <AC ids --record', /unclosed < placeholder/],
    ['rcf audit coverage > out.txt', /stray >/],
    ['rcf audit test-strength --acs $(cat ids)', /shell operator \$\(/],
  ]) assert.match(readCommand(span).error ?? '', error, `"${span}" is not read as one command`);
  assert.deepEqual(inlineSpans('Run `rcf define validate` then\n```\nrcf audit coverage | head\n```\nand `rcf audit\ncoverage --strict`.'), ['rcf define validate', 'rcf audit coverage --strict']);
});

test('AC-20504-4: every inline rcf command in every document rcf guidance serves and every rcf://docs/ resource reads as one command with its arguments; a span that does not is named by document and text', async (t) => {
  const topics = await rcf(['guidance', '--list'], {});
  assert.equal(topics.code, 0, topics.stderr);
  const names = [...new Set(lines(topics.stdout).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean))];
  assert.ok(names.includes('build-cycle') && names.includes('overview') && names.length >= 10, `rcf guidance --list lists the topics (${names.length})\n${topics.stdout}`);
  const docs = [];
  for (const name of names) {
    const r = await rcf(['guidance', name], {});
    assert.equal(r.code, 0, `rcf guidance ${name}\n${r.stderr}`);
    docs.push([`rcf guidance ${name}`, r.stdout]);
  }
  const dir = await project(t, { name: 'mcpcmd041' });
  const listed = await mcp(dir, [{ method: 'resources/list', params: {} }]);
  assert.equal(listed.code, 0, listed.stderr);
  const uris = (listed.results[0]?.resources ?? []).map((r) => r.uri).filter((u) => u.startsWith('rcf://docs/'));
  assert.ok(uris.includes('rcf://docs/build-cycle'), `the MCP server lists rcf://docs/build-cycle\n${uris.join('\n')}`);
  const read = await mcp(dir, uris.map((uri) => ({ method: 'resources/read', params: { uri } })));
  assert.equal(read.code, 0, read.stderr);
  uris.forEach((uri, k) => docs.push([uri, (read.results[k]?.contents ?? []).map((c) => c.text ?? '').join('\n')]));

  let commands = 0;
  const unread = [];
  for (const [where, text] of docs) {
    for (const span of inlineSpans(text).filter(isRcfCommand)) {
      commands++;
      const { error } = readCommand(span);
      if (error) unread.push(`${where}: \`${span}\`: ${error}`);
    }
  }
  assert.ok(commands >= 100, `given: the served documents carry inline rcf commands (${commands})`);
  assert.deepEqual(unread, [], `every inline rcf command in a served document reads as one command (${unread.length} do not)\n${unread.join('\n')}`);
});

test('AC-20504-2: the runbook rcf build bundle prints, in md and in the json completionContract, gives DEFINE the rule 6 text, REVIEW rcf audit test-strength read-only with no --record, and TEST rcf audit test-strength --record', async (t) => {
  const { runbook, contract } = await runbooks(t);
  const forms = [
    ['md', (s) => mdProse(mdStage(runbook, s)), (s) => mdCommands(mdStage(runbook, s))],
    ['json', (s) => flat(String(jsonStage(contract, s).does ?? '')), (s) => jsonStage(contract, s).commands ?? []],
  ];
  for (const [fmt, prose, commands] of forms) {
    const define = prose('DEFINE');
    assert.ok(define.includes(RULE_6) && /no throwaway/i.test(define), `the ${fmt} DEFINE stage carries "${RULE_6}" and no throwaway\n${define}`);
    const review = prose('REVIEW');
    const reviewCommands = commands('REVIEW');
    assert.ok(reviewCommands.some(strengthRun) && !reviewCommands.some((c) => /--record\b/.test(c)), `the ${fmt} REVIEW stage runs rcf audit test-strength with no --record\n${reviewCommands.join('\n')}`);
    assert.ok(!RECORDED_FOR_REVIEW(review) && /read-only|unrecorded/i.test(review), `the ${fmt} REVIEW stage says the audit runs read-only and carries no line that strength is recorded for the reviewer's verdict\n${review}`);
    const testCommands = commands('TEST');
    assert.ok(testCommands.some(recordsStrength), `the ${fmt} TEST stage runs rcf audit test-strength --record\n${testCommands.join('\n')}`);
  }
});

test('AC-20504-3: rcf guidance overview keeps "The tool referees structure, never adequacy." word for word and says the test-strength report shows a gutted test and the reviewer judges it', async () => {
  const text = flat(await guidance('overview'));
  assert.ok(text.includes('The tool referees structure, never adequacy.'), 'the closer is kept word for word');
  const ss = text.split(/(?<=[.!?])\s+/);
  assert.ok(ss.some((s) => /gutted test/.test(s) && /test-strength report shows it/.test(s) && /reviewer judges it/.test(s)), `a sentence says a gutted test is shown by the test-strength report and the reviewer judges it\n${ss.filter((s) => /gutted|adequacy/.test(s)).join('\n')}`);
});
