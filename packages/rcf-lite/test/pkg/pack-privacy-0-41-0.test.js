// FBS-243 (US-20501): the npm package stops shipping its own rcf/ folder
// (Baz decision 11, Dave's ruling R3; contract row C1). The package's rcf/
// holds this repository's own chain: verdicts naming reviewers, the
// rulings ledger. Nothing at runtime reads it.
//
// Criteria: AC-20501-1 (the real npm pack lists nothing under rcf/),
// AC-20501-3 (no packed file carries development-chain material) and
// AC-20501-2 (the journey: the tarball npm pack writes, installed into a
// fresh empty directory, runs rcf init, rcf doctor, rcf guidance
// build-cycle, the MCP server's resource listing and rcf audit view
// --port <p>, stopped by its own pid, each exit 0 and none reading under
// the installed package's rcf/). The journey runs the installed package's
// own bin with test/fixtures/read-log/hook.mjs preloaded, which logs every
// fs call under node_modules/rcf-lite/rcf/. npm install reaches the
// registry for the package's dependencies (ajv, ajv-formats,
// @stravica-ai/rcf-schemas). Imports: Node builtins and test/_harness/ only.
//
// AC-20501-4 (no packed file carries a developer home directory, an
// internal specification or estate path, or a consumer project, team or
// developer handle) reads the same unpacked tarball as AC-20501-3. Its
// home and estate shapes are generic and live here; the consumer, team
// and handle names are not committed anywhere in this tree: they come
// from the RCF_PRIVACY_FORBIDDEN_TERMS environment variable (newline
// separated, one term per line, matched whole-word without regard to
// case), which CI fills from the repository secret of the same name.
// Where the list is expected (RCF_PRIVACY_TERMS_EXPECTED true: the
// workflow steps that run the suite in the repository's own CI and its
// publish workflow) an empty or missing list fails the check by name
// (AC-20501-6); elsewhere the consumer-name class is reported as skipped,
// with one printed line, and the other classes still run. A hit on that
// class prints the term's position in the list, never the term.
//
// Reserve pass: the scan also reads each packed file with its newlines
// folded to spaces (a citation wrapped across two lines), every packed
// path, and the names the repository's own history records (AC-20501-3);
// a packed file it cannot read as plain text is named as unscanned
// (AC-20501-5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PACKAGE_ROOT, baseEnv, rcf } from '../_harness/spawn.js';
import { scratch } from '../_harness/fixture.js';

const NODE_DIR = dirname(process.execPath);
const HOOK = join(PACKAGE_ROOT, 'test', 'fixtures', 'read-log', 'hook.mjs');
const env = (extra = {}) => baseEnv({ PATH: `${NODE_DIR}:${baseEnv().PATH}`, ...extra });

function sh(cmd, args, { cwd, timeout = 300_000, extraEnv = {} } = {}) {
  return new Promise((res) => {
    execFile(cmd, args, { cwd, env: env(extraEnv), encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}
const show = (r) => `exit ${r.code}\nstdout:\n${r.stdout.slice(-4000)}\nstderr:\n${r.stderr.slice(-4000)}`;
const npm = (args, opts) => sh(process.execPath, [join(NODE_DIR, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args], opts);

// The JSON array npm pack --json prints (lifecycle output may precede it).
function packJson(stdout) {
  const at = stdout.search(/^\[\s*\{/m);
  assert.ok(at >= 0, `npm pack --json printed a JSON array\n${stdout.slice(0, 2000)}`);
  return JSON.parse(stdout.slice(at));
}

test('AC-20501-1: npm pack --dry-run --json in packages/rcf-lite lists no file whose path starts with rcf/', { timeout: 300_000 }, async () => {
  const r = await npm(['pack', '--dry-run', '--json'], { cwd: PACKAGE_ROOT });
  assert.equal(r.code, 0, show(r));
  const [entry] = packJson(r.stdout);
  const paths = entry.files.map((f) => f.path);
  assert.ok(paths.includes('bin/rcf.js') && paths.includes('package.json'), `the listing is the real package (bin/rcf.js, package.json)\n${paths.slice(0, 20).join('\n')}`);
  const leaked = paths.filter((p) => p.startsWith('rcf/'));
  assert.deepEqual(leaked.slice(0, 10), [], `no packed file under rcf/ (${leaked.length} found)`);
});

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

// A minimal MCP stdio client: initialize, resources/list, then close stdin.
function mcpResources(bin, cwd, extraEnv) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(HOOK).href, bin, 'mcp'], { cwd, env: env(extraEnv), stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
    let resources = null;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} });
        } else if (msg.id === 2) {
          resources = msg.result?.resources ?? null;
          child.stdin.end();
        }
      }
    });
    child.on('exit', (code, signal) => { clearTimeout(timer); res({ code: code ?? signal, resources, stderr }); });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pack-journey', version: '1.0.0' } } });
  });
}

// rcf audit view --port <p>: wait for the listening line and an HTTP 200,
// then stop it by its own pid with SIGTERM.
function viewJourney(bin, cwd, port, extraEnv) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(HOOK).href, bin, 'audit', 'view', '--port', String(port)], { cwd, env: env(extraEnv), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let status = null;
    let asked = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const onData = async (c) => {
      out += c;
      if (!asked && out.includes(`127.0.0.1:${port}`)) {
        asked = true;
        try { status = (await fetch(`http://127.0.0.1:${port}/`)).status; } catch (e) { status = String(e); }
        process.kill(child.pid, 'SIGTERM');
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code, signal) => { clearTimeout(timer); res({ code: code ?? signal, status, out }); });
  });
}

test('AC-20501-2: the tarball npm pack produces, installed into a fresh empty directory, runs rcf init, rcf doctor, rcf guidance build-cycle, the MCP resource listing and rcf audit view --port <p> (stopped by its own pid), each exit 0, with no read under the installed package rcf/', { timeout: 900_000 }, async (t) => {
  const out = scratch(t, 'rcf-h-pack-');
  const packed = await npm(['pack', '--json', '--pack-destination', out], { cwd: PACKAGE_ROOT });
  assert.equal(packed.code, 0, show(packed));
  const tgz = join(out, packJson(packed.stdout)[0].filename);
  assert.ok(existsSync(tgz), `npm pack wrote ${tgz}`);

  const app = join(out, 'app');
  mkdirSync(app);
  assert.deepEqual(readdirSync(app), [], 'given: a fresh empty directory');
  const inst = await npm(['install', '--no-audit', '--no-fund', '--ignore-scripts=false', tgz], { cwd: app, timeout: 600_000, extraEnv: { npm_config_cache: join(out, 'npm-cache') } });
  assert.equal(inst.code, 0, show(inst));
  const pkg = join(app, 'node_modules', 'rcf-lite');
  const bin = join(pkg, 'bin', 'rcf.js');
  assert.equal(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).name, 'rcf-lite', 'the installed package is rcf-lite');
  assert.equal(existsSync(join(pkg, 'rcf')), false, 'the installed package carries no rcf/ folder');

  const log = join(out, 'reads.log');
  const logEnv = { RCF_READ_LOG: log, RCF_READ_LOG_ROOT: join(pkg, 'rcf') };
  const rcfInstalled = (args) => sh(process.execPath, ['--import', pathToFileURL(HOOK).href, bin, ...args], { cwd: app, extraEnv: logEnv, timeout: 120_000 });

  const init = await rcfInstalled(['init']);
  assert.equal(init.code, 0, `rcf init\n${show(init)}`);
  assert.ok(existsSync(join(app, 'rcf', 'manifest.json')), 'rcf init scaffolds the project rcf/ in the install directory');
  const doctor = await rcfInstalled(['doctor']);
  assert.equal(doctor.code, 0, `rcf doctor\n${show(doctor)}`);
  const guide = await rcfInstalled(['guidance', 'build-cycle']);
  assert.equal(guide.code, 0, `rcf guidance build-cycle\n${show(guide)}`);
  assert.ok(guide.stdout.includes('DEFINE'), 'rcf guidance build-cycle prints the build cycle');

  const mcp = await mcpResources(bin, app, logEnv);
  assert.equal(mcp.code, 0, `the MCP server exits 0 on stdin close\n${mcp.stderr}`);
  assert.ok(Array.isArray(mcp.resources) && mcp.resources.some((r) => r.uri === 'rcf://docs/build-cycle'), `resources/list answers with rcf://docs/build-cycle\n${JSON.stringify(mcp.resources)?.slice(0, 2000)}\n${mcp.stderr}`);

  const port = await freePort();
  const view = await viewJourney(bin, app, port, logEnv);
  assert.equal(view.status, 200, `rcf audit view --port ${port} serves HTTP 200\n${view.out}`);
  assert.equal(view.code, 0, `rcf audit view exits 0 when stopped by its own pid\n${view.out}`);

  const reads = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  assert.deepEqual(reads.slice(0, 10), [], `no command reads under ${join(pkg, 'rcf')} (${reads.length} reads)`);
});

// DEFINE pass 2 (G2, ruling 12): taking rcf/ out of the tarball keeps the
// promise only if no other packed file carries the development chain. The
// test packs the real tarball, unpacks it with tar into a scratch
// directory and reads every packed file, line by line, against the
// patterns below. Each pattern names one kind of development-chain
// material; the names are the estate's operator, stage-keeper and
// reviewers (Barry, also Baz; Dave; Dex). Generic product copy that tells
// an adopter to record their own operator's ruling (rcf discover
// preflight, req-baseline, ui-classify, blueprint ADR stubs) is not a
// development ruling and does not match: the ruling pattern needs a date
// or a ruling number after it. Vendor quotations in blueprints ("verbatim
// quote on ADR-1306") do not match: a verbatim quote counts only in an
// operator or relay context.
const CHAIN = [
  ['a named operator, stage-keeper or reviewer', /\b(?:Dave|Baz|Barry|Dex)\b/],
  ['a dispatch id (d-YYYY-MM-DD-NNN)', /\bd-\d{4}-\d{2}-\d{2}-\d{3}\b/],
  ['a work-item id (w-YYYY-MM-DD-...)', /\bw-\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*/],
  ['a lane job id (r-YYYYMMDD-HHMMSS-xxxx)', /\br-\d{8}-\d{6}-[0-9a-f]{4}\b/],
  ['a relay id (a UUID in relay context)', /\brelay\b[^\n]{0,40}\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['a verdict record', /"verdictVersion"\s*:\s*\d|"scope"\s*:\s*"reviewVerdict"/],
  ['a quoted or cited development ruling', /\b(?:relay|operator)\b[^\n]{0,80}\bverbatim quote|\bruled by the operator\b|\b(?:maintainer|owner|operator|stage-keeper|reviewer)(?:'s)? (?:rulings?|decisions?|constraints?),?\s+(?:of |on |\()?(?:\d{4}-\d{2}-\d{2}|[A-Z]?\d+\b)|\b(?:maintainer|owner|operator|stage-keeper|reviewer)(?:'s)?\s+(?:rulings?|decisions?)\b[^\n]{0,24}?\b\d{4}-\d{2}-\d{2}\b/i],
];
// Round 3: the cited-ruling kind names any authority (maintainer, owner,
// operator, stage-keeper, reviewer), so "maintainer ruling <date>" is
// caught as "operator's ruling <date>" always was; it still needs a date
// or a ruling number after it, so product copy telling an adopter to
// record the owner's or the operator's ruling does not match.
//
// Reserve pass: the names come from the chain's own records too. Every
// author of a commit carrying a Hand: trailer, and the owner segment of
// every Hand-Id: trailer, read from this repository's history at run
// time, is matched whole-word without regard to case; the first kind's
// literal names stay as a floor, matched the same way. No name is
// written here.
const NAME_KIND = CHAIN[0][0];
const FLOOR = new RegExp(CHAIN[0][1].source, 'gi');
async function chainNames() {
  const r = await sh('git', ['log', '--format=%an%x1f%(trailers:key=Hand,valueonly,separator=%x2c)%x1f%(trailers:key=Hand-Id,valueonly,separator=%x2c)%x1e'], { cwd: PACKAGE_ROOT });
  assert.equal(r.code, 0, `git log reads the repository's own history\n${show(r)}`);
  const names = new Set();
  for (const rec of r.stdout.split('\x1e')) {
    const [author = '', hand = '', handId = ''] = rec.replace(/^\n+/, '').split('\x1f');
    if (!hand.trim()) continue;
    const who = author.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (who) names.add(who);
    for (const id of handId.split(',')) {
      const owner = id.trim().split('/')[0];
      if (id.includes('/') && owner) names.add(owner);
    }
  }
  return [...names].filter((n) => n.length >= 3).sort();
}

// AC-20501-4's generic shapes. An estate path is a project's
// specification, docs, wireframes or notes folder, or a maintainer's
// agent workspace folder; a home directory needs a user segment with no
// space and a further segment, so "/Users/john doe/work", "~/.cache" and
// a bare "no /Users/" do not match. The project and agent name segments
// take the home segment's class: letters of either case, digits, dot,
// underscore and hyphen.
const PRIVATE = [
  ['an internal specification or estate path', /\bprojects\/[A-Za-z0-9._-]+\/(?:specs?|docs|wireframes|notes)\/|\bagents\/[A-Za-z0-9._-]+\/(?:notes|staging|work|journal|briefs|roles|templates|operating-notes)\//],
  ['a developer home directory', /(?:^|[^A-Za-z0-9_.\/-])(?:\/Users|\/home)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]/],
];
const CONSUMER_KIND = 'a consumer project, team or developer handle';
const TERMS_VAR = 'RCF_PRIVACY_FORBIDDEN_TERMS';
const EXPECTED_VAR = 'RCF_PRIVACY_TERMS_EXPECTED';
const CONSUMER_SKIPPED = `consumer-name class skipped: ${TERMS_VAR} not set`;
const CONSUMER_REFUSED = `no forbidden terms configured: ${TERMS_VAR} is empty or missing where the list is expected (${EXPECTED_VAR})`;
const CONSUMER_TEST = 'AC-20501-4 consumer-name class';

// The consumer, team and handle terms: one per line, blank lines ignored.
function forbiddenTerms(env = process.env) {
  return String(env[TERMS_VAR] ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}
// Whether this run is one where the list is expected.
const termsExpected = (env = process.env) => /^(?:true|1|yes)$/i.test(String(env[EXPECTED_VAR] ?? '').trim());
let skipNoted = false;
function noteConsumerSkip() {
  if (skipNoted) return;
  skipNoted = true;
  console.log(CONSUMER_SKIPPED);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const globalRe = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
const wholeWord = (s, flags = 'gi') => new RegExp(`(?<![A-Za-z0-9_])${escapeRe(s)}(?![A-Za-z0-9_])`, flags);

// A matcher is { kind, all(text) -> [{ shown, index }] }: every hit in
// `text`, with the text a hit shows and where it starts; of hits that
// overlap, the one starting first (the longest, at the same start) stands.
function allOf(res, show = (m) => m[0]) {
  return (text) => {
    const found = res.flatMap((re, k) => [...text.matchAll(re)].map((m) => ({ shown: show(m, k), index: m.index, end: m.index + m[0].length })));
    found.sort((a, b) => a.index - b.index || b.end - a.end);
    const kept = [];
    for (const f of found) if (!kept.length || f.index >= kept[kept.length - 1].end) kept.push(f);
    return kept.map(({ shown, index }) => ({ shown, index }));
  };
}
const fromPairs = (pairs) => pairs.map(([kind, re]) => ({ kind, all: allOf([globalRe(re)]) }));
// The consumer class: whole word, without regard to case; a hit shows the
// term's position in the list, never the term.
function consumerMatchers(terms) {
  if (!terms.length) return [];
  return [{ kind: CONSUMER_KIND, all: allOf(terms.map((t) => wholeWord(t)), (m, k) => `term ${k + 1} of ${terms.length}`) }];
}
// AC-20501-3's matchers: the names (the floor and the chain's own), then
// the other development-chain kinds.
function chainMatchers(names) {
  return [{ kind: NAME_KIND, all: allOf([FLOOR, ...names.map((n) => wholeWord(n))]) }, ...fromPairs(CHAIN.slice(1))];
}
// Every hit of `text` (file `rel`) against `matchers`: one per line and
// kind from the line-by-line read, then every hit of the text with its
// newlines folded to spaces that the line read did not show (by file,
// kind and shown text), so a hit wrapped across two lines is caught.
function scanText(rel, text, matchers) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const { kind, all } of matchers) {
      const [first] = all(line);
      if (first) hits.push({ rel, line: i + 1, kind, shown: first.shown });
    }
  });
  const seen = new Set(hits.map((h) => `${h.kind}\u0000${h.shown}`));
  const folded = text.replace(/\n/g, ' ');
  for (const { kind, all } of matchers) {
    for (const { shown, index } of all(folded)) {
      const key = `${kind}\u0000${shown}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ rel, line: text.slice(0, index).split('\n').length, kind, shown, folded: true });
    }
  }
  return hits;
}
// Every hit of each packed path against `matchers`.
function scanPaths(files, matchers) {
  return files.flatMap((rel) => matchers.flatMap(({ kind, all }) => all(rel).slice(0, 1).map(({ shown }) => ({ rel, line: 0, kind, shown }))));
}
const hitLine = (h) => (h.line === 0 ? `${h.rel}: path: ${h.kind}: "${h.shown}"` : `${h.rel}:${h.line}: ${h.kind}: "${h.shown}"${h.folded ? ' (folded read)' : ''}`);
function perFile(hits) {
  const byFile = new Map();
  for (const h of hits) byFile.set(h.rel, (byFile.get(h.rel) ?? 0) + 1);
  return { byFile, summary: [...byFile].map(([f, n]) => `${f} (${n})`).join('\n') };
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

// The real tarball, packed and unpacked once per file run and read by
// both scans: { root, files } with files exactly the ones npm pack lists.
let packedOnce = null;
function packedTarball() {
  packedOnce ??= (async () => {
    const out = scratch(undefined, 'rcf-h-pack-scan-');
    const packed = await npm(['pack', '--json', '--pack-destination', out], { cwd: PACKAGE_ROOT });
    assert.equal(packed.code, 0, show(packed));
    const [entry] = packJson(packed.stdout);
    const tgz = join(out, entry.filename);
    const unpacked = join(out, 'unpacked');
    mkdirSync(unpacked);
    const tar = await sh('tar', ['-xzf', tgz, '-C', unpacked], { cwd: out });
    assert.equal(tar.code, 0, show(tar));
    const root = join(unpacked, 'package');
    const files = walk(root).map((f) => f.slice(root.length + 1).split('\\').join('/')).sort();
    assert.deepEqual(files, entry.files.map((f) => f.path).sort(), 'the scan reads exactly the files npm pack lists');
    assert.ok(files.includes('bin/rcf.js') && files.some((f) => f.startsWith('guidance/')), 'the tarball is the real package');
    return { root, files };
  })();
  return packedOnce;
}
// Every hit of every packed file's contents, then of every packed path.
function scanPack({ root, files }, matchers) {
  return [...files.flatMap((rel) => scanText(rel, readFileSync(join(root, rel), 'utf8'), matchers)), ...scanPaths(files, matchers)];
}

test('AC-20501-3: no file in the tarball npm pack produces carries development-chain material: no named reviewer, stage-keeper or operator; no relay, work-item, dispatch or lane job id; no verdict record; no quoted or cited development ruling', { timeout: 300_000 }, async () => {
  const names = await chainNames();
  const found = scanPack(await packedTarball(), chainMatchers(names));
  const hits = found.map(hitLine);
  const { byFile, summary } = perFile(found);
  const discovery = hits.filter((h) => h.startsWith('guidance/discovery/'));
  assert.deepEqual(discovery, [], `guidance/discovery/ carries no development-chain material (${discovery.length} lines)`);
  assert.deepEqual(hits.slice(0, 40), [], `no packed file carries development-chain material: ${hits.length} lines in ${byFile.size} files\n${summary}`);
});

test('AC-20501-4: no file in the tarball npm pack produces carries a developer home directory, an internal specification or estate path, or a consumer project, team or developer handle', { timeout: 300_000 }, async (t) => {
  const terms = forbiddenTerms();
  // The consumer class: checked when the list is set, refused where it is
  // expected and missing, reported as skipped (never as passed) elsewhere.
  await t.test(CONSUMER_TEST, { timeout: 300_000 }, async (st) => {
    if (!terms.length) {
      assert.ok(!termsExpected(), CONSUMER_REFUSED);
      noteConsumerSkip();
      st.skip(CONSUMER_SKIPPED);
      return;
    }
    const hits = scanPack(await packedTarball(), consumerMatchers(terms));
    const { byFile, summary } = perFile(hits);
    assert.deepEqual(hits.slice(0, 40).map(hitLine), [], `no packed file carries a consumer name: ${hits.length} lines in ${byFile.size} files\n${summary}`);
  });
  const hits = scanPack(await packedTarball(), fromPairs(PRIVATE));
  const { byFile, summary } = perFile(hits);
  assert.deepEqual(hits.slice(0, 40).map(hitLine), [], `no packed file carries a developer home directory or an internal specification or estate path: ${hits.length} lines in ${byFile.size} files\n${summary}`);
});

// The workflow files under .github/workflows/, read without a YAML
// dependency: every step of every job as { file, line, run, env }, where
// run is the step's run text (inline or a block scalar) and env its env
// mapping (values unquoted).
const WORKFLOWS = join(PACKAGE_ROOT, '..', '..', '.github', 'workflows');
const indentOf = (l) => l.length - l.trimStart().length;
const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
function stepOf(file, line, body, ki) {
  const step = { file, line, run: '', env: {} };
  for (let i = 0; i < body.length; i++) {
    const l = body[i];
    if (!l.trim() || l.trim().startsWith('#') || indentOf(l) !== ki) continue;
    const m = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(l);
    if (!m) continue;
    const nested = [];
    for (let j = i + 1; j < body.length && (!body[j].trim() || indentOf(body[j]) > ki); j++) nested.push(body[j]);
    if (m[1] === 'run') step.run = /^[|>][-+]?$/.test(m[2].trim()) ? nested.map((x) => x.trim()).join('\n') : unquote(m[2]);
    if (m[1] === 'env') {
      for (const x of nested) {
        const e = /^\s*([A-Za-z0-9_]+):\s*(.*)$/.exec(x);
        if (e) step.env[e[1]] = unquote(e[2]);
      }
    }
  }
  return step;
}
function workflowSteps(file) {
  const ls = readFileSync(join(WORKFLOWS, file), 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const s = /^(\s*)steps:\s*$/.exec(ls[i]);
    if (!s) continue;
    const base = s[1].length;
    let j = i + 1;
    while (j < ls.length && (!ls[j].trim() || indentOf(ls[j]) > base)) {
      const d = /^(\s*)- /.exec(ls[j]);
      if (!d) { j++; continue; }
      const di = d[1].length;
      const body = [`${' '.repeat(di + 2)}${ls[j].slice(di + 2)}`];
      let k = j + 1;
      for (; k < ls.length && (!ls[k].trim() || indentOf(ls[k]) > di); k++) body.push(ls[k]);
      out.push(stepOf(file, j + 1, body, di + 2));
      j = k;
    }
  }
  return out;
}
// A step whose run text executes the package test suite.
const runsSuite = (step) => /(?:^|[\s;&|])(?:pnpm(?:\s+-r|\s+--recursive)?\s+(?:run\s+)?test|npm\s+(?:run\s+)?test|node\s+--test)\b/m.test(step.run);
function suiteSteps() {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();
  const steps = files.flatMap(workflowSteps);
  return { files, steps, suite: steps.filter(runsSuite) };
}
const at = (s) => `.github/workflows/${s.file}:${s.line}`;
const noSpace = (v) => String(v ?? '').replace(/\s+/g, '');

test('AC-20501-4 workflows: every workflow step that runs the package test suite maps RCF_PRIVACY_FORBIDDEN_TERMS from the repository secret of the same name', () => {
  const { files, steps, suite } = suiteSteps();
  assert.ok(files.includes('ci.yml') && files.includes('publish.yml'), `given: the workflows include ci.yml and publish.yml\n${files.join('\n')}`);
  assert.ok(steps.length >= 20, `given: the workflow steps are read (${steps.length} steps)`);
  const withSuite = [...new Set(suite.map((s) => s.file))].sort();
  assert.ok(withSuite.includes('ci.yml') && withSuite.includes('publish.yml'), `given: ci.yml and publish.yml each run the package suite\n${suite.map(at).join('\n')}`);
  const missing = suite.filter((s) => noSpace(s.env[TERMS_VAR]) !== `\${{secrets.${TERMS_VAR}}}`).map((s) => `${at(s)}: ${s.run.split('\n')[0]} (env ${TERMS_VAR}: ${s.env[TERMS_VAR] ?? 'none'})`);
  assert.deepEqual(missing, [], `every step that runs the suite maps ${TERMS_VAR} from secrets.${TERMS_VAR} (${missing.length} do not)`);
});

// AC-20501-5: what the scan cannot read as plain text. A file whose bytes
// do not decode as UTF-8, a file holding a NUL, or a line holding a hex
// run, or a base64 run (digits and letters of both cases), of 64 or more
// characters, is unscanned and named, unless its path is on the
// allow-list the maintainers record in the chain's decisions ledger (a
// resolved decision whose question starts with ALLOW_MARK, answered a,
// each allowed path backticked in the question).
const ALLOW_MARK = 'PACK PRIVACY ALLOW-LIST';
const ENCODED = [
  ['a hex run', /[0-9A-Fa-f]{64,}/g, () => true],
  ['a base64 run', /[A-Za-z0-9+/]{64,}={0,2}/g, (s) => /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s)],
];
const UTF8 = new TextDecoder('utf-8', { fatal: true });
// Why the scan cannot read `buf` as plain text, or null.
function unreadable(buf) {
  let text;
  try { text = UTF8.decode(buf); } catch { return 'bytes that are not UTF-8 text'; }
  if (text.includes('\u0000')) return 'a NUL byte';
  const ls = text.split('\n');
  for (let i = 0; i < ls.length; i++) {
    for (const [what, re, counts] of ENCODED) {
      const m = [...ls[i].matchAll(re)].find((x) => counts(x[0]));
      if (m) return `line ${i + 1}: ${what} of ${m[0].length} characters`;
    }
  }
  return null;
}
async function allowList() {
  const r = await rcf(['define', 'ledger', 'decisions', 'list', '--json'], { cwd: PACKAGE_ROOT });
  assert.equal(r.code, 0, `rcf define ledger decisions list --json exits 0\n${r.stderr}`);
  const entries = JSON.parse(r.stdout).decisions ?? [];
  const allowed = entries.filter((d) => String(d.question ?? '').startsWith(ALLOW_MARK) && d.status === 'resolved' && /^a\b/.test(String(d.answer ?? '')));
  return new Set(allowed.flatMap((d) => [...String(d.question).matchAll(/`([^`]+)`/g)].map((m) => m[1])));
}

test('AC-20501-5: every file in the tarball npm pack produces reads as plain text to the privacy scan, or is named as unscanned unless its path is on the decisions-ledger allow-list', { timeout: 300_000 }, async () => {
  const allow = await allowList();
  const { root, files } = await packedTarball();
  const unscanned = files.filter((rel) => !allow.has(rel)).map((rel) => ({ rel, why: unreadable(readFileSync(join(root, rel))) })).filter((u) => u.why);
  assert.deepEqual(unscanned.slice(0, 40).map((u) => `${u.rel}: unscanned: ${u.why}`), [], `every packed file reads as plain text or is allow-listed: ${unscanned.length} unscanned`);
});

// AC-20501-6: the check itself, run through node --test on this file with
// the environment of each kind of run, AC-20501-4 and its consumer class
// only; then the workflow steps that run the suite declare where the
// list is expected.
async function consumerRun(extraEnv) {
  const self = join(PACKAGE_ROOT, 'test', 'pkg', 'pack-privacy-0-41-0.test.js');
  const r = await sh(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^AC-20501-4(?::| consumer-name class)', self], { cwd: PACKAGE_ROOT, timeout: 600_000, extraEnv });
  const out = `${r.stdout}\n${r.stderr}`;
  const line = out.split('\n').find((l) => new RegExp(`^\\s*(?:not )?ok \\d+ - ${CONSUMER_TEST}\\b`).test(l)) ?? null;
  return { ...r, out, line };
}

test('AC-20501-6: where the consumer list is expected (the workflow steps that run the suite declare RCF_PRIVACY_TERMS_EXPECTED), an empty list fails the privacy check by name; where it is not expected, the consumer class is reported as skipped with one printed line, never as passed', { timeout: 900_000 }, async () => {
  const expected = await consumerRun({ [TERMS_VAR]: '', [EXPECTED_VAR]: 'true' });
  assert.notEqual(expected.code, 0, `where the list is expected and empty, the check exits non-zero\n${expected.out.slice(-3000)}`);
  assert.ok(expected.line && /^\s*not ok\b/.test(expected.line), `where the list is expected and empty, the consumer class fails\n${expected.line}\n${expected.out.slice(-3000)}`);
  assert.ok(expected.out.includes('no forbidden terms configured'), `the failure names the missing list\n${expected.out.slice(-3000)}`);

  const local = await consumerRun({ [TERMS_VAR]: '', [EXPECTED_VAR]: '' });
  assert.ok(local.line && /^\s*ok \d+ - .*# SKIP\b/.test(local.line), `where the list is not expected, the consumer class is reported as skipped, never as passed\n${local.line}\n${local.out.slice(-3000)}`);
  const printed = local.out.split('\n').filter((l) => l.includes(CONSUMER_SKIPPED) && !/# SKIP\b/.test(l));
  assert.equal(printed.length, 1, `one printed line names the class as skipped\n${printed.join('\n')}\n${local.out.slice(-3000)}`);

  const { suite } = suiteSteps();
  assert.ok(suite.length >= 2, `given: the workflow steps that run the suite are read (${suite.length})`);
  const undeclared = suite.filter((s) => !/^\$\{\{[\s\S]*\bgithub\.[\s\S]*\}\}$/.test(String(s.env[EXPECTED_VAR] ?? '').trim())).map((s) => `${at(s)}: env ${EXPECTED_VAR}: ${s.env[EXPECTED_VAR] ?? 'none'}`);
  assert.deepEqual(undeclared, [], `every step that runs the suite declares where the list is expected with ${EXPECTED_VAR} computed from the run's github context (${undeclared.length} do not)`);
});

// The scan itself, on fixtures: each canary in test/pkg/fixtures/pack-privacy/
// plants lines of one kind and each is caught by exactly that kind; the
// near-miss file is caught by none. A fixture is a template: the shapes
// this file forbids are filled in at run time, so the public tree never
// carries one, and the consumer canary plants each term the environment
// supplies, so no term is ever written down.
const FIXTURES = join(PACKAGE_ROOT, 'test', 'pkg', 'fixtures', 'pack-privacy');
const CANARIES = [
  ['ruling.txt', 'a quoted or cited development ruling'],
  ['estate-path.txt', 'an internal specification or estate path'],
  ['home-directory.txt', 'a developer home directory'],
  ['consumer-name.txt', CONSUMER_KIND],
];
// The planted lines of one template, filled: a line holding {{term}} or
// {{inword}} is repeated once per term, and dropped when there is none.
function planted(file, terms) {
  const out = [];
  for (const line of readFileSync(join(FIXTURES, file), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const base = line.replaceAll('{{users}}', '/Users').replaceAll('{{home}}', '/home').replaceAll('{{projects}}', 'projects');
    if (/\{\{(?:term|inword)\}\}/.test(base)) {
      for (const term of terms) out.push(base.replaceAll('{{term}}', term).replaceAll('{{inword}}', `x${term}x`));
    } else out.push(base);
  }
  return out;
}

test('pack-privacy scan canaries: every planted line of test/pkg/fixtures/pack-privacy/ is caught by exactly its own kind', async () => {
  const terms = forbiddenTerms();
  if (!terms.length) {
    assert.ok(!termsExpected(), CONSUMER_REFUSED);
    noteConsumerSkip();
  }
  const names = await chainNames();
  const all = [...chainMatchers(names), ...fromPairs(PRIVATE), ...consumerMatchers(terms)];

  // The chain's own names, in any case, whole-word only.
  assert.ok(names.length >= 1, `given: the repository's history records at least one name (${names.length})`);
  for (const name of names) {
    for (const l of [`Reviewed by ${name.toUpperCase()}.`, `reviewed by ${name.toLowerCase()}.`]) {
      assert.deepEqual(scanText('names', l, all).map((h) => h.kind), [NAME_KIND], `a recorded name in another case is caught as ${NAME_KIND}`);
    }
    assert.deepEqual(scanText('names', `x${name}x`, all).filter((h) => h.kind === NAME_KIND), [], 'a recorded name inside a longer word is not caught');
  }
  // A citation wrapped across two lines: missed line by line, caught by the folded read.
  const wrapped = readFileSync(join(FIXTURES, 'ruling-wrapped.txt'), 'utf8');
  const lineOnly = wrapped.split('\n').flatMap((l) => fromPairs(CHAIN).filter(({ all: a }) => a(l).length).map((m) => m.kind));
  assert.deepEqual(lineOnly, [], 'given: no single line of ruling-wrapped.txt is a citation');
  assert.deepEqual(scanText('ruling-wrapped.txt', wrapped, all).map((h) => `${h.kind}:${h.line}`), ['a quoted or cited development ruling:1'], 'the wrapped citation is caught once, by the folded read, at its first line');
  // A packed path is scanned like a line.
  assert.deepEqual(scanPaths(['fixtures/agents/Some_Agent/notes/plan.md', 'bin/rcf.js'], all).map((h) => `${h.rel}:${h.kind}`), ['fixtures/agents/Some_Agent/notes/plan.md:an internal specification or estate path'], 'a packed path is scanned with the same matchers');
  // What the scan cannot read: bytes that are not UTF-8, a NUL, a 64-character hex or base64 run.
  const hex = 'ab'.repeat(32);
  const b64 = Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 37 + 11) % 256)).toString('base64');
  assert.match(unreadable(Buffer.from([0x61, 0xff, 0xfe, 0x62])), /not UTF-8/, 'bytes that are not UTF-8 are unscanned');
  assert.match(unreadable(Buffer.from('a\u0000b')), /NUL/, 'a NUL byte is unscanned');
  assert.match(unreadable(Buffer.from(`digest ${hex}\n`)), /line 1: a hex run of 64/, 'a 64-character hex run is unscanned');
  assert.match(unreadable(Buffer.from(`one\nblob ${b64}\n`)), /line 2: a base64 run of 80/, 'an 80-character base64 run is unscanned');
  assert.equal(unreadable(Buffer.from(`digest ${hex.slice(1)}\nenum kubernetes/loadBalancer/uptimeMonitor/systemd/dockerHealthcheck/reverseProxy/custom\n`)), null, 'a 63-character hex run and a long slash-separated word list read as text');
  let count = 0;
  for (const [file, kind] of CANARIES) {
    const ls = planted(file, terms);
    if (file === 'consumer-name.txt') {
      assert.equal(ls.length, terms.length, `${file} plants one line per term`);
      for (const [k, l] of ls.entries()) {
        const kinds = scanText(file, l, all).map((h) => h.kind);
        assert.ok(kinds.includes(kind), `${file}: the line planting term ${k + 1} of ${terms.length} is caught as ${kind}`);
        assert.deepEqual(kinds.filter((x) => fromPairs(PRIVATE).some((p) => p.kind === x)), [], `${file}: the line planting term ${k + 1} is caught by no generic shape`);
      }
    } else {
      assert.ok(ls.length >= 2, `${file} plants at least two lines`);
      for (const l of ls) assert.deepEqual(scanText(file, l, all).map((h) => h.kind), [kind], `${file}: "${l}" is caught by exactly ${kind}`);
    }
    count += ls.length;
  }
  assert.ok(count >= 6, `the canaries plant ${count} lines`);
});

test('pack-privacy scan near-misses: no line of test/pkg/fixtures/pack-privacy/near-misses.txt is caught by any kind', async () => {
  const terms = forbiddenTerms();
  if (!terms.length) noteConsumerSkip();
  const all = [...chainMatchers(await chainNames()), ...fromPairs(PRIVATE), ...consumerMatchers(terms)];
  const ls = planted('near-misses.txt', terms);
  assert.ok(ls.length >= 6, `near-misses.txt holds ${ls.length} lines`);
  const hits = ls.flatMap((l) => scanText('near-misses.txt', l, all)).map(hitLine);
  assert.deepEqual(hits, [], 'no near-miss is caught');
  const folded = scanText('near-misses.txt', ls.join('\n'), all).map(hitLine);
  assert.deepEqual(folded, [], 'no near-miss is caught by the folded read of the whole file');
});
