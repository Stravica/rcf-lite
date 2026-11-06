// FBS-243 (US-20501): the npm package stops shipping its own rcf/ folder
// (Baz decision 11, Dave's ruling R3; contract row C1). The package's rcf/
// holds this repository's own chain: verdicts naming reviewers, the
// rulings ledger. Nothing at runtime reads it.
//
// Criteria: AC-20501-1 (the real npm pack lists nothing under rcf/) and
// AC-20501-2 (the journey: the tarball npm pack writes, installed into a
// fresh empty directory, runs rcf init, rcf doctor, rcf guidance
// build-cycle, the MCP server's resource listing and rcf audit view
// --port <p>, stopped by its own pid, each exit 0 and none reading under
// the installed package's rcf/). The journey runs the installed package's
// own bin with test/fixtures/read-log/hook.mjs preloaded, which logs every
// fs call under node_modules/rcf-lite/rcf/. npm install reaches the
// registry for the package's dependencies (ajv, ajv-formats,
// @stravica-ai/rcf-schemas). Imports: Node builtins and test/_harness/ only.

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
