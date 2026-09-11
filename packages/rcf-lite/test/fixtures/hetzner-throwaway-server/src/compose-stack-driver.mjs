// compose-stack-driver.mjs (v1.1.5 real-account driver for the
// platform-docker-compose-host probes).

// Reuses the ssh readiness and cloud-init wait helpers from
// ssh-baseline-check.mjs, installs docker via the vendor convenience
// script, ships the fixture compose bundle to /home/deploy/stack over
// rsync, runs docker compose up -d --wait, and terminates the run
// with an HTTP probe against the caddy :80 endpoint so the run
// carries the "deployed stack URL that answers" 7d evidence shape.

// Callers:
// - real-account-minimal-stack-up: bringUpStack() + healthCheck()
//   + observeSecretModes() (docker exec stat -c %a inside each
//   consuming container).
// - real-account-reload-burst: bringUpStack() + reloadBurst() (an
//   on-server ES-module script that ALSO triggers the caddy reload
//   itself and stamps every observation from one server clock, so
//   the overlap proof runs in one clock domain with no rebase).

// The driver never reads a secret; the fixture-shipped
// secrets/web-token is copied by rsync from disk. HCLOUD_TOKEN and the
// ssh key discipline live in provision.mjs and the ssh helpers.

// Vendor references used by this driver:
// - Docker Engine convenience install script
//   https://docs.docker.com/engine/install/ubuntu/ verifiedOn
//   2026-09-11.
// - Ubuntu 24.04 nodejs apt package (Node 18+ with global fetch
//   powered by undici)
//   https://packages.ubuntu.com/noble/nodejs verifiedOn 2026-09-11.
// - Docker Compose secret file mode default
//   https://docs.docker.com/reference/compose-file/secrets/ verifiedOn
//   2026-09-11 ("The default mode is 0444"); the fixture mounts read
//   the observed in-container mode via `docker exec ... stat -c %a`
//   and reports whatever Compose actually applied. The applying
//   project pins the desired mode via the service-level secrets
//   long-form `mode:` field.

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

// Elicited compose-up wait timeout. Default is the shipped
// `healthcheck-timeout-seconds` blueprint elicit value (30) so a
// probe run without explicit configuration matches the elicited
// baseline. Callers may pass `composeUpTimeoutSeconds` to override;
// the env var COMPOSE_UP_TIMEOUT_SECONDS overrides the default and
// is declared in the fixture README manifest.
const DEFAULT_COMPOSE_UP_TIMEOUT_SECONDS = 30;

export async function bringUpStack(server, opts = {}) {
  const sshKeyPath = opts.sshKeyPath ?? process.env.RCF_LITE_CI_SSH_KEY;
  const target = `${DEPLOY_USER}@${server.primaryIpv4}`;
  const composeUpTimeoutSeconds = Math.max(
    5,
    Number(
      opts.composeUpTimeoutSeconds
      ?? process.env.COMPOSE_UP_TIMEOUT_SECONDS
      ?? DEFAULT_COMPOSE_UP_TIMEOUT_SECONDS,
    ),
  );
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
  // Declared-services equality: read the shipped compose.yaml and
  // assert every declared service is present, in state=running, and
  // health=healthy where a healthcheck is declared.
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
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'rcf-lite-t2-probe/1.1.5' } });
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

// Runs an HTTP request FROM the throwaway server itself via ssh + curl
// against the caddy :80 host binding. The deploy-hetzner-server
// cloud-init hardening baseline installs a DOCKER-USER iptables DROP
// for non-established egress that also refuses inbound traffic to the
// docker-mapped port from off-host, so the outside-in fetch cannot
// land. From on-host the loopback path bypasses DOCKER-USER and
// observes the same body the port mapping would present, so this is
// the primary "deployed stack URL that answers" evidence shape for
// platform-docker-compose-host on the shared throwaway-server fixture.
// The outside-in httpProbe() stays for diagnostics.
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

// Observe the in-container mode of every mounted secret for every
// consuming service in the applied compose.yaml. Runs `docker exec
// <container> stat -c %a /run/secrets/<name>` for each mounted
// secret and returns { service, secretName, mode, containerId,
// mountPath }. Also returns any secret whose declared mount path
// could not be observed with an error string.
export async function observeSecretModes(server, opts = {}) {
  const sshKeyPath = opts.sshKeyPath ?? process.env.RCF_LITE_CI_SSH_KEY;
  const target = `${DEPLOY_USER}@${server.primaryIpv4}`;
  const psJson = await composeCommand(target, sshKeyPath, ['ps', '--format', 'json'], { timeoutSeconds: 30 });
  const services = parseComposePs(psJson.stdout || '');
  const doc = await readComposeYaml();
  const observations = [];
  const errors = [];
  const secretsBlock = doc.secrets || {};
  const declaredSecretNames = Object.keys(secretsBlock);
  const consumingByName = {};
  for (const name of declaredSecretNames) consumingByName[name] = [];
  for (const [svcName, svcSpec] of Object.entries(doc.services || {})) {
    const svcSecrets = Array.isArray(svcSpec && svcSpec.secrets) ? svcSpec.secrets : [];
    for (const entry of svcSecrets) {
      const secretName = typeof entry === 'string' ? entry : (entry && entry.source) || null;
      if (!secretName || !declaredSecretNames.includes(secretName)) continue;
      const target_ = (entry && typeof entry === 'object' && entry.target) ? entry.target : secretName;
      const mountPath = target_.startsWith('/') ? target_ : `/run/secrets/${target_}`;
      const ps = services.find((s) => (s.name || '').includes(svcName));
      if (!ps || !ps.name) {
        errors.push({ service: svcName, secretName, error: 'no container id found in docker compose ps' });
        continue;
      }
      const cmd = `sudo docker exec ${quoteShell(ps.name)} stat -c %a ${quoteShell(mountPath)}`;
      const r = await sshExec(target, `bash -lc '${cmd.replace(/'/g, "'\\''")}'`, sshKeyPath, 20);
      if (r.code !== 0) {
        errors.push({ service: svcName, secretName, mountPath, containerId: ps.name, error: `docker exec stat exited ${r.code}: ${(r.stderr || '').slice(0, 200)}` });
        continue;
      }
      const mode = (r.stdout || '').trim();
      observations.push({ service: svcName, secretName, mountPath, containerId: ps.name, mode });
      consumingByName[secretName].push(svcName);
    }
  }
  return { observations, errors, declaredSecretNames, consumingServicesBySecret: consumingByName };
}

async function readComposeYaml() {
  // Minimal loader reusing the fixture's shipped compose.yaml. We do
  // not want a second YAML dep for this small check, so the probe re-imports
  // the probe-side parser via a tiny shim: the probe layer supplies a
  // richer parser, but for the mode + consumer check the probe only needs
  // services + secrets, both of which are simple mapping blocks.
  const text = await readFile(join(FIXTURE_DIR, 'compose.yaml'), 'utf8');
  const doc = { services: {}, secrets: {} };
  const lines = text.split(/\r?\n/);
  let context = null;
  let currentService = null;
  let subContext = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (/^services:\s*$/.test(raw)) { context = 'services'; currentService = null; subContext = null; continue; }
    if (/^secrets:\s*$/.test(raw)) { context = 'secrets'; currentService = null; subContext = null; continue; }
    if (/^\S/.test(raw)) { context = null; currentService = null; subContext = null; continue; }
    if (context === 'services') {
      const svc = raw.match(/^  ([A-Za-z0-9_-]+):\s*$/);
      if (svc) { currentService = svc[1]; doc.services[currentService] = { secrets: [] }; subContext = null; continue; }
      if (!currentService) continue;
      const subKey = raw.match(/^    ([A-Za-z0-9_-]+):\s*$/);
      if (subKey) { subContext = subKey[1]; continue; }
      if (subContext === 'secrets') {
        const shortForm = raw.match(/^\s{6}-\s+([A-Za-z0-9_-]+)\s*$/);
        if (shortForm) { doc.services[currentService].secrets.push(shortForm[1]); continue; }
        const longStart = raw.match(/^\s{6}-\s+source:\s*([A-Za-z0-9_-]+)\s*$/);
        if (longStart) {
          const entry = { source: longStart[1] };
          // Collect subsequent lines with more indent as fields.
          for (let j = i + 1; j < lines.length; j++) {
            const kv = lines[j].match(/^\s{8}([A-Za-z0-9_-]+):\s*(.*)$/);
            if (!kv) break;
            entry[kv[1]] = kv[2].trim();
            i = j;
          }
          doc.services[currentService].secrets.push(entry);
          continue;
        }
      }
    } else if (context === 'secrets') {
      const name = raw.match(/^  ([A-Za-z0-9_-]+):\s*$/);
      if (name) { doc.secrets[name[1]] = {}; continue; }
      const kv = raw.match(/^    ([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv && Object.keys(doc.secrets).length > 0) {
        const lastName = Object.keys(doc.secrets).pop();
        doc.secrets[lastName][kv[1]] = kv[2].trim();
      }
    }
  }
  return doc;
}

// Fires a duration-driven undici burst against caddy while the burst
// script ALSO triggers `docker compose exec caddy caddy reload`
// itself; the script stamps burst start, each request, reload start
// and reload end from the server's own Date.now() clock. The runner
// receives the JSON blob and uses those server-clock timestamps
// directly; no rebase from the ssh call time.
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
      clockDomain: 'server',
    };
  }

  // Ship the burst script to /tmp/rcf-lite-burst.mjs via a base64
  // heredoc so ssh needs no stdin. The script is a pure ES module
  // that runs the concurrent undici fetches on-server AND spawns
  // the caddy reload itself, so every observation shares one clock.
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
      clockDomain: 'server',
    };
  }

  const burstDurationMs = opts.burstDurationMs ?? Math.max(5_000, (opts.reloadWindowMs ?? 10_000));
  const warmupMs = opts.warmupMs ?? 500;
  const burstEnv = [
    `BURST_MIN_TOTAL=${expectedTotal}`,
    `BURST_CONCURRENCY=${concurrency}`,
    `BURST_URL='${onServerUrl}'`,
    `BURST_DURATION_MS=${burstDurationMs}`,
    `BURST_TIMEOUT_MS=${perRequestTimeoutMs}`,
    `BURST_WARMUP_MS=${warmupMs}`,
    `BURST_REMOTE_STACK_DIR='${REMOTE_STACK_DIR}'`,
  ].join(' ');
  // The script self-triggers the reload; the runner just waits for
  // its JSON blob. Give the ssh call the burst window plus generous
  // grace for reload + docker exec overhead.
  const sshTimeoutSeconds = Math.max(60, Math.round((burstDurationMs + 60_000) / 1000));
  const burstResp = await sshExec(
    target,
    `bash -lc '${burstEnv} node /tmp/rcf-lite-burst.mjs'`,
    sshKeyPath,
    sshTimeoutSeconds,
  );

  let parsed = {};
  let parseError = null;
  try {
    parsed = JSON.parse(burstResp.stdout || '{}');
  } catch (err) {
    parseError = `on-server burst stdout not JSON: ${err.message}; stdout head=${(burstResp.stdout || '').slice(0, 200)}; stderr head=${(burstResp.stderr || '').slice(0, 200)}`;
  }
  const outcomes = Array.isArray(parsed.outcomes) ? parsed.outcomes : [];
  const startedWallAt = typeof parsed.startedWallAt === 'number' ? parsed.startedWallAt : 0;
  const endedWallAt = typeof parsed.endedWallAt === 'number' ? parsed.endedWallAt : 0;
  const reloadStartedAt = typeof parsed.reloadStartedAt === 'number' ? parsed.reloadStartedAt : 0;
  const reloadEndedAt = typeof parsed.reloadEndedAt === 'number' ? parsed.reloadEndedAt : 0;
  const reloadDurationMs = reloadEndedAt && reloadStartedAt ? reloadEndedAt - reloadStartedAt : 0;
  const reloadExit = typeof parsed.reloadExit === 'number' ? parsed.reloadExit : -1;
  const reloadStderrExcerpt = typeof parsed.reloadStderr === 'string' ? parsed.reloadStderr.slice(0, 300) : '';

  // All timestamps live on the server clock: the runner does no
  // rebase. Overlap and containment are computed from those stamps
  // directly.
  const overlaps = outcomes.filter((o) => o.startedAt <= reloadEndedAt && o.endedAt >= reloadStartedAt);
  const overlapCount = overlaps.length;
  const firstOverlapStart = overlaps.length ? Math.min(...overlaps.map((o) => o.startedAt)) : null;
  const lastOverlapEnd = overlaps.length ? Math.max(...overlaps.map((o) => o.endedAt)) : null;

  const firstRequestStartedAt = outcomes.length ? Math.min(...outcomes.map((o) => o.startedAt)) : startedWallAt;
  const lastRequestEndedAt = outcomes.length ? Math.max(...outcomes.map((o) => o.endedAt)) : endedWallAt;
  const burstWindowContainsReloadWindow = Boolean(
    reloadStartedAt && reloadEndedAt
    && firstRequestStartedAt <= reloadStartedAt
    && lastRequestEndedAt >= reloadEndedAt,
  );

  const twoXx = outcomes.filter((o) => o.statusCode >= 200 && o.statusCode < 300).length;
  const drops = outcomes.filter((o) => !(o.statusCode >= 200 && o.statusCode < 300)).length;

  return {
    expectedTotal,
    total: outcomes.length,
    twoXx, drops, reloadDurationMs,
    reloadStartedAt, reloadEndedAt,
    burstStartedAt: startedWallAt, burstEndedAt: endedWallAt,
    firstRequestStartedAt, lastRequestEndedAt,
    burstDurationMs,
    burstWindowContainsReloadWindow,
    overlapCount,
    firstOverlapStart, lastOverlapEnd,
    reloadExit,
    reloadStderrExcerpt,
    outcomes,
    mode,
    onServerNodeVersion: (nodeInstall.version || '').trim() || null,
    burstScriptShipExit: ship.code,
    burstSshExit: burstResp.code,
    burstStderrExcerpt: (burstResp.stderr || '').slice(0, 300),
    burstParseError: parseError,
    clockDomain: 'server',
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
  // Vendor: Docker Engine convenience install script
  // https://docs.docker.com/engine/install/ubuntu/ verifiedOn
  // 2026-09-11 ("Install using the convenience script").
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
  const rsyncOutcome = await new Promise((resolvePromise, reject) => {
    const args = ['-avz', '--relative', '-e', sshCmd, ...STACK_FILES, `${target}:${REMOTE_STACK_DIR}/`];
    const p = spawn('rsync', args, { cwd: FIXTURE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
  if (rsyncOutcome.code !== 0) return rsyncOutcome;
  // Docker Compose (non-Swarm) mounts a compose secret with the SOURCE
  // file's host mode. The AC-composeHost-secretShape "mounted at
  // 0o400" clause requires the file to be 0o400 on the host before
  // docker compose up. Tightening the mode here is the compose-secrets
  // pattern the blueprint documents.
  const chmodOutcome = await sshExec(target, `chmod 400 ${REMOTE_STACK_DIR}/secrets/web-token`, sshKeyPath);
  if (chmodOutcome.code !== 0) {
    return { code: chmodOutcome.code, stdout: rsyncOutcome.stdout, stderr: `chmod 400 on remote secrets/web-token failed: ${chmodOutcome.stderr}` };
  }
  return rsyncOutcome;
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
// short-circuits when `node` is already resolvable. Vendor:
// Ubuntu 24.04's `nodejs` apt package ships Node 18+
// (https://packages.ubuntu.com/noble/nodejs verifiedOn 2026-09-11),
// which carries the global fetch (undici) the AC requires.
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
// the throwaway server. Reads BURST_URL, BURST_MIN_TOTAL,
// BURST_DURATION_MS, BURST_CONCURRENCY, BURST_TIMEOUT_MS,
// BURST_WARMUP_MS and BURST_REMOTE_STACK_DIR from env.

// The script:
//   1. Fires a warmup, records `startedWallAt`.
//   2. Spawns the burst workers (undici fetch loops).
//   3. Records `reloadStartedAt`, spawns
//      `sudo docker compose exec -T caddy caddy reload --config
//      /etc/caddy/Caddyfile` from the stack dir.
//   4. When the reload child exits, records `reloadEndedAt`,
//      `reloadExit`, `reloadStderr`.
//   5. Waits for BURST_DURATION_MS AND at least BURST_MIN_TOTAL
//      requests, whichever is longer.
//   6. Records `endedWallAt` and writes ONE JSON blob to stdout
//      with all fields and the per-request outcomes.

// Every timestamp comes from Date.now() ON THIS PROCESS on the
// server, so overlap and containment are computed in one clock
// domain by the runner with no rebase.
const BURST_SCRIPT = `
const minTotal = Number(process.env.BURST_MIN_TOTAL || 40);
const durationMs = Number(process.env.BURST_DURATION_MS || 10000);
const concurrency = Number(process.env.BURST_CONCURRENCY || 8);
const warmupMs = Number(process.env.BURST_WARMUP_MS || 500);
const url = process.env.BURST_URL;
const perRequestTimeoutMs = Number(process.env.BURST_TIMEOUT_MS || 5000);
const stackDir = process.env.BURST_REMOTE_STACK_DIR || '/home/deploy/stack';
if (!url) { process.stderr.write('BURST_URL missing\\n'); process.exit(2); }
const { spawn } = await import('node:child_process');
const outcomes = [];
let idxCounter = 0;
let stopBurstAt = 0;

async function worker() {
  while (Date.now() < stopBurstAt || outcomes.length < minTotal) {
    const idx = idxCounter++;
    const startedAt = Date.now();
    let statusCode = 0;
    let error = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perRequestTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'rcf-lite-reload-burst/1.1.5 (undici-on-server)' } });
      statusCode = res.status;
      try { await res.text(); } catch (_) {}
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    } finally { clearTimeout(timer); }
    const endedAt = Date.now();
    outcomes.push({ idx, startedAt, endedAt, elapsedMs: endedAt - startedAt, statusCode, ok: statusCode >= 200 && statusCode < 300, error });
  }
}

function runReload() {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', 'cd ' + stackDir + ' && sudo docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ exit: typeof code === 'number' ? code : -1, stderr }));
    child.on('error', (err) => resolve({ exit: -1, stderr: err && err.message ? err.message : String(err) }));
  });
}

(async () => {
  const startedWallAt = Date.now();
  stopBurstAt = startedWallAt + warmupMs + durationMs;
  // Kick off burst workers first so requests are already in flight
  // when the reload is triggered.
  const burstPromise = Promise.all(Array.from({ length: concurrency }, () => worker()));
  // Warm-up so the first fetch is in flight before the reload fires.
  await new Promise((r) => setTimeout(r, warmupMs));
  const reloadStartedAt = Date.now();
  const reload = await runReload();
  const reloadEndedAt = Date.now();
  await burstPromise;
  const endedWallAt = Date.now();
  outcomes.sort((a, b) => a.idx - b.idx);
  process.stdout.write(JSON.stringify({
    startedWallAt, endedWallAt,
    reloadStartedAt, reloadEndedAt,
    reloadExit: reload.exit,
    reloadStderr: (reload.stderr || '').slice(0, 300),
    outcomes,
  }));
})().catch((err) => { process.stderr.write(String(err && err.stack || err)); process.exit(3); });
`;
