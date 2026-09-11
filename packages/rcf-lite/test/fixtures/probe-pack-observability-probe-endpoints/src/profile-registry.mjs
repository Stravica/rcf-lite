// Fixture profile registry for observability-probe-endpoints.
//
// Realises the blueprint's load-bearing shape: profiles are named
// records that declare transport (http), paths, response contract
// and semantic distinction between liveness/readiness/startup. The
// materialiser refuses a partial profile at boot; a valid profile
// materialises an http server exposing the declared paths.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const REQUIRED_KEYS = ['name', 'transport', 'paths', 'responseContract', 'semantics'];
const REQUIRED_PATHS = ['liveness', 'readiness'];

export const SHIPPED_PROFILES = {
  'kubernetes-request-listener': {
    name: 'kubernetes-request-listener',
    transport: 'http',
    paths: { liveness: '/live', readiness: '/ready' },
    responseContract: { livenessOk: 200, livenessFail: 503, readinessOk: 200, readinessFail: 503 },
    semantics: { liveness: 'restart-when-fail', readiness: 'rotate-when-fail' },
    startupEnabled: false,
  },
  'kubernetes-startup': {
    name: 'kubernetes-startup',
    transport: 'http',
    paths: { liveness: '/live', readiness: '/ready', startup: '/startup' },
    responseContract: { livenessOk: 200, livenessFail: 503, readinessOk: 200, readinessFail: 503, startupOk: 200, startupFail: 503 },
    semantics: { liveness: 'restart-when-fail', readiness: 'rotate-when-fail', startup: 'delay-liveness-until-ok' },
    startupEnabled: true,
  },
  'plain-http': {
    name: 'plain-http',
    transport: 'http',
    paths: { liveness: '/healthz', readiness: '/readyz' },
    responseContract: { livenessOk: 200, livenessFail: 503, readinessOk: 200, readinessFail: 503 },
    semantics: { liveness: 'poller-restarts-service', readiness: 'poller-drains-service' },
    startupEnabled: false,
  },
};

export function refuseIfPartial(profile) {
  for (const key of REQUIRED_KEYS) {
    if (profile[key] === undefined) throw new Error(`profile refused: missing '${key}'`);
  }
  for (const p of REQUIRED_PATHS) {
    if (!profile.paths[p]) throw new Error(`profile refused: missing paths.${p}`);
  }
  if (profile.startupEnabled && !profile.paths.startup) {
    throw new Error(`profile refused: startupEnabled=true requires paths.startup`);
  }
  return profile;
}

export async function materialise({ profile, listenerPort, separateListenerPort }) {
  const p = refuseIfPartial(profile);
  let startupReady = !p.startupEnabled;
  const handler = (req, res) => {
    const rid = req.headers['x-request-id'] || randomUUID();
    res.setHeader('x-request-id', rid);
    res.setHeader('content-type', 'application/json');
    if (req.url === p.paths.liveness) {
      res.statusCode = 200;
      res.end(JSON.stringify({ profile: p.name, kind: 'liveness', status: 'live' }));
      return;
    }
    if (req.url === p.paths.readiness) {
      res.statusCode = 200;
      res.end(JSON.stringify({ profile: p.name, kind: 'readiness', status: 'ready' }));
      return;
    }
    if (p.paths.startup && req.url === p.paths.startup) {
      res.statusCode = startupReady ? 200 : 503;
      res.end(JSON.stringify({ profile: p.name, kind: 'startup', status: startupReady ? 'ready' : 'starting' }));
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
    async close() {
      await new Promise((r) => request.close(() => r()));
      if (separate) await new Promise((r) => separate.close(() => r()));
    },
  };
}
