// FBS-235 (US-19801, US-19802, US-19803, US-19804): validate requires the
// verification flag on new and amended criteria; coverage shows each
// criterion's and each spec's expected and current end state; the 0.37.0
// interim flag tags move onto the field.
//
// Criteria: 20; 15 external, 5 testOnly, all tested here (testOnly:
// AC-19801-6, AC-19803-5, AC-19804-1 to AC-19804-3). AC-19804-2 asserts
// the byte-identical fields only: the stage-keeper's ruling 3 on part
// B1's stops dropped its "made through rcf define update only" clause, a
// process rule that now lives in the sweep round's brief.
//
// Every test is a node:test todo case ("FBS-235 round DEFINE", GR-35): it
// runs and is red until FBS-235's round DEFINE drops the marker and BUILD
// turns it green. External tests drive bin/rcf.js against fixture
// projects made by its own rcf init (in git where the criterion needs a
// base). TestOnly tests read this repository through RCF_CHECKOUT
// (GR-34) at the current head and no git history: AC-19803-5's row half,
// AC-19804-1 and AC-19804-2 compare with the pre-move goldens FBS-235's
// round DEFINE records (the stage-keeper's rulings F5, F6 and F7 on the
// independent check), and AC-19804-3 runs in a fixture repository the
// harness builds with its own base commit (ruling F8). The one exception
// is AC-19803-5's timing ratio (ruling C3), which runs only with
// RCF_PERF=1, at TEST on the verifier's full clone, against a temporary
// worktree at the parent commit of FBS-235's first BUILD commit (the
// stage-keeper's ruling 5 for round B), and is skipped otherwise. Timing
// tests print the host facts (GR-45). Imports: Node builtins and
// test/_harness/ only (GR-40), no devDependency, so the file also loads
// in the packed-artefact run, which installs the runtime dependencies
// only (the stage-keeper's ruling on round A fix 1): ci.yml is read by
// the workflow reader below, not by a YAML library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lines, rcf, run } from '../_harness/spawn.js';
import { commit, git, gitTry, porcelain, s7, showAt } from '../_harness/git.js';
import { bindTests, checkoutPackage, checkoutRoot, criterion, editFbs, editStory, project, readJson, scratch, writeJson } from '../_harness/fixture.js';
import { hostFacts, json, median, objectsIn, tables } from '../_harness/capture.js';
import { MOVE_TEXT_FIELDS, coverageRows, readStories } from '../_harness/goldens.js';

const NOFLAG = '(external | testOnly)';
const WARN = '[warn] verification: no base ref; new and amended criteria not checked';

const gwt = (id, extra = {}) => criterion(id, `${id} holds for the fixture`, { given: 'a fixture project', when: 'the verb runs', then: 'it exits 0', ...extra });
const retire = (by) => ({ supersededBy: by, supersededOn: '2026-10-24', supersessionNote: `Retired: replaced by ${by}.` });
const validate = (dir, args = [], env = {}) => rcf(['define', 'validate', ...args], { cwd: dir, env });
const outLines = (r) => [...lines(r.stdout), ...lines(r.stderr)];
const errNew = (id, base) => `[error] verification ${id} is new since ${s7(base)} and carries no verification flag ${NOFLAG}`;
const errAmended = (id, base) => `[error] verification ${id} is amended since ${s7(base)} and carries no verification flag ${NOFLAG}`;

// US-101's criteria and FBS-001's scope (the live ones by default).
function setCriteria(dir, list, acIds = list.filter((c) => !c.supersededBy).map((c) => c.id)) {
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = list; });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = acIds; });
}

// A fixture git repository whose base commit holds US-101 with AC-101-1
// (given, when and then; no verification). Returns { dir, base }.
async function baseRepo(t) {
  const dir = await project(t, { git: true, name: 'flag' });
  setCriteria(dir, [gwt('AC-101-1')]);
  const base = commit(dir, 'fixture: AC-101-1 unflagged');
  return { dir, base };
}

// ---------------------------------------------------------------- US-19801

test('AC-19801-1: with HEAD adding AC-101-2 flagged external over a base holding the unflagged AC-101-1, rcf define validate --base <base> exits 0 with no "[error]" line and no verification line for AC-101-2 on stderr', async (t) => {
  const { dir, base } = await baseRepo(t);
  setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2', { verification: 'external' })]);
  commit(dir, 'add AC-101-2 flagged external');
  const r = await validate(dir, ['--base', base]);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(outLines(r).filter((l) => l.startsWith('[error]')), [], 'no [error] line');
  assert.deepEqual(lines(r.stderr).filter((l) => l.includes('verification') && l.includes('AC-101-2')), [], 'no verification line for AC-101-2');
});

test('AC-19801-2: with HEAD adding AC-101-2 with no verification, rcf define validate --base <base> exits 3 with "[error] verification AC-101-2 is new since <base7> and carries no verification flag (external | testOnly)"', async (t) => {
  const { dir, base } = await baseRepo(t);
  setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2')]);
  commit(dir, 'add AC-101-2 unflagged');
  const r = await validate(dir, ['--base', base]);
  assert.equal(r.code, 3, `${r.stdout}${r.stderr}`);
  assert.ok(outLines(r).includes(errNew('AC-101-2', base)), `${r.stdout}${r.stderr}`);
});

test('AC-19801-3: a HEAD changing only the then text of the unflagged AC-101-1 exits 3 with its "is amended since <base7>" line; a HEAD changing only its testable or only its ownerRef is not amended and exits 0', async (t) => {
  const amended = await baseRepo(t);
  setCriteria(amended.dir, [gwt('AC-101-1', { then: 'it exits 0 and prints one line' })]);
  commit(amended.dir, 'amend the then text of AC-101-1');
  const r = await validate(amended.dir, ['--base', amended.base]);
  assert.equal(r.code, 3, `${r.stdout}${r.stderr}`);
  assert.ok(outLines(r).includes(errAmended('AC-101-1', amended.base)), `${r.stdout}${r.stderr}`);

  for (const [what, extra] of [['testable', { testable: false }], ['ownerRef', { ownerRef: { tacId: 'TAC-001' } }]]) {
    const { dir, base } = await baseRepo(t);
    setCriteria(dir, [gwt('AC-101-1', extra)]);
    commit(dir, `change only the ${what} of AC-101-1`);
    const ok = await validate(dir, ['--base', base]);
    assert.equal(ok.code, 0, `a change to ${what} alone is not an amendment\n${ok.stdout}${ok.stderr}`);
    assert.ok(!outLines(ok).some((l) => l.startsWith('[error] verification')), `${what}: no verification error`);
  }
});

test('AC-19801-4: outside git, or in git with no origin/main and no --base, validate over an unflagged new criterion exits 0 with exactly one "[warn] verification: no base ref; new and amended criteria not checked" line; --base naming a missing ref exits 2 "[error] usage --base <ref> does not resolve"', async (t) => {
  const plain = await project(t, { name: 'nogit' });
  setCriteria(plain, [gwt('AC-101-1'), gwt('AC-101-2')]);
  const noRepo = await validate(plain, [], { GIT_CEILING_DIRECTORIES: dirname(plain) });
  const { dir } = await baseRepo(t);
  setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2')]);
  commit(dir, 'add AC-101-2 unflagged');
  const noOrigin = await validate(dir);
  for (const [label, r] of [['not a git repository', noRepo], ['no origin/main', noOrigin]]) {
    assert.equal(r.code, 0, `${label}\n${r.stdout}${r.stderr}`);
    assert.deepEqual(lines(r.stderr).filter((l) => l.includes('verification')), [WARN], `${label}: stderr carries exactly the one warn line`);
  }
  const bad = await validate(dir, ['--base', 'no-such-ref']);
  assert.equal(bad.code, 2, `${bad.stdout}${bad.stderr}`);
  assert.ok(lines(bad.stderr).includes('[error] usage --base no-such-ref does not resolve'), bad.stderr);
});

test('AC-19801-5: a retired criterion is never required to carry verification and never in the verification report, new or amended since the base; and the rule never changes the exit code of validate for another finding', async (t) => {
  // New since the base, retired.
  {
    const { dir, base } = await baseRepo(t);
    setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2', { verification: 'external' }), gwt('AC-101-3', retire('AC-101-2'))]);
    commit(dir, 'add AC-101-2 and the retired AC-101-3');
    const r = await validate(dir, ['--base', base]);
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.ok(!outLines(r).some((l) => l.includes('verification') && l.includes('AC-101-3')), 'no verification line for the retired AC-101-3');
    const w = await validate(dir, ['--report', 'verification']);
    assert.equal(w.code, 0, `${w.stdout}${w.stderr}`);
    assert.ok(!lines(w.stdout).some((l) => l.startsWith('AC-101-3\t')), 'the retired criterion is not in the report');
    assert.ok(lines(w.stdout).some((l) => l.startsWith('AC-101-1\t')), 'the live unflagged AC-101-1 is');
  }
  // Amended since the base into its retirement.
  {
    const { dir } = await baseRepo(t);
    setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2')]);
    const base = commit(dir, 'fixture: AC-101-2 unflagged');
    setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2', { then: 'it exits 3', ...retire('AC-101-3') }), gwt('AC-101-3', { verification: 'testOnly' })]);
    commit(dir, 'retire AC-101-2 for AC-101-3');
    const r = await validate(dir, ['--base', base]);
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.ok(!outLines(r).some((l) => l.includes('verification') && l.includes('AC-101-2')), 'no verification line for the retired AC-101-2');
    const w = await validate(dir, ['--report', 'verification']);
    assert.ok(!lines(w.stdout).some((l) => l.startsWith('AC-101-2\t')), 'the retired criterion is not in the report');
  }
  // Another finding keeps its own exit code.
  {
    const { dir, base } = await baseRepo(t);
    setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2', { verification: 'testOnly' })], ['AC-101-1', 'AC-101-2', 'AC-999-9']);
    commit(dir, 'FBS-001 names a missing criterion');
    const withRule = await validate(dir, ['--base', base]);
    const reportOnly = await validate(dir);
    assert.equal(withRule.code, 3, `${withRule.stdout}${withRule.stderr}`);
    assert.equal(withRule.code, reportOnly.code, 'the same exit with and without a base');
    assert.ok(outLines(withRule).some((l) => l.startsWith('[error]') && l.includes('AC-999-9')), 'the broken reference is reported');
    assert.ok(!outLines(withRule).some((l) => l.startsWith('[error] verification')), 'and no verification error');
  }
});

// .github/workflows/ci.yml read with Node builtins only: a YAML library is
// a devDependency, absent from the packed artefact the Test stage installs
// (the stage-keeper's ruling on round A fix 1). The reader models the YAML
// a GitHub workflow file is written in and reads it into the objects a
// YAML parser returns for it: block mappings and block sequences nested by
// indentation (spaces only; a mapping's keys at one indentation; a
// sequence under a key at the key's indentation or deeper; a sequence item
// holding a scalar, a nested block, or a mapping that starts on the item's
// line), plain or quoted scalar keys, values written whole on their line
// as a plain scalar, a single- or double-quoted scalar, a one-line flow
// sequence of such scalars, [] or {}, a literal block scalar (| or |-),
// full-line and trailing comments, and a --- on the first line. Plain
// scalars resolve as the core schema does for null (~, null, empty), the
// booleans (true, false, in their three cases) and decimal numbers; every
// other value is a string. It throws an error naming the line and the
// construct, which fails the test, on everything else: a tab in
// indentation, a line off its mapping's or sequence's indentation (a
// multi-line plain scalar's continuation, say), a duplicate key, an
// anchor, an alias, a tag, a merge or complex key, a folded block scalar
// or a block scalar with a chomping or indentation indicator other than
// |-, a flow mapping with entries, a nested or unclosed flow collection, a
// quoted scalar that does not close on its line, a plain scalar holding
// ": " or opening with an indicator, a plain scalar the core schema reads
// as a typed value this reader does not model (an octal, hexadecimal,
// underscored or leading-zero number, .inf, .nan or a timestamp), a
// double-quoted escape JSON does not read, and a document marker after the
// first line.
function readWorkflow(text) {
  const raw = text.split(/\r?\n/);
  let at = 0;
  const refuse = (n, construct) => {
    throw new Error(`ci.yml line ${n + 1}: ${construct}, outside the YAML this reader models, so it refuses it: ${raw[n].trim()}`);
  };
  const leadOf = (n) => {
    const lead = /^[ \t]*/.exec(raw[n])[0];
    if (lead.includes('\t')) refuse(n, 'a tab in indentation');
    return lead.length;
  };
  // The next line holding a node, past blank and comment lines; -1 at the end.
  const next = () => {
    for (; at < raw.length; at++) {
      const line = raw[at];
      if (/^\s*(#.*)?$/.test(line)) continue;
      if (/^(---|\.\.\.)(\s|$)/.test(line)) {
        if (at === 0 && /^---\s*(#.*)?$/.test(line)) continue;
        refuse(at, 'a document marker (--- after the first line, or ...)');
      }
      return at;
    }
    return -1;
  };
  // The text before a comment: a # at the start or after a space, outside quotes.
  const uncomment = (n, s) => {
    let quote = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        if (quote === '"' && c === '\\') i++;
        else if (c === quote && quote === "'" && s[i + 1] === "'") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if ((c === "'" || c === '"') && (i === 0 || /[\s[,]/.test(s[i - 1]))) quote = c;
      else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
    }
    if (quote) refuse(n, 'a quoted scalar that does not close on its line');
    return s.trimEnd();
  };
  const plain = (n, s) => {
    if (/^[&*!|>%@`{}[\],#'"]/.test(s) || /^[?:-](\s|$)/.test(s)) refuse(n, `a plain scalar opening with an indicator (${s[0]})`);
    if (/:(\s|$)/.test(s)) refuse(n, 'a plain scalar holding ": "');
    if (s === '' || s === '~' || /^(null|Null|NULL)$/.test(s)) return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?(0|[1-9][0-9]*)$/.test(s) || /^[-+]?(0|[1-9][0-9]*)?\.[0-9]+([eE][-+]?[0-9]+)?$/.test(s) || /^[-+]?(0|[1-9][0-9]*)(\.[0-9]*)?[eE][-+]?[0-9]+$/.test(s)) return Number(s);
    if (/^[-+]?(0[0-9_box]|[0-9][0-9_]*_|\.(inf|Inf|INF|nan|NaN|NAN)$|[0-9]+\.[0-9]*$)/.test(s) || /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}/.test(s)) {
      refuse(n, 'a plain scalar the core schema reads as a typed value this reader does not model');
    }
    return s;
  };
  const scalar = (n, s) => {
    if (s[0] === "'") {
      if (!/^'(?:[^']|'')*'$/.test(s)) refuse(n, 'a single-quoted scalar with text after its closing quote');
      return s.slice(1, -1).replaceAll("''", "'");
    }
    if (s[0] === '"') {
      if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) refuse(n, 'a double-quoted scalar with text after its closing quote');
      try {
        return JSON.parse(s);
      } catch {
        return refuse(n, 'a double-quoted escape JSON does not read');
      }
    }
    return plain(n, s);
  };
  const flowSeq = (n, s) => {
    if (!s.endsWith(']')) refuse(n, 'a flow collection that is not whole on its line');
    const body = s.slice(1, -1).trim();
    if (body === '') return [];
    const items = [];
    let quote = null;
    let start = 0;
    for (let i = 0; i <= body.length; i++) {
      const c = body[i];
      if (quote) {
        if (quote === '"' && c === '\\') i++;
        else if (c === quote && quote === "'" && body[i + 1] === "'") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === '[' || c === ']' || c === '{' || c === '}') refuse(n, 'a nested flow collection');
      else if (c === ',' || i === body.length) {
        const item = body.slice(start, i).trim();
        if (item === '') refuse(n, 'an empty flow sequence entry');
        items.push(scalar(n, item));
        start = i + 1;
      }
    }
    return items;
  };
  // A literal block scalar under the line n whose node sits at column col.
  const block = (n, col, chomp) => {
    const body = [];
    let indent = null;
    for (at = n + 1; at < raw.length; at++) {
      const line = raw[at];
      if (/^ *$/.test(line)) { body.push(indent !== null && line.length > indent ? line.slice(indent) : ''); continue; }
      const lead = /^ */.exec(line)[0].length;
      if (indent === null) {
        if (lead <= col) break;
        indent = lead;
      }
      if (lead < indent) {
        if (line[lead] === '\t') refuse(at, 'a tab in indentation');
        break;
      }
      body.push(line.slice(indent));
    }
    while (body.length && body.at(-1) === '') body.pop();
    if (body.length === 0) return '';
    return body.join('\n') + (chomp ? '' : '\n');
  };
  // The value written after a key or a dash on line n, the node at column col.
  const value = (n, col, s) => {
    if (s === '') {
      const m = next();
      if (m === -1) return null;
      const lead = leadOf(m);
      if (lead > col) return node(lead);
      if (lead === col && /^-(\s|$)/.test(raw[m].slice(lead))) return sequence(lead);
      return null;
    }
    if (s === '|' || s === '|-') return block(n, col, s === '|-');
    if (/^[|>]/.test(s)) refuse(n, 'a block scalar other than | or |- (folded, or a chomping or indentation indicator)');
    if (s[0] === '[') return flowSeq(n, s);
    if (s[0] === '{') {
      if (s === '{}') return {};
      refuse(n, 'a flow mapping with entries');
    }
    if (/^[&*!]/.test(s)) refuse(n, 'an anchor, alias or tag');
    return scalar(n, s);
  };
  // key: value on line n, its key at column col; sets it on map.
  const entry = (n, col, s, map) => {
    if (/^[?&*!]/.test(s) || /^<<\s*:/.test(s)) refuse(n, 'a complex key, merge key, anchor, alias or tag');
    const m = /^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^'"\s][^]*?):(?:\s+([^]*))?$/.exec(s);
    if (!m) refuse(n, 'a line that is not a key with its value or a sequence item');
    const key = scalar(n, m[1].trimEnd());
    if (typeof key !== 'string') refuse(n, 'a key that is not a string');
    if (Object.hasOwn(map, key)) refuse(n, 'a duplicate key');
    Object.defineProperty(map, key, { value: value(n, col, (m[2] ?? '').trim()), enumerable: true, writable: true, configurable: true });
  };
  const mapping = (col, first) => {
    const map = {};
    if (first) entry(first.n, col, first.s, map);
    for (let n = next(); n !== -1; n = next()) {
      const lead = leadOf(n);
      if (lead < col) break;
      if (lead > col) refuse(n, 'a line off its mapping\'s indentation (a multi-line scalar\'s continuation or a mis-indented key)');
      const s = uncomment(n, raw[n].slice(lead));
      if (/^-(\s|$)/.test(s)) {
        if (first) break;
        refuse(n, 'a sequence item beside mapping keys');
      }
      at = n + 1;
      entry(n, col, s, map);
    }
    return map;
  };
  const sequence = (col) => {
    const list = [];
    for (let n = next(); n !== -1; n = next()) {
      const lead = leadOf(n);
      if (lead < col) break;
      if (lead > col) refuse(n, 'a line off its sequence\'s indentation');
      const s = uncomment(n, raw[n].slice(lead));
      if (!/^-(\s|$)/.test(s)) break;
      at = n + 1;
      const rest = s.slice(1);
      const content = rest.trimStart();
      const itemCol = col + 1 + (rest.length - content.length);
      if (content === '') list.push(value(n, col, ''));
      else if (/^-(\s|$)/.test(content)) refuse(n, 'a sequence nested on its item\'s line');
      else if (/^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^'"\s[{][^]*?):(\s|$)/.test(content)) {
        list.push(mapping(itemCol, { n, s: content }));
      } else list.push(value(n, itemCol, content));
    }
    return list;
  };
  const node = (col) => {
    const n = next();
    const s = uncomment(n, raw[n].slice(col));
    return /^-(\s|$)/.test(s) ? sequence(col) : mapping(col);
  };
  const first = next();
  if (first === -1) return null;
  const doc = node(leadOf(first));
  const rest = next();
  if (rest !== -1) refuse(rest, 'a line off its mapping\'s indentation');
  return doc;
}

test('AC-19801-6: the CI test job checks out with fetch-depth 0, runs validate --base origin/${{ github.base_ref }} from packages/rcf-lite only on pull_request, and validate with no --base only on push', () => {
  const ci = readWorkflow(readFileSync(join(checkoutRoot(), '.github', 'workflows', 'ci.yml'), 'utf8'));
  const steps = ci?.jobs?.test?.steps ?? [];
  assert.ok(steps.length > 0, 'ci.yml has a test job with steps');
  const checkout = steps.find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
  assert.ok(checkout, 'the test job checks out');
  assert.equal(checkout.with?.['fetch-depth'], 0, 'with fetch-depth 0');
  const PR = "github.event_name == 'pull_request'";
  const PUSH = "github.event_name == 'push'";
  const runs = (cmd) => steps.filter((s) => typeof s.run === 'string' && s.run.trim() === cmd);
  const withBase = runs('node bin/rcf.js define validate --base origin/${{ github.base_ref }}');
  assert.ok(withBase.some((s) => s.if === PR && s['working-directory'] === 'packages/rcf-lite'), 'a pull_request step runs validate --base origin/${{ github.base_ref }} from packages/rcf-lite');
  const plain = runs('node bin/rcf.js define validate');
  assert.ok(plain.some((s) => s.if === PUSH && s['working-directory'] === 'packages/rcf-lite'), 'a push step runs validate with no --base from packages/rcf-lite');
  const unguarded = steps.filter((s) => typeof s.run === 'string' && /define validate[^\n]*--base/.test(s.run) && s.if !== PR);
  assert.deepEqual(unguarded.map((s) => s.run), [], 'no step outside pull_request passes --base');
});

// Round B ruling 29: on pull_request, actions/checkout's default ref is the
// merge commit GitHub synthesises, which carries no stage prefix; the
// separation job checks out the pull request's own head instead.
test('AC-19801-7: the CI separation job runs only on pull_request, checks out the head of the pull request (ref ${{ github.event.pull_request.head.sha }}) with fetch-depth 0, and runs audit separation --base origin/${{ github.base_ref }} from packages/rcf-lite', () => {
  const ci = readWorkflow(readFileSync(join(checkoutRoot(), '.github', 'workflows', 'ci.yml'), 'utf8'));
  const job = ci?.jobs?.separation;
  assert.ok(job, 'ci.yml has a separation job');
  assert.equal(job.if, "github.event_name == 'pull_request'", 'the separation job runs only on pull_request');
  const steps = job.steps ?? [];
  const checkout = steps.find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
  assert.ok(checkout, 'the separation job checks out');
  assert.equal(checkout.with?.ref, '${{ github.event.pull_request.head.sha }}', 'it checks out the head of the pull request, never the merge commit GitHub synthesises');
  assert.equal(checkout.with?.['fetch-depth'], 0, 'with fetch-depth 0');
  const audit = steps.filter((s) => typeof s.run === 'string' && s.run.trim() === 'node bin/rcf.js audit separation --base origin/${{ github.base_ref }}');
  assert.ok(audit.some((s) => s['working-directory'] === 'packages/rcf-lite'), 'a step runs audit separation --base origin/${{ github.base_ref }} from packages/rcf-lite');
});

// ---------------------------------------------------------------- US-19802

const D2 = 'AC-101-2 is the first unflagged criterion, scoped by FBS-001, and its description runs past eighty characters';
const D3 = 'AC-101-3 is the second unflagged criterion, scoped by no spec';

test('AC-19802-1: rcf define validate --report verification over 3 live criteria (1 flagged, 2 unflagged, FBS-001 scoping the first unflagged) exits 0 and prints two tab-separated worklist lines in id order, then "verification: 2 of 3 live criteria unflagged"', async (t) => {
  const dir = await project(t, { name: 'worklist' });
  setCriteria(dir, [gwt('AC-101-1', { verification: 'external' }), criterion('AC-101-2', D2), criterion('AC-101-3', D3)], ['AC-101-1', 'AC-101-2']);
  const r = await validate(dir, ['--report', 'verification']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), [
    `AC-101-2\tUS-101\tFBS-001\t${D2.slice(0, 80)}`,
    `AC-101-3\tUS-101\t-\t${D3.slice(0, 80)}`,
    'verification: 2 of 3 live criteria unflagged',
  ]);
});

test('AC-19802-2: with every live criterion flagged the report prints only "verification: 0 of <n> live criteria unflagged" and --json prints {"unflagged": [], "live": <n>}; with unflagged criteria each JSON entry is { acId, usId, fbsId (string or null), description }', async (t) => {
  const flagged = await project(t, { name: 'flagged' });
  setCriteria(flagged, [gwt('AC-101-1', { verification: 'external' }), gwt('AC-101-2', { verification: 'testOnly' })]);
  const r = await validate(flagged, ['--report', 'verification']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(lines(r.stdout), ['verification: 0 of 2 live criteria unflagged']);
  const j = await validate(flagged, ['--report', 'verification', '--json']);
  assert.equal(j.code, 0, `${j.stdout}${j.stderr}`);
  assert.deepEqual(json(j.stdout), { unflagged: [], live: 2 });

  const some = await project(t, { name: 'unflagged' });
  setCriteria(some, [gwt('AC-101-1', { verification: 'external' }), criterion('AC-101-2', D3.replace('AC-101-3', 'AC-101-2')), criterion('AC-101-3', D3)], ['AC-101-1', 'AC-101-2']);
  const k = await validate(some, ['--report', 'verification', '--json']);
  assert.equal(k.code, 0, `${k.stdout}${k.stderr}`);
  const doc = json(k.stdout);
  assert.equal(doc.live, 3);
  assert.deepEqual([...doc.unflagged].sort((a, b) => a.acId.localeCompare(b.acId)), [
    { acId: 'AC-101-2', usId: 'US-101', fbsId: 'FBS-001', description: D3.replace('AC-101-3', 'AC-101-2') },
    { acId: 'AC-101-3', usId: 'US-101', fbsId: null, description: D3 },
  ]);
});

test('AC-19802-3: over 1000 unflagged live criteria across 250 stories the report finishes within 1.5 times a plain rcf define validate over the same tree (median of three each) and prints exactly 1001 lines', async (t) => {
  hostFacts(t);
  const dir = await project(t, { name: 'heavy' });
  const req = readJson(dir, 'rcf/requirements/req-001.json');
  const story = readJson(dir, 'rcf/user-stories/us-101.json');
  for (let r = 1; r <= 5; r++) {
    const reqId = `REQ-00${r}`;
    if (r > 1) writeJson(dir, `rcf/requirements/req-00${r}.json`, { ...req, reqId, title: `Requirement ${r} of the heavy sweep` });
    for (let s = 1; s <= 50; s++) {
      const usId = `US-${r}${String(s).padStart(2, '0')}`;
      const n = usId.slice(3);
      writeJson(dir, `rcf/user-stories/${usId.toLowerCase()}.json`, {
        ...story, usId, reqId, title: `Story ${usId} of the heavy sweep`,
        acceptanceCriteria: [1, 2, 3, 4].map((k) => criterion(`AC-${n}-${k}`, `criterion ${k} of ${usId} holds for the heavy sweep`)),
      });
    }
  }
  const plain = [];
  const report = [];
  let last;
  for (let i = 0; i < 3; i++) {
    plain.push((await validate(dir)).ms);
    last = await validate(dir, ['--report', 'verification']);
    report.push(last.ms);
  }
  assert.equal(last.code, 0, `${last.stdout.slice(0, 500)}${last.stderr}`);
  const out = lines(last.stdout);
  assert.equal(out.length, 1001, 'exactly 1001 lines');
  assert.equal(out.at(-1), 'verification: 1000 of 1000 live criteria unflagged');
  const ratio = median(report) / median(plain);
  t.diagnostic(`median report ${Math.round(median(report))} ms, median plain ${Math.round(median(plain))} ms, ratio ${ratio.toFixed(2)}`);
  assert.ok(ratio <= 1.5, `the report takes at most 1.5 times a plain validate (ratio ${ratio.toFixed(2)})`);
});

test('AC-19802-4: rcf define validate --report flags exits 2 with "[error] usage --report takes verification" and prints no worklist line', async (t) => {
  const dir = await project(t, { name: 'report-flags' });
  setCriteria(dir, [criterion('AC-101-1', D3.replace('AC-101-3', 'AC-101-1'))]);
  const r = await validate(dir, ['--report', 'flags']);
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  assert.ok(lines(r.stderr).includes('[error] usage --report takes verification'), r.stderr);
  assert.ok(!lines(r.stdout).some((l) => l.includes('\t') || l.startsWith('verification:')), 'no worklist line');
});

function snapshot(dir) {
  const root = join(dir, 'rcf');
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name)).sort()
    .map((p) => [p.slice(dir.length + 1), createHash('sha256').update(readFileSync(p)).digest('hex')]));
}

test('AC-19802-5: the worklist never writes (every file under rcf/ byte-identical, git status --porcelain unchanged) and never assigns or suggests a flag', async (t) => {
  const dir = await project(t, { git: true, name: 'worklist-rw' });
  setCriteria(dir, [criterion('AC-101-1', 'AC-101-1 holds for the read-only sweep'), criterion('AC-101-2', 'AC-101-2 holds for the read-only sweep')]);
  commit(dir, 'two unflagged criteria');
  const files = snapshot(dir);
  const status = porcelain(dir);
  const r = await validate(dir, ['--report', 'verification']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(snapshot(dir), files, 'every file under rcf/ is byte-identical');
  assert.equal(porcelain(dir), status, 'git status --porcelain is unchanged');
  const work = lines(r.stdout).filter((l) => l.includes('\t'));
  assert.equal(work.length, 2);
  for (const l of work) {
    assert.equal(l.split('\t').length, 4, `a worklist line carries its four fields only: ${l}`);
    assert.doesNotMatch(l, /\b(external|testOnly)\b/, `no flag is suggested: ${l}`);
  }
  for (const a of readJson(dir, 'rcf/user-stories/us-101.json').acceptanceCriteria) assert.equal(a.verification, undefined, `${a.id} is not assigned a flag`);
});

// ---------------------------------------------------------------- US-19803

// A fixture project: US-101 with `acs`; `specs` { id: { status, acIds } };
// each `bound` criterion bound to a resolving test.
async function covProject(t, { acs, specs, bound }) {
  const dir = await project(t, { name: 'end' });
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria = acs; });
  const one = readJson(dir, 'rcf/fbs/fbs-001.json');
  Object.entries(specs).forEach(([id, s], i) => editFbs(dir, id, () => ({
    ...one, fbsId: id, buildOrder: i + 1, title: `${id} fixture`, summary: `${id} scopes ${s.acIds.join(', ')}.`, acIds: s.acIds, executionStatus: s.status,
  })));
  bindTests(dir, bound.map((acId) => ({ acId, pointer: `test/rcf/a.test.js::${acId} holds` })));
  return dir;
}
const flag = (id, verification, extra = {}) => criterion(id, `${id} holds`, verification ? { verification, ...extra } : extra);
const acRows = (j) => j.requirements.flatMap((r) => r.acs);
const acRow = (j, id) => acRows(j).find((a) => a.id === id);
const ends = (o) => o && { verification: o.verification, expectedEnd: o.expectedEnd, now: o.now };
// The spec entry for id wherever the JSON places it: an object naming id
// that carries expectedEnd and is not a criterion row.
const specEntry = (j, id) => objectsIn(j).find((o) => (o.fbsId === id || o.id === id) && 'expectedEnd' in o && !('acId' in o) && !String(o.id ?? '').startsWith('AC-'));
const coverage = (dir, args) => rcf(['audit', 'coverage', ...args], { cwd: dir });

test('AC-19803-1: over FBS-001 (complete) scoping AC-101-1 (external) and AC-101-2 (testOnly), both bound, audit coverage --format json exits 0 with rows external/verified/complete and testOnly/complete/complete and the spec entry expectedEnd verified, now complete', async (t) => {
  const dir = await covProject(t, { acs: [flag('AC-101-1', 'external'), flag('AC-101-2', 'testOnly')], specs: { 'FBS-001': { status: 'complete', acIds: ['AC-101-1', 'AC-101-2'] } }, bound: ['AC-101-1', 'AC-101-2'] });
  const r = await coverage(dir, ['--format', 'json']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const j = json(r.stdout);
  assert.deepEqual(ends(acRow(j, 'AC-101-1')), { verification: 'external', expectedEnd: 'verified', now: 'complete' });
  assert.deepEqual(ends(acRow(j, 'AC-101-2')), { verification: 'testOnly', expectedEnd: 'complete', now: 'complete' });
  const spec = specEntry(j, 'FBS-001');
  assert.ok(spec, 'the JSON carries a spec entry for FBS-001');
  assert.deepEqual({ expectedEnd: spec.expectedEnd, now: spec.now }, { expectedEnd: 'verified', now: 'complete' });
});

test('AC-19803-2: with FBS-001 at verified the testOnly AC-101-2 reads now complete and the external AC-101-1 now verified; FBS-002 scoping only testOnly criteria reads expectedEnd complete', async (t) => {
  const dir = await covProject(t, {
    acs: [flag('AC-101-1', 'external'), flag('AC-101-2', 'testOnly'), flag('AC-101-3', 'testOnly')],
    specs: { 'FBS-001': { status: 'verified', acIds: ['AC-101-1', 'AC-101-2'] }, 'FBS-002': { status: 'inProgress', acIds: ['AC-101-3'] } },
    bound: ['AC-101-1', 'AC-101-2', 'AC-101-3'],
  });
  const r = await coverage(dir, ['--format', 'json']);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const j = json(r.stdout);
  assert.equal(acRow(j, 'AC-101-2')?.now, 'complete', 'a testOnly criterion never reads past its end');
  assert.equal(acRow(j, 'AC-101-1')?.now, 'verified');
  assert.equal(specEntry(j, 'FBS-002')?.expectedEnd, 'complete');
});

test('AC-19803-3: in --format table the unflagged AC-101-3 row shows flag unflagged, end unknown, now complete; the retired AC-101-4 shows now retired with no end; a spec with an unflagged criterion and no external one shows end unknown', async (t) => {
  const dir = await covProject(t, {
    acs: [flag('AC-101-1', 'testOnly'), flag('AC-101-2', 'external'), flag('AC-101-3'), flag('AC-101-4', 'testOnly', retire('AC-101-3'))],
    specs: { 'FBS-001': { status: 'complete', acIds: ['AC-101-1', 'AC-101-3'] }, 'FBS-002': { status: 'inProgress', acIds: ['AC-101-2'] } },
    bound: ['AC-101-1', 'AC-101-2', 'AC-101-3'],
  });
  const r = await coverage(dir, ['--format', 'table']);
  const tbs = tables(r.stdout);
  const rows = tbs.filter((x) => x.headers.includes('AC')).flatMap((x) => x.rows);
  const r3 = rows.find((x) => x.AC === 'AC-101-3');
  assert.ok(r3, `a row for AC-101-3\n${r.stdout}`);
  assert.deepEqual({ flag: r3.flag, end: r3.end, now: r3.now }, { flag: 'unflagged', end: 'unknown', now: 'complete' });
  const r4 = rows.find((x) => x.AC === 'AC-101-4');
  assert.ok(r4, 'a row for the retired AC-101-4');
  assert.equal(r4.now, 'retired');
  assert.ok(['', '-'].includes(r4.end), `the retired row shows no end (got "${r4.end}")`);
  const specRows = tbs.filter((x) => x.headers.includes('end')).flatMap((x) => x.rows)
    .filter((row) => Object.values(row).includes('FBS-001') && !Object.values(row).some((v) => /^AC-\d+-\d+$/.test(v)));
  assert.ok(specRows.length > 0, `a spec row for FBS-001\n${r.stdout}`);
  assert.equal(specRows[0].end, 'unknown');
});

test('AC-19803-4: audit coverage --strict exits with the same code and the same gaps before and after the flag of a criterion or the status of its spec changes, and a criterion short of its end state is never a gap', async (t) => {
  const dir = await covProject(t, { acs: [flag('AC-101-1', 'external'), flag('AC-101-2', 'testOnly')], specs: { 'FBS-001': { status: 'complete', acIds: ['AC-101-1', 'AC-101-2'] } }, bound: ['AC-101-1'] });
  const gaps = (r) => acRows(json(r.stdout)).filter((a) => !a.covered).map((a) => a.id).sort();
  const before = await coverage(dir, ['--strict', '--format', 'json']);
  editStory(dir, 'US-101', (us) => { us.acceptanceCriteria[0].verification = 'testOnly'; });
  const flagged = await coverage(dir, ['--strict', '--format', 'json']);
  editFbs(dir, 'FBS-001', (f) => { f.executionStatus = 'inProgress'; });
  const status = await coverage(dir, ['--strict', '--format', 'json']);
  assert.deepEqual(gaps(before), ['AC-101-2'], 'the unbound criterion is the one gap; the bound AC-101-1 short of verified is not');
  for (const [label, r] of [['after the flag change', flagged], ['after the status change', status]]) {
    assert.equal(r.code, before.code, `${label}: the same exit code`);
    assert.deepEqual(gaps(r), gaps(before), `${label}: the same gaps`);
  }
});

// The pre-move goldens FBS-235's round DEFINE records (the stage-keeper's
// rulings F5, F6 and F7 on the independent check), from packages/rcf-lite,
// immediately before the move commit, on the tree that is the move
// commit's parent, with the round-base bin:
//   node test/_harness/goldens.js coverage-rows test/fixtures/flag-move/coverage-rows-before.json
//   node test/_harness/goldens.js flag-tags test/fixtures/flag-move/tags-before.json
//   node test/_harness/goldens.js flag-texts test/fixtures/flag-move/criteria-before.json
// While one is absent the test reading it fails naming that step, never skips.
const ROWS_GOLDEN = 'test/fixtures/flag-move/coverage-rows-before.json';
const TAGS_GOLDEN = 'test/fixtures/flag-move/tags-before.json';
const TEXTS_GOLDEN = 'test/fixtures/flag-move/criteria-before.json';
const MOVE_STEP = (kind, path) => `FBS-235's round DEFINE records ${path} immediately before the move commit (node test/_harness/goldens.js ${kind} ${path})`;
function moveGolden(kind, path) {
  const file = join(checkoutPackage(), path);
  assert.ok(existsSync(file), `${MOVE_STEP(kind, path)}: ${path} is absent`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
// The typical case of AC-19803-5's Given, at the current head.
function assertTypicalChain(pkg, rowCount) {
  const specs = readdirSync(join(pkg, 'rcf', 'fbs')).filter((f) => f.endsWith('.json')).length;
  assert.ok(rowCount >= 827 && specs >= 121, `the typical case: ${rowCount} criteria, ${specs} specs`);
}
const PERF = process.env.RCF_PERF === '1';
// The chain AC-19803-5's row half and AC-19804-2 read (the stage-keeper's
// ruling RC-14 on the round C DEFINE): add917a6, the 0.37.0 release merge
// on main, where FBS-235 is verified. Each reads the chain at that fixed
// ref through git (the way test/_harness/goldens.js reads 639f07bb), never
// the moving head, so no later DEFINE or BUILD moves the result; CI checks
// out with fetch-depth: 0, so the ref is in its history. The row half runs
// that tree's own bin in a temporary worktree at the ref (worktreeAt
// below); the text half reads the stories at the ref with git cat-file.
const VERIFIED_AT = 'add917a6db7f52536254dde491930103abbbe13b';
function storiesAt(root, rev) {
  const dir = 'packages/rcf-lite/rcf/user-stories';
  const paths = git(root, 'ls-tree', '--name-only', `${rev}:${dir}`).split('\n').filter((n) => n.endsWith('.json')).sort().map((n) => `${dir}/${n}`);
  return [...showAt(root, rev, paths).values()].map((text) => JSON.parse(text));
}

test('AC-19803-5: over the chain of this repository at the slice head, audit coverage --format json exits as in the coverage-rows golden recorded before the move, and each criterion row carries that golden row keys plus verification, expectedEnd and now, and nothing else', async () => {
  const pkg = checkoutPackage();
  const was = moveGolden('coverage-rows', ROWS_GOLDEN);
  assert.ok(Number.isInteger(was.exitCode) && was.rows && typeof was.rows === 'object', `${ROWS_GOLDEN} holds { "exitCode", "rows" }`);
  const now = await coverageRows(pkg);
  assertTypicalChain(pkg, Object.keys(now.rows).length);
  assert.equal(now.exitCode, was.exitCode, `audit coverage --format json exits ${now.exitCode} at the head and ${was.exitCode} in ${ROWS_GOLDEN}`);
  const added = ['verification', 'expectedEnd', 'now'];
  const grown = [];
  for (const [id, keys] of Object.entries(now.rows)) {
    const before = was.rows[id];
    if (!before) continue;
    const want = [...new Set([...before, ...added])].sort();
    if (JSON.stringify(keys) !== JSON.stringify(want)) grown.push(`${id}: ${keys.join(',')}`);
  }
  assert.ok(Object.keys(was.rows).some((id) => now.rows[id]), `${ROWS_GOLDEN} and the head share criterion rows`);
  // The stage-keeper's item 1 on the focused re-check (D2): every golden row
  // whose criterion is live at the head (in a story at the head, with no
  // supersededBy) has a head row, so a dropped row fails.
  const live = new Set(readStories(join(pkg, 'rcf', 'user-stories')).flatMap((s) => (s.acceptanceCriteria ?? []).filter((a) => !a.supersededBy).map((a) => a.id)));
  const dropped = Object.keys(was.rows).filter((id) => live.has(id) && !now.rows[id]);
  assert.deepEqual(dropped.slice(0, 10), [], `golden rows whose criterion is live at the head have no head row: ${dropped.slice(0, 10).join(', ')}`);
  assert.deepEqual(grown.slice(0, 10), [], 'each row carries the golden row keys plus verification, expectedEnd and now, and nothing else');
});

// The timing ratio of AC-19803-5 (the stage-keeper's ruling C3 on the
// independent check: the ledger-118 treatment): measured only with
// RCF_PERF=1, at TEST on the verifier's full clone, against a temporary
// worktree at the parent commit (decision 118's method, which the
// stage-keeper keeps for the two timing tests); skipped otherwise. The
// parent commit is the one FBS-235's BUILD changes from (the
// stage-keeper's ruling 5 for round B, the class of round A's ruling 8):
// the first parent of the first commit on the head's history whose
// subject carries FBS-235's BUILD stage prefix, found from git history as
// AC-19501-7 finds its pin move, and never HEAD^, which at the round's
// DEFINE carries the same production code as the head. Until that commit
// exists the test fails naming it, never skips, so it is red at DEFINE
// and measures the slice's change once its BUILD exists.
const BUILD_SUBJECT = 'BUILD: FBS-235 ';
function buildBase(root) {
  const rows = git(root, 'log', '--topo-order', '--reverse', '--format=%H%x09%s', 'HEAD').split('\n').filter(Boolean).map((r) => r.split('\t'));
  const first = rows.find(([, subject]) => subject.startsWith(BUILD_SUBJECT));
  assert.ok(first, `a commit on the head's history carries FBS-235's BUILD (its subject starts "${BUILD_SUBJECT}"), the commit the timing ratio measures from`);
  return git(root, 'rev-parse', `${first[0]}^1`);
}
function worktreeAt(t, root, rev) {
  const dir = join(scratch(t, 'rcf-h-parentwt-'), 'wt');
  git(root, 'worktree', 'add', '--detach', '--quiet', dir, rev);
  t.after(() => { gitTry(root, 'worktree', 'remove', '--force', dir); gitTry(root, 'worktree', 'prune'); });
  const inst = run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts'], { cwd: dir, env: { PATH: process.env.PATH } });
  assert.equal(inst.code, 0, `pnpm install in the worktree at ${rev}\n${inst.stdout.slice(-1000)}${inst.stderr.slice(-1000)}`);
  return join(dir, 'packages', 'rcf-lite');
}

test('AC-19803-5: over the chain of this repository at the slice head, audit coverage --format json takes at most 1.25 times the same command in a worktree at the parent commit, median of three runs each, measured at TEST with RCF_PERF=1', { skip: PERF ? false : 'measured at TEST by the verifier (RCF_PERF=1)' }, async (t) => {
  hostFacts(t);
  const root = checkoutRoot();
  const pkg = checkoutPackage();
  assert.equal(git(root, 'rev-parse', '--is-shallow-repository'), 'false', 'shallow clone: the parent commit is not there (the measurement runs at TEST on the verifier\'s full clone)');
  const parent = buildBase(root);
  const parentPkg = worktreeAt(t, root, parent);
  const cmd = ['audit', 'coverage', '--format', 'json'];
  const headMs = [];
  const parentMs = [];
  let h;
  let p;
  for (let i = 0; i < 3; i++) {
    h = await rcf(cmd, { cwd: pkg, bin: join(pkg, 'bin', 'rcf.js') });
    headMs.push(h.ms);
    p = await rcf(cmd, { cwd: parentPkg, bin: join(parentPkg, 'bin', 'rcf.js') });
    parentMs.push(p.ms);
  }
  assert.equal(h.code, p.code, `the same exit at the head and at the parent ${s7(parent)}`);
  assertTypicalChain(pkg, acRows(json(h.stdout)).length);
  const ratio = median(headMs) / median(parentMs);
  t.diagnostic(`median head ${Math.round(median(headMs))} ms, median parent ${Math.round(median(parentMs))} ms, ratio ${ratio.toFixed(2)}`);
  assert.ok(ratio <= 1.25, `within 1.25 times the parent (ratio ${ratio.toFixed(2)})`);
});

test('AC-19803-6: a hand-edited "verification": "sometimes" on AC-101-1 makes audit coverage exit 3 with a line naming AC-101-1 and the field verification, and print no coverage rows', async (t) => {
  const dir = await covProject(t, { acs: [flag('AC-101-1', 'sometimes')], specs: { 'FBS-001': { status: 'complete', acIds: ['AC-101-1'] } }, bound: ['AC-101-1'] });
  const r = await coverage(dir, []);
  assert.equal(r.code, 3, `${r.stdout}${r.stderr}`);
  assert.ok(outLines(r).some((l) => l.includes('AC-101-1') && l.includes('verification')), `a line names AC-101-1 and verification\n${r.stdout}${r.stderr}`);
  assert.deepEqual(tables(r.stdout).flatMap((x) => x.rows), [], 'no coverage rows');
  assert.ok(!lines(r.stdout).some((l) => /^REQ-\d+\s/.test(l)), 'no requirement row');
});

// ---------------------------------------------------------------- US-19804

test('AC-19804-1: at the slice head no user story tag starts "verification:", every criterion of the flag-tags golden recorded before the move carries verification equal to its tag, and node bin/rcf.js define validate exits 0', async () => {
  const pkg = checkoutPackage();
  const stories = readStories(join(pkg, 'rcf', 'user-stories'));
  assert.deepEqual(stories.flatMap((s) => (s.tags ?? []).filter((x) => x.startsWith('verification:')).map((x) => `${s.usId} ${x}`)), [], 'no tags entry starts "verification:"');
  const want = moveGolden('flag-tags', TAGS_GOLDEN);
  assert.ok(Object.keys(want).length > 0, `${TAGS_GOLDEN} records the interim tags before the move`);
  const now = new Map(stories.flatMap((s) => (s.acceptanceCriteria ?? []).map((a) => [a.id, a])));
  const wrong = Object.entries(want).filter(([id, f]) => now.get(id)?.verification !== f).map(([id, f]) => `${id}: tag ${f}, field ${now.get(id)?.verification}`);
  assert.deepEqual(wrong, [], 'every tagged criterion carries its flag on the field');
  const v = await rcf(['define', 'validate'], { cwd: pkg });
  assert.equal(v.code, 0, `${v.stdout.slice(-2000)}${v.stderr.slice(-2000)}`);
});

test('AC-19804-2: for every criterion moved, its description, given, when, then, testable and supersession fields are byte-identical at the slice head and in the flag-texts golden recorded before the move', async (t) => {
  const was = moveGolden('flag-texts', TEXTS_GOLDEN);
  assert.ok(Object.keys(was).length > 0, `${TEXTS_GOLDEN} records the tagged criteria before the move`);
  const now = new Map(storiesAt(checkoutRoot(), VERIFIED_AT).flatMap((s) => (s.acceptanceCriteria ?? []).map((a) => [a.id, a])));
  const changed = [];
  for (const [id, fields] of Object.entries(was)) {
    const cur = now.get(id);
    if (!cur) { changed.push(`${id}: not at the slice head`); continue; }
    for (const field of MOVE_TEXT_FIELDS) if (JSON.stringify(cur[field]) !== JSON.stringify(fields[field])) changed.push(`${id}.${field}`);
  }
  assert.deepEqual(changed, [], 'moving the flags changes no criterion text');
  // Control (round B ruling 28): the move as this repository made it (one
  // rcf define update <US id> --json call per story, setting each tagged
  // criterion's verification by index and the story's tags), over a fixture
  // story whose two criteria carry every compared field. Each moved
  // criterion carries its flag on the field and its compared fields are
  // byte-identical before and after.
  const dir = await project(t, { name: 'flag-move' });
  setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2', retire('AC-101-1'))]);
  editStory(dir, 'US-101', (us) => { us.tags = ['verification:AC-101-1=external', 'verification:AC-101-2=testOnly']; });
  const before = readJson(dir, 'rcf/user-stories/us-101.json').acceptanceCriteria;
  assert.deepEqual(MOVE_TEXT_FIELDS.filter((f) => !before.some((a) => a[f] !== undefined)), [], 'fixture: the two criteria carry every compared field');
  const u = await rcf(['define', 'update', 'US-101', '--json', '--set', 'acceptanceCriteria[0].verification="external"', '--set', 'acceptanceCriteria[1].verification="testOnly"', '--set', 'tags=[]'], { cwd: dir });
  assert.equal(u.code, 0, `${u.stdout}${u.stderr}`);
  const after = readJson(dir, 'rcf/user-stories/us-101.json').acceptanceCriteria;
  assert.deepEqual(after.map((a) => [a.id, a.verification]), [['AC-101-1', 'external'], ['AC-101-2', 'testOnly']], 'each moved criterion carries its flag on the field');
  const moved = before.flatMap((a, i) => MOVE_TEXT_FIELDS.filter((f) => JSON.stringify(after[i]?.[f]) !== JSON.stringify(a[f])).map((f) => `${a.id}.${f}`));
  assert.deepEqual(moved, [], 'the move changes no criterion text');
});

test('AC-19804-3: in a fixture repository the harness builds, a 0.37.0 criterion left without the field after the move on a branch off its base makes node bin/rcf.js define validate --base <the merge-base of that branch with main> exit 3, naming it as new since the base with no verification flag', async (t) => {
  // The fixture's main holds the base (AC-101-1, from before 0.37.0); the
  // DEFINE branch off it adds AC-101-2 moved onto the field and AC-101-3
  // left without it (the stage-keeper's ruling F8 on the independent check).
  const { dir, base } = await baseRepo(t);
  git(dir, 'checkout', '-q', '-b', 'define/fixture-0-37-0');
  setCriteria(dir, [gwt('AC-101-1'), gwt('AC-101-2', { verification: 'external' }), gwt('AC-101-3')]);
  commit(dir, 'DEFINE: the move leaves AC-101-3 without the field');
  const mergeBase = git(dir, 'merge-base', 'main', 'HEAD');
  assert.equal(mergeBase, base, 'fixture: the merge-base of the branch with main is the base commit');
  const r = await validate(dir, ['--base', mergeBase]);
  assert.equal(r.code, 3, `${r.stdout.slice(-2000)}${r.stderr.slice(-2000)}`);
  assert.ok(outLines(r).includes(errNew('AC-101-3', mergeBase)), `${r.stdout.slice(-2000)}${r.stderr.slice(-2000)}`);
});
