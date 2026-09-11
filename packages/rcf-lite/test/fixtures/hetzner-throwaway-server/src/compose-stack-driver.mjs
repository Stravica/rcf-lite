// compose-stack-driver.mjs (v1.1.3 real-account driver for the
// platform-docker-compose-host T-2 probes).
//
// Reuses the ssh readiness and cloud-init wait helpers from
// ssh-baseline-check.mjs, installs docker via the vendor convenience
// script, ships the fixture compose bundle to /home/deploy/stack over
// rsync, runs docker compose up -d --wait, and terminates the run
// with an HTTP probe against the caddy :80 endpoint so the run
// carries the "deployed stack URL that answers" 7d evidence shape.
//
// Callers:
// - real-account-minimal-stack-up: bringUpStack() + healthCheck()
// - real-account-reload-burst: bringUpStack() + reloadBurst() +
//   curl-loop assertion against zero drops during the reload window.
//
// The driver never reads a secret; the fixture-shipped
// secrets/web-token is copied by rsync from disk. HCLOUD_TOKEN and the
// ssh key discipline live in provision.mjs and the ssh helpers.

import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  waitForSshReady,
  waitForCloudInit,
  sshExec,
} from './ssh-baseline-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..');
const REMOTE_STACK_DIR = '/home/deploy/stack';
const DEPLOY_USER = 'deploy';

// Files rsync ships to the remote server. Keeps the shipped surface
// literal so a probe cannot accidentally send unrelated fixture files.
const STACK_FILES = [
  'compose.yaml',
  '.env',
  'src/serve.mjs',
  'caddy/Caddyfile',
  'secrets/web-token',
];

export async function bringUpStack(server, opts = {}) {
  const sshKeyPath = opts.sshKeyPath ?? process.env.RCF_LITE_CI_SSH_KEY;
  const target = `${DEPLOY_USER}@${server.primaryIpv4}`;
  const events = [];
  const record = (event, detail) => events.push({ event, at: new Date().toISOString(), detail });

  const readiness = await waitForSshReady(target, sshKeyPath);
  record('sshReady', `attempts=${readiness.attempts} waitedMs=${readiness.waitedMs} ready=${readiness.ready}`);
  if (!readiness.ready) {
    return { ok: false, phase: 'sshReady', readiness, events };
  }
  const cloudInit = await waitForCloudInit(target, sshKeyPath);
  record('cloudInitSettled', `exit=${cloudInit.code} waitedMs=${cloudInit.waitedMs}`);

  const dockerInstall = await installDocker(target, sshKeyPath);
  record('dockerInstalled', `exit=${dockerInstall.code} waitedMs=${dockerInstall.waitedMs} version=${(dockerInstall.version || '').slice(0, 60)}`);
  if (dockerInstall.code !== 0) {
    return { ok: false, phase: 'dockerInstall', dockerInstall, events };
  }

  const shipped = await shipStack(target, sshKeyPath);
  record('stackShipped', `rsyncExit=${shipped.code} files=${STACK_FILES.length}`);
  if (shipped.code !== 0) {
    return { ok: false, phase: 'shipStack', shipped, events };
  }

  const composeUp = await composeCommand(target, sshKeyPath, ['up', '-d', '--wait', '--wait-timeout', '120'], { timeoutSeconds: 180 });
  record('composeUp', `exit=${composeUp.code} durationMs=${composeUp.waitedMs}`);
  if (composeUp.code !== 0) {
    return { ok: false, phase: 'composeUp', composeUp, events };
  }

  const composeStatus = await composeCommand(target, sshKeyPath, ['ps', '--format', 'json'], { timeoutSeconds: 30 });
  const services = parseComposePs(composeStatus.stdout || '');
  record('composePs', `services=${services.length} healthy=${services.filter((s) => s.state === 'running' && (s.health === 'healthy' || s.health === '')).length}`);

  return {
    ok: true, phase: 'stackUp', readiness, cloudInit, dockerInstall,
    services, events, target,
  };
}

// One HTTP request against the caddy :80 endpoint from the local
// runner; returns { ok, statusCode, bodyExcerpt } so the probe can
// record the response body excerpt 7d evidence shape.
export async function httpProbe(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'rcf-lite-t2-probe/1.1.3' } });
    const text = await res.text();
    return {
      ok: res.ok,
      statusCode: res.status,
      headers: {
        server: res.headers.get('server') || null,
        contentType: res.headers.get('content-type') || null,
      },
      bodyExcerpt: text.slice(0, 200),
      requestId: res.headers.get('x-caddy-request-id') || null,
    };
  } catch (err) {
    return { ok: false, statusCode: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Fires N concurrent HTTP requests against the caddy :80 endpoint while
// a caddy reload runs; returns per-request outcomes plus the reload
// exit code. Used by real-account-reload-burst.
export async function reloadBurst(server, url, opts = {}) {
  const total = opts.total ?? 40;
  const concurrency = opts.concurrency ?? 8;
  const sshKeyPath = opts.sshKeyPath ?? process.env.RCF_LITE_CI_SSH_KEY;
  const target = `${DEPLOY_USER}@${server.primaryIpv4}`;

  // Fire the reload asynchronously; the burst runs against caddy
  // while the reload is in flight so we cover the reload window.
  const reloadStarted = Date.now();
  const reloadPromise = composeCommand(target, sshKeyPath, ['exec', '-T', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'], { timeoutSeconds: 30 });

  const requests = [];
  for (let i = 0; i < total; i += 1) requests.push(i);
  const outcomes = [];
  let cursor = 0;
  async function worker() {
    while (cursor < requests.length) {
      const idx = cursor;
      cursor += 1;
      if (idx >= requests.length) return;
      const t0 = Date.now();
      const r = await httpProbe(url, { timeoutMs: 8000 });
      outcomes.push({ idx, elapsedMs: Date.now() - t0, statusCode: r.statusCode, ok: r.ok });
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const reload = await reloadPromise;
  const reloadDurationMs = Date.now() - reloadStarted;

  const twoXx = outcomes.filter((o) => o.statusCode >= 200 && o.statusCode < 300).length;
  const drops = outcomes.filter((o) => !o.ok).length;
  return {
    total, twoXx, drops, reloadDurationMs,
    reloadExit: reload.code,
    reloadStderrExcerpt: (reload.stderr || '').slice(0, 300),
    outcomes,
  };
}

export async function tearDownStack(server, opts = {}) {
  const sshKeyPath = opts.sshKeyPath ?? process.env.RCF_LITE_CI_SSH_KEY;
  const target = `${DEPLOY_USER}@${server.primaryIpv4}`;
  // Best-effort compose down; the server is destroyed in always()
  // regardless, so this is diagnostics not the actual teardown.
  return composeCommand(target, sshKeyPath, ['down', '--volumes', '--remove-orphans'], { timeoutSeconds: 60 })
    .catch((err) => ({ code: -1, stderr: err.message, waitedMs: 0 }));
}

async function installDocker(target, sshKeyPath) {
  const started = Date.now();
  const script = [
    'set -e',
    'if command -v docker >/dev/null; then',
    '  echo docker already installed',
    'else',
    '  curl -fsSL https://get.docker.com | sudo sh',
    'fi',
    'sudo usermod -aG docker deploy || true',
    'sudo systemctl enable --now docker',
    'docker --version',
    'docker compose version',
  ].join('\n');
  // Run as bash -lc so PATH resolves docker after group add on first login.
  const { code, stdout, stderr } = await sshExec(target, `bash -lc '${script.replace(/'/g, "'\\''")}'`, sshKeyPath, 600);
  return { code, stdout, stderr, waitedMs: Date.now() - started, version: (stdout || '').trim().split('\n').slice(-2).join(' ') };
}

async function shipStack(target, sshKeyPath) {
  // rsync uses ssh with the same key discipline.
  const sshArgs = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'BatchMode=yes',
  ];
  if (sshKeyPath) sshArgs.push('-i', sshKeyPath);
  const sshCmd = `ssh ${sshArgs.map((a) => `'${a}'`).join(' ')}`;
  // Ensure remote dir with correct layout exists.
  const mkdir = await sshExec(target, `mkdir -p ${REMOTE_STACK_DIR}/src ${REMOTE_STACK_DIR}/caddy ${REMOTE_STACK_DIR}/secrets && chmod 700 ${REMOTE_STACK_DIR}/secrets`, sshKeyPath);
  if (mkdir.code !== 0) return { code: mkdir.code, stderr: mkdir.stderr };
  return await new Promise((resolvePromise, reject) => {
    const args = ['-avz', '--relative', '-e', sshCmd, ...STACK_FILES, `${target}:${REMOTE_STACK_DIR}/`];
    const p = spawn('rsync', args, { cwd: FIXTURE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function composeCommand(target, sshKeyPath, subArgs, { timeoutSeconds = 60 } = {}) {
  const started = Date.now();
  const cmd = `cd ${REMOTE_STACK_DIR} && sudo docker compose ${subArgs.map(quoteShell).join(' ')}`;
  const { code, stdout, stderr } = await sshExec(target, `bash -lc '${cmd.replace(/'/g, "'\\''")}'`, sshKeyPath, timeoutSeconds);
  return { code, stdout, stderr, waitedMs: Date.now() - started };
}

function quoteShell(v) {
  if (/^[A-Za-z0-9_\-\.,\/\+=]+$/.test(v)) return v;
  return `'${String(v).replace(/'/g, "'\\''")}'`;
}

function parseComposePs(text) {
  const services = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const doc = JSON.parse(line);
      services.push({
        name: doc.Name || doc.Service || null,
        state: (doc.State || '').toLowerCase(),
        health: (doc.Health || '').toLowerCase(),
        exitCode: typeof doc.ExitCode === 'number' ? doc.ExitCode : null,
      });
    } catch (_) { /* not JSON — ignore */ }
  }
  return services;
}
