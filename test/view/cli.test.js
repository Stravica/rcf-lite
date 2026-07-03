// CLI test for `rcf view` under the unified `bin/rcf.js`. Phase 4 §D23
// deletes the standalone `bin/rcf-view.js`; the server behaviour lives
// behind `rcf view`. Pure helpers now live in `src/cli/view.js`; the
// subprocess tests drive them via `bin/rcf.js view`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

import { initProject } from '../../src/store/init.js';
import {
  maybeAutoOpen,
  openerFor,
  parseArgs,
  resolvePort,
} from '../../src/cli/view.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf.js');

async function runBin(cwd, args = [], env = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'view', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function freePort() {
  return await new Promise((resolveP, rejectP) => {
    const s = createServer();
    s.on('error', rejectP);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolveP(port));
    });
  });
}

async function spawnServer(cwd, args = [], env = {}) {
  const child = spawn(process.execPath, [bin, 'view', ...args], {
    cwd,
    env: { ...process.env, ...env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (buf) => { stdout += buf.toString(); });
  child.stderr.on('data', (buf) => { stderr += buf.toString(); });

  async function waitForListening(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (/listening at http:\/\/[\d.]+:(\d+)\//.test(stdout)) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`server did not become ready. stdout=${stdout} stderr=${stderr}`);
  }

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    waitForListening,
    async shutdown(signal = 'SIGINT', timeoutMs = 3000) {
      if (child.exitCode != null || child.signalCode) return;
      const exited = new Promise((resolveExit) => {
        child.once('exit', (code, sig) => resolveExit({ code, sig }));
      });
      child.kill(signal);
      const timer = new Promise((resolveExit) => setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolveExit({ code: null, sig: 'SIGKILL' });
      }, timeoutMs));
      return await Promise.race([exited, timer]);
    },
  };
}

test('rcf view --help exits 0 in any directory', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-help-'));
  const { code, stdout } = await runBin(tmp, ['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf view/);
  assert.match(stdout, /--port/);
  assert.match(stdout, /--strict/);
  assert.match(stdout, /--no-open/);
  assert.match(stdout, /Exit codes/);
});

test('rcf view --help documents the localhost-only trust posture', async () => {
  const { stdout } = await runBin(process.cwd(), ['--help']);
  assert.match(stdout, /127\.0\.0\.1/);
  assert.match(stdout, /no auth/i);
});

test('rcf view --help documents Ctrl-C shutdown', async () => {
  const { stdout } = await runBin(process.cwd(), ['--help']);
  assert.match(stdout, /Ctrl-C|SIGINT/);
  assert.match(stdout, /Shutdown/);
});

test('rcf view in a directory with no project exits 2 (usage)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-noproject-'));
  const { code, stderr } = await runBin(tmp);
  assert.equal(code, 2);
  assert.match(stderr, /no project root found/);
});

test('rcf view --unknown-flag exits 2 (usage)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-bad-flag-'));
  const { code, stderr } = await runBin(tmp, ['--whatever']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown option/);
});

test('rcf view --port without a value exits 2', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-port-noval-'));
  await initProject({ projectRoot: tmp });
  const { code, stderr } = await runBin(tmp, ['--port']);
  assert.equal(code, 2);
  assert.match(stderr, /--port requires/);
});

test('rcf view on a broken tree without --strict starts the server anyway', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-broken-'));
  await initProject({ projectRoot: tmp });
  const reqPath = join(tmp, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const port = await freePort();
  const server = await spawnServer(tmp, ['--port', String(port), '--no-open']);
  try {
    await server.waitForListening();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /PRD-999/);
  } finally {
    await server.shutdown();
  }
});

test('rcf view --strict on a broken tree exits 3 and never binds a listener', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-strict-broken-'));
  await initProject({ projectRoot: tmp });
  const reqPath = join(tmp, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const port = await freePort();
  const { code, stderr } = await runBin(tmp, ['--strict', '--port', String(port), '--no-open']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
  // Port must be free after --strict rejection.
  const check = createServer().listen(port, '127.0.0.1');
  await new Promise((r) => check.once('listening', r));
  await new Promise((r) => check.close(r));
});

test('rcf view --strict on a clean tree starts the listener normally', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-strict-clean-'));
  await initProject({ projectRoot: tmp });
  const port = await freePort();
  const server = await spawnServer(tmp, ['--strict', '--port', String(port), '--no-open']);
  try {
    await server.waitForListening();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
  } finally {
    await server.shutdown();
  }
});

test('rcf view --port respects the flag', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-portflag-'));
  await initProject({ projectRoot: tmp });
  const port = await freePort();
  const server = await spawnServer(tmp, ['--port', String(port), '--no-open']);
  try {
    await server.waitForListening();
    const stdout = server.getStdout();
    assert.match(stdout, new RegExp(`listening at http://127\\.0\\.0\\.1:${port}/`));
  } finally {
    await server.shutdown();
  }
});

test('rcf view RCF_VIEW_PORT env var respected; --port beats env', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-portenv-'));
  await initProject({ projectRoot: tmp });
  const envPort = await freePort();
  const flagPort = await freePort();
  assert.notEqual(envPort, flagPort);
  const server = await spawnServer(
    tmp,
    ['--port', String(flagPort), '--no-open'],
    { RCF_VIEW_PORT: String(envPort) },
  );
  try {
    await server.waitForListening();
    const stdout = server.getStdout();
    assert.match(stdout, new RegExp(`listening at http://127\\.0\\.0\\.1:${flagPort}/`));
    assert.doesNotMatch(stdout, new RegExp(`listening at http://127\\.0\\.0\\.1:${envPort}/`));
  } finally {
    await server.shutdown();
  }
});

test('rcf view RCF_VIEW_PORT env used when --port is absent', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-env-only-'));
  await initProject({ projectRoot: tmp });
  const port = await freePort();
  const server = await spawnServer(tmp, ['--no-open'], { RCF_VIEW_PORT: String(port) });
  try {
    await server.waitForListening();
    const stdout = server.getStdout();
    assert.match(stdout, new RegExp(`listening at http://127\\.0\\.0\\.1:${port}/`));
  } finally {
    await server.shutdown();
  }
});

test('rcf view EADDRINUSE on the requested port exits 2 with a clear error', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-eaddrinuse-'));
  await initProject({ projectRoot: tmp });
  const busy = createServer();
  await new Promise((r, j) => { busy.once('error', j); busy.listen(0, '127.0.0.1', r); });
  const port = busy.address().port;
  try {
    const { code, stderr } = await runBin(tmp, ['--port', String(port), '--no-open']);
    assert.equal(code, 2);
    assert.match(stderr, new RegExp(`port ${port} is in use`));
  } finally {
    await new Promise((r) => busy.close(r));
  }
});

test('rcf view never writes any files to disk (regression against static mode)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-nofs-'));
  await initProject({ projectRoot: tmp });
  const port = await freePort();
  const server = await spawnServer(tmp, ['--port', String(port), '--no-open']);
  try {
    await server.waitForListening();
    await fetch(`http://127.0.0.1:${port}/`);
  } finally {
    await server.shutdown();
  }
  await assert.rejects(stat(join(tmp, '.rcf-view')), { code: 'ENOENT' });
});

test('rcf view SIGINT triggers a clean shutdown within the 2s budget', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-sigint-'));
  await initProject({ projectRoot: tmp });
  const port = await freePort();
  const server = await spawnServer(tmp, ['--port', String(port), '--no-open']);
  await server.waitForListening();
  const start = Date.now();
  const result = await server.shutdown('SIGINT');
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, `shutdown took ${elapsed}ms`);
  assert.equal(result.code, 130);
  // Port must be free again.
  const check = createServer().listen(port, '127.0.0.1');
  await new Promise((r) => check.once('listening', r));
  await new Promise((r) => check.close(r));
});

test('rcf view runs from a subdirectory and walks upward to the project root', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-sub-'));
  await initProject({ projectRoot: tmp });
  const subDir = join(tmp, 'rcf', 'requirements');
  const port = await freePort();
  const server = await spawnServer(subDir, ['--port', String(port), '--no-open']);
  try {
    await server.waitForListening();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
  } finally {
    await server.shutdown();
  }
});

// ---- pure function tests -------------------------------------------------

test('parseArgs recognises --no-open', () => {
  const { opts, errors } = parseArgs(['--no-open']);
  assert.equal(errors.length, 0);
  assert.equal(opts.noOpen, true);
});

test('parseArgs defaults --no-open and --port to their absent values', () => {
  const { opts } = parseArgs([]);
  assert.equal(opts.noOpen, false);
  assert.equal(opts.port, null);
});

test('parseArgs parses --port <n>', () => {
  const { opts, errors } = parseArgs(['--port', '5555']);
  assert.equal(errors.length, 0);
  assert.equal(opts.port, 5555);
});

test('parseArgs rejects a non-integer --port value', () => {
  const { errors } = parseArgs(['--port', 'abc']);
  assert.ok(errors.some((e) => /--port expects an integer/.test(e)));
});

test('parseArgs rejects --port with no following value', () => {
  const { errors } = parseArgs(['--port']);
  assert.ok(errors.some((e) => /--port requires/.test(e)));
});

test('resolvePort: --port beats env beats default', () => {
  assert.deepEqual(resolvePort(1234, { RCF_VIEW_PORT: '5678' }).port, 1234);
  assert.deepEqual(resolvePort(null, { RCF_VIEW_PORT: '5678' }).port, 5678);
  assert.deepEqual(resolvePort(null, {}).port, 4373);
});

test('resolvePort rejects an invalid RCF_VIEW_PORT env value', () => {
  const { port, errors } = resolvePort(null, { RCF_VIEW_PORT: 'nope' });
  assert.ok(errors.length > 0);
  assert.equal(port, 4373);
});

test('openerFor returns the platform-specific opener', () => {
  assert.deepEqual(openerFor('darwin', 'http://x/'), { command: 'open', args: ['http://x/'] });
  assert.deepEqual(openerFor('linux', 'http://x/'), { command: 'xdg-open', args: ['http://x/'] });
  assert.deepEqual(openerFor('win32', 'http://x/'), { command: 'start', args: ['""', 'http://x/'] });
  assert.equal(openerFor('aix', 'http://x/'), null);
});

test('maybeAutoOpen spawns the opener on a TTY when CI is unset and --no-open is off', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  };
  const stderr = { write() {} };
  const stream = { isTTY: true };
  const ran = maybeAutoOpen({
    target: 'http://127.0.0.1:4373/',
    noOpen: false,
    stream,
    env: {},
    stderr,
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'open');
  assert.deepEqual(calls[0].args, ['http://127.0.0.1:4373/']);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
});

test('maybeAutoOpen suppresses spawn when --no-open is set', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const ran = maybeAutoOpen({
    target: 'http://127.0.0.1:4373/',
    noOpen: true,
    stream: { isTTY: true },
    env: {},
    stderr: { write() {} },
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(calls.length, 0);
});

test('maybeAutoOpen suppresses spawn when CI env var is set', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const ran = maybeAutoOpen({
    target: 'http://127.0.0.1:4373/',
    noOpen: false,
    stream: { isTTY: true },
    env: { CI: '1' },
    stderr: { write() {} },
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(calls.length, 0);
});

test('maybeAutoOpen suppresses spawn when stdout is not a TTY', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const ran = maybeAutoOpen({
    target: 'http://127.0.0.1:4373/',
    noOpen: false,
    stream: { isTTY: false },
    env: {},
    stderr: { write() {} },
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(calls.length, 0);
});

test('maybeAutoOpen writes a warning and does not throw when spawn fails', () => {
  const warnings = [];
  const stderr = { write(line) { warnings.push(line); } };
  const spawnFn = () => { throw new Error('boom'); };
  const ran = maybeAutoOpen({
    target: 'http://127.0.0.1:4373/',
    noOpen: false,
    stream: { isTTY: true },
    env: {},
    stderr,
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[warn\] auto-open: boom/);
});
