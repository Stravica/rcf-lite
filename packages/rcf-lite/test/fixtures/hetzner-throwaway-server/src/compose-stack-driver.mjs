// compose-stack-driver.mjs (v1.1.3 real-account driver for the
// platform-docker-compose-host platform-docker-compose-host probes).
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

// The Node 20+ globalThis.fetch is powered by undici (bundled). We use
// it directly rather than importing `undici` so the fixture stays
// zero-dep. AC-composeHost-zeroDowntimeReload states "undici GETs";
// this satisfies that with the same client library.

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
  // Elicited compose-up wait timeout (reclosure Item 9: was hardcoded
  // 120s). Env var COMPOSE_UP_TIMEOUT_SECONDS, default 120, matches
  // AC-composeHost-upClean's "elicited timeout".
  const composeUpTimeoutSeconds = Math.max(30, Number(opts.composeUpTimeoutSeconds ?? process.env.COMPOSE_UP_TIMEOUT_SECONDS ?? 120));
  const composeUpOverallSeconds = composeUpTimeoutSeconds + 60; // grace for docker overhead
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

  const composeUp = await composeCommand(target, sshKeyPath,
    ['up', '-d', '--wait', '--wait-timeout', String(composeUpTimeoutSeconds)],
    { timeoutSeconds: composeUpOverallSeconds },
  );
  record('composeUp', `exit=${composeUp.code} durationMs=${composeUp.waitedMs} elicitedTimeoutSeconds=${composeUpTimeoutSeconds}`);
  if (composeUp.code !== 0) {
    return { ok: false, phase: 'composeUp', composeUp, events, elicitedTimeoutSeconds: composeUpTimeoutSeconds };
  }

  const composeStatus = await composeCommand(target, sshKeyPath, ['ps', '--format', 'json'], { timeoutSeconds: 30 });
  const services = parseComposePs(composeStatus.stdout || '');
  // Declared-services equality (reclosure Item 9): read the shipped
  // compose.yaml and assert every declared service is present, in
  // state=running, and health=healthy where a healthcheck is declared.
  const declared = await readDeclaredServices();
  const observedNames = services.map((s) => s.name || '').filter(Boolean);
  const missingServices = declared.filter((d) => !services.some((s) => (s.name || '').includes(d.name)));
  const unhealthy = [];
  for (const decl of declared) {
    const obs = services.find((s) => (s.name || '').includes(decl.name));
    if (!obs) continue;
    if (obs.state !== 'running') { unhealthy.push({ service: decl.name, state: obs.state, health: obs.health, reason: 'state != running' }); continue; }
    if (decl.hasHealthcheck && obs.health !== 'healthy') {
      unhealthy.push({ service: decl.name, state: obs.state, health: obs.health, reason: 'declared healthcheck but health != healthy' });
    }
  }
  record('composePs', `services=${services.length} declared=${declared.length} missing=${missingServices.length} unhealthy=${unhealthy.length}`);
  if (missingServices.length > 0 || unhealthy.length > 0) {
    return {
      ok: false, phase: 'composeHealth',
      readiness, cloudInit, dockerInstall,
      services, declared, observedNames, missingServices, unhealthy,
      events, target, elicitedTimeoutSeconds: composeUpTimeoutSeconds,
    };
  }

  return {
    ok: true, phase: 'stackUp', readiness, cloudInit, dockerInstall,
    services, declared, observedNames,
    events, target, elicitedTimeoutSeconds: composeUpTimeoutSeconds,
  };
}

// Read the declared services from the shipped compose.yaml so
// bringUpStack can assert equality against `docker compose ps` output.
// Uses a minimal in-house YAML scan tuned for the fixture shape.
async function readDeclaredServices() {
  try {
    const text = await readFile(join(FIXTURE_DIR, 'compose.yaml'), 'utf8');
    const lines = text.split(/\r?\n/);
    const services = [];
    let inServices = false;
    let currentName = null;
    let currentHasHealthcheck = false;
    let currentIndent = -1;
    const flush = () => {
      if (currentName) services.push({ name: currentName, hasHealthcheck: currentHasHealthcheck });
      currentName = null;
      currentHasHealthcheck = false;
    };
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || raw.trim() === '' || raw.trim().startsWith('#')) continue;
      if (/^services:\s*$/.test(raw)) { inServices = true; continue; }
      if (inServices && /^\S/.test(raw) && !/^services:/.test(raw)) { flush(); inServices = false; continue; }
      if (!inServices) continue;
      const m = raw.match(/^(\s+)([A-Za-z0-9_-]+):\s*$/);
      if (m && m[1].length === 2) {
        flush();
        currentName = m[2];
        currentIndent = m[1].length;
        continue;
      }
      if (currentName && /^\s{4}healthcheck:\s*$/.test(raw)) currentHasHealthcheck = true;
    }
    flush();
    return services;
  } catch (_) {
    return [];
  }
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

// Runs an HTTP request FROM the throwaway server itself via ssh + curl
// against the caddy :80 host binding. The deploy-hetzner-server cloud-init hardening
// baseline installs a DOCKER-USER iptables DROP for non-established
// egress that also refuses inbound traffic to the docker-mapped port
// from off-host, so the outside-in fetch cannot land. From on-host
// the loopback path bypasses DOCKER-USER and observes the same body
// the port mapping would present, so this is the primary "deployed
// stack URL that answers" evidence shape for platform-docker-compose-host on the shared
// throwaway-server fixture. The outside-in httpProbe() stays for
// diagnostics.
export async function httpProbeOnServer(server, path = '/live', opts = {}) {
  const sshKeyPath = opts.sshKeyPath ?? process.env.RCF_LITE_CI_SSH_KEY;
  const target = `${DEPLOY_USER}@${server.primaryIpv4}`;
  const port = opts.port ?? 80;
  const timeoutSeconds = opts.timeoutSeconds ?? 15;
  // curl -sS captures body plus status code with a documented format.
  const cmd = `curl -sS -o /dev/stdout -w '\n---STATUS---%{http_code}\n---REQID---%{header_x-caddy-request-id}\n---ELAPSED---%{time_total}\n' --max-time 10 http://127.0.0.1:${port}${path}`;
  const { code, stdout, stderr } = await sshExec(target, cmd, sshKeyPath, timeoutSeconds);
  if (code !== 0) return { ok: false, statusCode: 0, error: `ssh curl exited ${code}: ${stderr.trim().slice(0, 300)}`, target: `http://127.0.0.1:${port}${path}` };
  // Parse the trailer.
  const parts = stdout.split('\n---STATUS---');
  const body = parts[0] || '';
  const trailer = (parts[1] || '');
  const statusMatch = trailer.match(/^(\d+)/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
  const reqIdMatch = trailer.match(/---REQID---([^\n]*)/);
  const elapsedMatch = trailer.match(/---ELAPSED---([^\n]*)/);
  return {
    ok: statusCode >= 200 && statusCode < 300,
    statusCode,
    bodyExcerpt: body.slice(0, 200),
    requestId: reqIdMatch ? reqIdMatch[1].trim() || null : null,
    elapsedSeconds: elapsedMatch ? Number(elapsedMatch[1]) : null,
    target: `http://127.0.0.1:${port}${path} (via ssh on ${server.primaryIpv4})`,
  };
}

// Fires N concurrent HTTP requests against caddy while caddy reload
// runs; returns per-request outcomes plus the reload exit code. Used
// by real-account-reload-burst. The burst runs ON the throwaway
// server via a small Node script shipped over ssh, so undici (Node's
// global fetch) drives the requests against http://127.0.0.1:80 from
// inside the loopback. The shipped deploy-hetzner-server cloud-init
// hardening's DOCKER-USER DROP refuses off-host traffic to the
// docker-mapped port, so loopback is the only reachable path for the
// shipped fixture; running on-server also removes the per-request ssh
// round-trip overhead.
export async function reloadBurst(server, path, opts = {}) {
  const expectedTotal = opts.total ?? 40;
  const concurrency = opts.concurrency ?? 8;
  const sshKeyPath = opts.sshKeyPath ?? process.env.RCF_LITE_CI_SSH_KEY;
  const target = `${DEPLOY_USER}@${server.primaryIpv4}`;
  const mode = opts.mode ?? 'undici-on-server';
  const perRequestTimeoutMs = opts.perRequestTimeoutMs ?? 10_000;
  const port = opts.port ?? 80;
  const onServerUrl = `http://127.0.0.1:${port}${path}`;

  // Install Node on the throwaway server so undici (Node's global
  // fetch) drives the burst from the loopback. The shipped
  // deploy-hetzner-server cloud-init hardening drops off-host traffic
  // at DOCKER-USER, so an on-runner burst cannot reach the caddy
  // service. The fixture README declares the reload-burst probe
  // installs nodejs during setup for exactly this reason.
  const nodeInstall = await installNodeIfNeeded(target, sshKeyPath);
  if (nodeInstall.code !== 0) {
    return {
      expectedTotal, total: 0, twoXx: 0, drops: 0,
      reloadDurationMs: 0, reloadStartedAt: 0, reloadEndedAt: 0,
      overlapCount: 0, firstOverlapStart: null, lastOverlapEnd: null,
      reloadExit: -1,
      reloadStderrExcerpt: `installNodeIfNeeded exit=${nodeInstall.code}: ${(nodeInstall.stderr || '').slice(0, 200)}`,
      outcomes: [], mode,
      burstStartedAt: 0, burstEndedAt: 0,
      onServerNodeVersion: null,
      burstWindowContainsReloadWindow: false,
    };
  }

  // Ship the burst script to /tmp/rcf-lite-burst.mjs via a base64
  // heredoc so ssh needs no stdin. The script is a pure ES module
  // that runs the concurrent undici fetches on-server and emits one
  // JSON blob to stdout.
  const scriptB64 = Buffer.from(BURST_SCRIPT, 'utf8').toString('base64');
  const shipCmd = `bash -lc 'printf %s ${scriptB64} | base64 -d > /tmp/rcf-lite-burst.mjs'`;
  const ship = await sshExec(target, shipCmd, sshKeyPath, 30);
  if (ship.code !== 0) {
    return {
      expectedTotal, total: 0, twoXx: 0, drops: 0,
      reloadDurationMs: 0, reloadStartedAt: 0, reloadEndedAt: 0,
      overlapCount: 0, firstOverlapStart: null, lastOverlapEnd: null,
      reloadExit: -1,
      reloadStderrExcerpt: `burst-script ship exit=${ship.code}: ${(ship.stderr || '').slice(0, 200)}`,
      outcomes: [], mode,
      burstStartedAt: 0, burstEndedAt: 0,
      onServerNodeVersion: (nodeInstall.version || '').trim() || null,
      burstWindowContainsReloadWindow: false,
    };
  }

  // AC-composeHost-zeroDowntimeReload requires undici GETs against the
  // proxy service while caddy reload runs. The reload is fired
  // asynchronously; the on-server burst is fired in parallel and
  // records its own per-request start/end wall-clock stamps. Both
  // windows are bracketed on the runner clock, so overlap is proven
  // on a single clock from the record.
  const reloadStartedAt = Date.now();
  const reloadPromise = composeCommand(target, sshKeyPath,
    ['exec', '-T', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
    { timeoutSeconds: 30 });

  const burstEnv = `BURST_TOTAL=${expectedTotal} BURST_CONCURRENCY=${concurrency} BURST_URL='${onServerUrl}' BURST_TIMEOUT_MS=${perRequestTimeoutMs}`;
  const burstStartedAt = Date.now();
  const burstResp = await sshExec(target, `bash -lc '${burstEnv} node /tmp/rcf-lite-burst.mjs'`, sshKeyPath, 120);
  const burstEndedAt = Date.now();

  const reload = await reloadPromise;
  const reloadEndedAt = Date.now();
  const reloadDurationMs = reloadEndedAt - reloadStartedAt;

  let outcomes = [];
  let startedWallAt = burstStartedAt;
  let endedWallAt = burstEndedAt;
  let parseError = null;
  try {
    const parsed = JSON.parse(burstResp.stdout || '{}');
    outcomes = Array.isArray(parsed.outcomes) ? parsed.outcomes : [];
    if (typeof parsed.startedWallAt === 'number') startedWallAt = parsed.startedWallAt;
    if (typeof parsed.endedWallAt === 'number') endedWallAt = parsed.endedWallAt;
  } catch (err) {
    parseError = `on-server burst stdout not JSON: ${err.message}; stdout head=${(burstResp.stdout || '').slice(0, 200)}; stderr head=${(burstResp.stderr || '').slice(0, 200)}`;
  }

  // Translate on-server per-request timestamps to the runner clock so
  // the overlap check runs in one clock domain. Offset is the
  // difference between the ssh call's start on the runner and the
  // script's first Date.now() on the server.
  const clockOffsetMs = burstStartedAt - startedWallAt;
  const rebasedOutcomes = outcomes.map((o) => ({
    idx: o.idx,
    startedAt: o.startedAt + clockOffsetMs,
    endedAt: o.endedAt + clockOffsetMs,
    elapsedMs: o.elapsedMs,
    statusCode: o.statusCode,
    ok: o.statusCode >= 200 && o.statusCode < 300,
    error: o.error,
  }));

  // Overlap proof: an outcome overlaps the reload window if its
  // [startedAt, endedAt] intersects [reloadStartedAt, reloadEndedAt].
  const overlaps = rebasedOutcomes.filter((o) => o.startedAt <= reloadEndedAt && o.endedAt >= reloadStartedAt);
  const overlapCount = overlaps.length;
  const firstOverlapStart = overlaps.length ? Math.min(...overlaps.map((o) => o.startedAt)) : null;
  const lastOverlapEnd = overlaps.length ? Math.max(...overlaps.map((o) => o.endedAt)) : null;

  // Burst window contains the reload window iff every reload
  // millisecond falls inside the burst window. Proves the burst was
  // running for the entire reload, per the AC's "undici requests
  // overlapping the reload".
  const burstWindowContainsReloadWindow = (
    burstStartedAt <= reloadStartedAt && burstEndedAt >= reloadEndedAt
  );

  const twoXx = rebasedOutcomes.filter((o) => o.statusCode >= 200 && o.statusCode < 300).length;
  const drops = rebasedOutcomes.filter((o) => !o.ok).length;

  // Preserve the expected vs observed distinction: returning
  // `total: outcomes.length` alone allowed <40-result runs to pass
  // silently. Both counts are reported and the caller checks.
  return {
    expectedTotal,
    total: rebasedOutcomes.length,
    twoXx, drops, reloadDurationMs,
    reloadStartedAt, reloadEndedAt,
    burstStartedAt, burstEndedAt,
    burstWindowContainsReloadWindow,
    overlapCount,
    firstOverlapStart, lastOverlapEnd,
    reloadExit: reload.code,
    reloadStderrExcerpt: (reload.stderr || '').slice(0, 300),
    outcomes: rebasedOutcomes,
    mode,
    onServerNodeVersion: (nodeInstall.version || '').trim() || null,
    burstScriptShipExit: ship.code,
    burstSshExit: burstResp.code,
    burstStderrExcerpt: (burstResp.stderr || '').slice(0, 300),
    burstParseError: parseError,
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
    } catch (_) { /* not JSON, ignore */ }
  }
  return services;
}


// Install Node on the throwaway server if not already present. Used
// exclusively by the reload-burst probe path. Idempotent: the shell
// short-circuits when `node` is already resolvable. Ubuntu 24.04's
// `nodejs` apt package ships Node 18+, which carries the global
// fetch (undici) the AC requires.
async function installNodeIfNeeded(target, sshKeyPath) {
  const started = Date.now();
  const script = [
    'set -e',
    'if command -v node >/dev/null 2>&1; then',
    '  node --version',
    '  exit 0',
    'fi',
    'sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq',
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs',
    'node --version',
  ].join('\n');
  const { code, stdout, stderr } = await sshExec(target, `bash -lc '${script.replace(/'/g, "'\\''")}'`, sshKeyPath, 300);
  return { code, stdout, stderr, waitedMs: Date.now() - started, version: (stdout || '').trim().split('\n').pop() };
}

// Node ES-module burst script shipped to /tmp/rcf-lite-burst.mjs on
// the throwaway server. Reads BURST_URL, BURST_TOTAL,
// BURST_CONCURRENCY and BURST_TIMEOUT_MS from env; drives the
// concurrent undici fetches; writes one JSON blob to stdout with the
// per-request outcomes plus the wall-clock brackets recorded on the
// server.
const BURST_SCRIPT = `
const total = Number(process.env.BURST_TOTAL || 40);
const concurrency = Number(process.env.BURST_CONCURRENCY || 8);
const url = process.env.BURST_URL;
const perRequestTimeoutMs = Number(process.env.BURST_TIMEOUT_MS || 10000);
if (!url) { process.stderr.write('BURST_URL missing\\n'); process.exit(2); }
const outcomes = [];
let cursor = 0;
async function worker() {
  while (true) {
    const idx = cursor++;
    if (idx >= total) return;
    const startedAt = Date.now();
    let statusCode = 0;
    let error = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perRequestTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'rcf-lite-reload-burst/1.1.4 (undici-on-server)' } });
      statusCode = res.status;
      try { await res.text(); } catch (_) {}
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally { clearTimeout(timer); }
    const endedAt = Date.now();
    outcomes.push({ idx, startedAt, endedAt, elapsedMs: endedAt - startedAt, statusCode, ok: statusCode >= 200 && statusCode < 300, error });
  }
}
(async () => {
  const startedWallAt = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const endedWallAt = Date.now();
  outcomes.sort((a, b) => a.idx - b.idx);
  process.stdout.write(JSON.stringify({ startedWallAt, endedWallAt, outcomes }));
})().catch((err) => { process.stderr.write(String(err && err.stack || err)); process.exit(3); });
`;
