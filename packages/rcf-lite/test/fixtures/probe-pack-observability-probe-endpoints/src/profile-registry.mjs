// Fixture profile registry for observability-probe-endpoints.
//
// Realises the SIX shipped profile names named on AC-14103-1
// (kubernetes, loadBalancer, uptimeMonitor, systemd,
// dockerHealthcheck, reverseProxy). Each profile carries the four
// AC-14103-1 fields: transport, paths (or command/notify equivalent),
// responseContract, semanticModel. A partial profile is refused at
// resolve with a stable-coded PROBE_PROFILE_INCOMPLETE error naming
// the missing key (AC-14103-2).
//
// The kubernetes profile has an OPTIONAL startup path; when
// startup.enabled is true the resolved profile includes
// paths.startup and semanticModel.startup, and the materialiser
// binds the /startup handler with the AC-14102-4 fail/pass semantics.
//
// Teardown callbacks propagate errors on close.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const REQUIRED_KEYS = ['name', 'transport', 'responseContract', 'semanticModel'];

// The six shipped profiles named on AC-14103-1. Each declares its
// transport, path/command/notify surface, responseContract and
// semanticModel. loadBalancer has a singleHealthSignal semantic per
// AC-14103-3 (single /health endpoint, no split live/ready).
export const SHIPPED_PROFILES = {
  kubernetes: {
    name: 'kubernetes',
    transport: 'http',
    paths: { liveness: '/live', readiness: '/ready' },
    responseContract: { livenessOk: 200, livenessFail: 503, readinessOk: 200, readinessFail: 503 },
    semanticModel: { liveness: 'restart-when-fail', readiness: 'rotate-when-fail' },
  },
  loadBalancer: {
    name: 'loadBalancer',
    transport: 'http',
    paths: { health: '/health' },
    responseContract: { healthOk: 200, healthFail: 503 },
    semanticModel: 'singleHealthSignal',
  },
  uptimeMonitor: {
    name: 'uptimeMonitor',
    transport: 'http',
    paths: { health: '/uptime' },
    responseContract: { healthOk: 200, healthFail: 503 },
    semanticModel: 'externalPollHealth',
  },
  systemd: {
    name: 'systemd',
    transport: 'notify',
    notify: { socket: '$NOTIFY_SOCKET', readyMessage: 'READY=1', watchdogMessage: 'WATCHDOG=1' },
    responseContract: { readyLine: 'READY=1', stoppingLine: 'STOPPING=1' },
    semanticModel: 'sdNotify',
  },
  dockerHealthcheck: {
    name: 'dockerHealthcheck',
    transport: 'command',
    command: { argv: ['/usr/local/bin/probe', '--check', 'ready'], expectExitZero: true },
    responseContract: { exitZero: 'healthy', exitNonZero: 'unhealthy' },
    semanticModel: 'exitCodeHealth',
  },
  reverseProxy: {
    name: 'reverseProxy',
    transport: 'http',
    paths: { health: '/backend-health' },
    responseContract: { healthOk: 200, healthFail: 503 },
    semanticModel: 'proxyBackedHealth',
  },
};

// Resolve a shipped profile by name and apply optional overrides.
// Supports kubernetes with startup.enabled: true which adds paths.startup
// and semanticModel.startup per AC-14102-4.
export function resolveProfile(name, options = {}) {
  const base = SHIPPED_PROFILES[name];
  if (!base) {
    const err = new Error(`PROBE_PROFILE_UNKNOWN: profile '${name}' not in shipped set; valid: ${Object.keys(SHIPPED_PROFILES).join(', ')}`);
    err.code = 'PROBE_PROFILE_UNKNOWN';
    throw err;
  }
  const resolved = JSON.parse(JSON.stringify(base));
  if (name === 'kubernetes' && options?.startup?.enabled === true) {
    resolved.paths.startup = '/startup';
    if (typeof resolved.semanticModel === 'object') resolved.semanticModel.startup = 'delay-liveness-until-ok';
    resolved.responseContract.startupOk = 200;
    resolved.responseContract.startupFail = 503;
    resolved.startupEnabled = true;
  }
  return resolved;
}

// AC-14103-2: refuse a partial profile at boot with a stable-coded
// PROBE_PROFILE_INCOMPLETE error naming the missing field.
export function refuseIfPartial(profile) {
  for (const key of REQUIRED_KEYS) {
    if (profile[key] === undefined) {
      const err = new Error(`PROBE_PROFILE_INCOMPLETE: profile '${profile?.name ?? '<unnamed>'}' missing '${key}'`);
      err.code = 'PROBE_PROFILE_INCOMPLETE';
      err.missingKey = key;
      throw err;
    }
  }
  // Transport-appropriate surface: http requires paths, notify requires
  // notify, command requires command.
  if (profile.transport === 'http' && (!profile.paths || Object.keys(profile.paths).length === 0)) {
    const err = new Error(`PROBE_PROFILE_INCOMPLETE: profile '${profile.name}' with transport=http missing paths`);
    err.code = 'PROBE_PROFILE_INCOMPLETE'; err.missingKey = 'paths';
    throw err;
  }
  if (profile.transport === 'notify' && !profile.notify) {
    const err = new Error(`PROBE_PROFILE_INCOMPLETE: profile '${profile.name}' with transport=notify missing notify`);
    err.code = 'PROBE_PROFILE_INCOMPLETE'; err.missingKey = 'notify';
    throw err;
  }
  if (profile.transport === 'command' && !profile.command) {
    const err = new Error(`PROBE_PROFILE_INCOMPLETE: profile '${profile.name}' with transport=command missing command`);
    err.code = 'PROBE_PROFILE_INCOMPLETE'; err.missingKey = 'command';
    throw err;
  }
  if (profile.startupEnabled === true && !profile.paths?.startup) {
    const err = new Error(`PROBE_PROFILE_INCOMPLETE: profile '${profile.name}' with startupEnabled=true missing paths.startup`);
    err.code = 'PROBE_PROFILE_INCOMPLETE'; err.missingKey = 'paths.startup';
    throw err;
  }
  return profile;
}

// Materialise an HTTP-transport profile (kubernetes / loadBalancer /
// uptimeMonitor / reverseProxy). notify- and command-transport
// profiles bind no listener; the AC-14103-1 shape checks are still
// meaningful for those since resolveProfile returns the full shape.
export async function materialise({ profile, listenerPort, separateListenerPort }) {
  const p = refuseIfPartial(profile);
  const teardowns = [];
  if (p.transport !== 'http') {
    return {
      profile: p,
      requestPort: null,
      separatePort: null,
      markStartupReady() {},
      registerTeardown(fn) { if (typeof fn === 'function') teardowns.push(fn); },
      async close() {
        let firstError = null;
        for (const fn of teardowns) { try { await fn(); } catch (e) { if (!firstError) firstError = e; } }
        if (firstError) throw firstError;
      },
    };
  }
  let startupReady = !p.startupEnabled;
  const handler = (req, res) => {
    const rid = req.headers['x-request-id'] || randomUUID();
    res.setHeader('x-request-id', rid);
    res.setHeader('content-type', 'application/json');
    if (p.paths.liveness && req.url === p.paths.liveness) {
      res.statusCode = 200;
      res.end(JSON.stringify({ profile: p.name, kind: 'liveness', status: 'pass' }));
      return;
    }
    if (p.paths.readiness && req.url === p.paths.readiness) {
      res.statusCode = 200;
      res.end(JSON.stringify({ profile: p.name, kind: 'readiness', status: 'pass' }));
      return;
    }
    if (p.paths.startup && req.url === p.paths.startup) {
      res.statusCode = startupReady ? 200 : 503;
      res.end(JSON.stringify({ profile: p.name, kind: 'startup', status: startupReady ? 'pass' : 'fail' }));
      return;
    }
    if (p.paths.health && req.url === p.paths.health) {
      res.statusCode = 200;
      res.end(JSON.stringify({ profile: p.name, kind: 'health', status: 'pass' }));
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'not-found' }));
  };
  const request = createServer(handler);
  let separate = null;
  await new Promise((resolve, reject) => { request.once('error', reject); request.listen(listenerPort, '127.0.0.1', () => resolve()); });
  if (separateListenerPort !== undefined) {
    separate = createServer(handler);
    await new Promise((resolve, reject) => { separate.once('error', reject); separate.listen(separateListenerPort, '127.0.0.1', () => resolve()); });
  }
  return {
    profile: p,
    requestPort: request.address().port,
    separatePort: separate?.address().port ?? null,
    markStartupReady() { startupReady = true; },
    registerTeardown(fn) { if (typeof fn === 'function') teardowns.push(fn); },
    async close() {
      // Teardown callbacks propagate errors on close.
      await new Promise((resolve, reject) => request.close((err) => (err ? reject(err) : resolve())));
      if (separate) await new Promise((resolve, reject) => separate.close((err) => (err ? reject(err) : resolve())));
      let firstError = null;
      for (const fn of teardowns) { try { await fn(); } catch (e) { if (!firstError) firstError = e; } }
      if (firstError) throw firstError;
    },
  };
}
