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
// separated, one whole-word, case-sensitive term per line), which CI
// fills from the repository secret of the same name. With it unset or
// empty the consumer-name class prints one line saying so and the other
// classes still run. A hit on that class prints the term's position in
// the list, never the term.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PACKAGE_ROOT, baseEnv } from '../_harness/spawn.js';
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

// AC-20501-4's generic shapes. An estate path is a project's
// specification, docs, wireframes or notes folder, or a maintainer's
// agent workspace folder; a home directory needs a user segment with no
// space and a further segment, so "/Users/john doe/work", "~/.cache" and
// a bare "no /Users/" do not match.
const PRIVATE = [
  ['an internal specification or estate path', /\bprojects\/[a-z0-9-]+\/(?:specs?|docs|wireframes|notes)\/|\bagents\/[a-z0-9-]+\/(?:notes|staging|work|journal|briefs|roles|templates|operating-notes)\//],
  ['a developer home directory', /(?:^|[^A-Za-z0-9_.\/-])(?:\/Users|\/home)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]/],
];
const CONSUMER_KIND = 'a consumer project, team or developer handle';
const TERMS_VAR = 'RCF_PRIVACY_FORBIDDEN_TERMS';
const CONSUMER_SKIPPED = `consumer-name class skipped: ${TERMS_VAR} not set`;

// The consumer, team and handle terms: one per line, blank lines ignored.
function forbiddenTerms(env = process.env) {
  return String(env[TERMS_VAR] ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}
let skipNoted = false;
function noteConsumerSkip() {
  if (skipNoted) return;
  skipNoted = true;
  console.log(CONSUMER_SKIPPED);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A matcher is { kind, match(line) -> the text a hit shows, or null }.
const fromPairs = (pairs) => pairs.map(([kind, re]) => ({ kind, match: (line) => re.exec(line)?.[0] ?? null }));
// The consumer class: whole word, case-sensitive; a hit shows the term's
// position in the list, never the term.
function consumerMatchers(terms) {
  if (!terms.length) return [];
  const res = terms.map((term) => new RegExp(`(?<![A-Za-z0-9_])${escapeRe(term)}(?![A-Za-z0-9_])`));
  return [{ kind: CONSUMER_KIND, match: (line) => { const k = res.findIndex((re) => re.test(line)); return k < 0 ? null : `term ${k + 1} of ${terms.length}`; } }];
}
// Every hit of `text` (file `rel`) against `matchers`, one per line and kind.
function scanText(rel, text, matchers) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const { kind, match } of matchers) {
      const shown = match(line);
      if (shown !== null) hits.push({ rel, line: i + 1, kind, shown });
    }
  });
  return hits;
}
const hitLine = (h) => `${h.rel}:${h.line}: ${h.kind}: "${h.shown}"`;
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
function scanPack({ root, files }, matchers) {
  return files.flatMap((rel) => scanText(rel, readFileSync(join(root, rel), 'utf8'), matchers));
}

test('AC-20501-3: no file in the tarball npm pack produces carries development-chain material: no named reviewer, stage-keeper or operator; no relay, work-item, dispatch or lane job id; no verdict record; no quoted or cited development ruling', { timeout: 300_000 }, async () => {
  const found = scanPack(await packedTarball(), fromPairs(CHAIN));
  const hits = found.map(hitLine);
  const { byFile, summary } = perFile(found);
  const discovery = hits.filter((h) => h.startsWith('guidance/discovery/'));
  assert.deepEqual(discovery, [], `guidance/discovery/ carries no development-chain material (${discovery.length} lines)`);
  assert.deepEqual(hits.slice(0, 40), [], `no packed file carries development-chain material: ${hits.length} lines in ${byFile.size} files\n${summary}`);
});

test('AC-20501-4: no file in the tarball npm pack produces carries a developer home directory, an internal specification or estate path, or a consumer project, team or developer handle', { timeout: 300_000 }, async () => {
  const terms = forbiddenTerms();
  if (!terms.length) noteConsumerSkip();
  const hits = scanPack(await packedTarball(), [...fromPairs(PRIVATE), ...consumerMatchers(terms)]);
  const { byFile, summary } = perFile(hits);
  assert.deepEqual(hits.slice(0, 40).map(hitLine), [], `no packed file carries a developer home directory, an internal specification or estate path, or a consumer name: ${hits.length} lines in ${byFile.size} files\n${summary}`);
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

test('pack-privacy scan canaries: every planted line of test/pkg/fixtures/pack-privacy/ is caught by exactly its own kind', () => {
  const terms = forbiddenTerms();
  if (!terms.length) noteConsumerSkip();
  const all = [...fromPairs(CHAIN), ...fromPairs(PRIVATE), ...consumerMatchers(terms)];
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

test('pack-privacy scan near-misses: no line of test/pkg/fixtures/pack-privacy/near-misses.txt is caught by any kind', () => {
  const terms = forbiddenTerms();
  if (!terms.length) noteConsumerSkip();
  const all = [...fromPairs(CHAIN), ...fromPairs(PRIVATE), ...consumerMatchers(terms)];
  const ls = planted('near-misses.txt', terms);
  assert.ok(ls.length >= 6, `near-misses.txt holds ${ls.length} lines`);
  const hits = ls.flatMap((l) => scanText('near-misses.txt', l, all)).map(hitLine);
  assert.deepEqual(hits, [], 'no near-miss is caught');
});
