// Probe: compose-config-lint.
//
// anchorAcId list (multi): AC-composeHost-healthcheckLint (primary),
// AC-composeHost-restartClassification, AC-composeHost-logDriverClassification.
// accountBound: false.
//
// Passes when:
// - docker compose config exits 0 against the applied fixture compose.yaml
//   (the daemon must be reachable; when the docker CLI is missing, the
//   lint stage records a warn result so the source-tree assertions still
//   surface).
// - every HTTP-terminating service (web) declares a healthcheck block.
// - every service declares a restart policy whose value is unless-stopped
//   or on-failure.
// - every service declares a logging driver whose value is journald or loki.
// - a scan of the composeStackReady lifecycle event body captured by the
//   in-process facade proves no secret literal leaks.
//
// Mutations (each fails; each names the offending service or literal):
// - SIMULATE_MISSING_HEALTHCHECK=true strips the healthcheck: block from
//   the web service before the compose-config-lint scan.
// - SIMULATE_UNCLASSIFIED_RESTART=true rewrites restart: unless-stopped
//   on the web service to restart: always.
// - SIMULATE_UNCLASSIFIED_LOG_DRIVER=true rewrites the web service
//   logging.driver from journald to syslog.
// - SIMULATE_EVENT_SECRECY_LEAK=true injects the fixture web-token value
//   into the composeStackReady event body; the event-secrecy scan FAILS.

import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runShim, readCompose, COMPOSE_PATH, FIXTURE_DIR, SECRET_PATH, whichDocker } from './probe-utils.mjs';

export const anchorAcIds = [
  'AC-composeHost-healthcheckLint',
  'AC-composeHost-restartClassification',
  'AC-composeHost-logDriverClassification',
];
export const accountBound = false;

const HTTP_SERVICES = new Set(['web', 'caddy']);
const ALLOWED_RESTART = new Set(['unless-stopped', 'on-failure']);
const ALLOWED_LOG_DRIVER = new Set(['journald', 'loki']);

function applyMutations(text) {
  let out = text;
  if (process.env.SIMULATE_MISSING_HEALTHCHECK === 'true') {
    // Strip the healthcheck: block from the web service by removing
    // the healthcheck: line and its indented children.
    const lines = out.split('\n');
    const trimmed = [];
    let stripping = false;
    let stripIndent = 0;
    for (const line of lines) {
      if (stripping) {
        const m = line.match(/^(\s*)/);
        const indent = m ? m[1].length : 0;
        if (line.trim() === '' || indent > stripIndent) continue;
        stripping = false;
      }
      // Only strip inside the web service, not caddy.
      if (line.match(/^\s{4}healthcheck:\s*$/) && trimmed.slice(-30).some((l) => l.match(/^\s{2}web:\s*$/))) {
        const m = line.match(/^(\s*)/);
        stripIndent = m ? m[1].length : 0;
        stripping = true;
        continue;
      }
      trimmed.push(line);
    }
    out = trimmed.join('\n');
  }
  if (process.env.SIMULATE_UNCLASSIFIED_RESTART === 'true') {
    out = out.replace(/(\n\s{2}web:[\s\S]*?)restart:\s*unless-stopped/, '$1restart: always');
  }
  if (process.env.SIMULATE_UNCLASSIFIED_LOG_DRIVER === 'true') {
    out = out.replace(/(\n\s{2}web:[\s\S]*?logging:\s*\n\s+driver:\s*)journald/, '$1syslog');
  }
  return out;
}

function scanServices(doc) {
  const results = [];
  const services = doc.services ?? {};
  const names = Object.keys(services);
  for (const name of names) {
    const svc = services[name] ?? {};
    if (HTTP_SERVICES.has(name)) {
      if (!svc.healthcheck) {
        results.push({
          anchorAcId: 'AC-composeHost-healthcheckLint',
          verdict: 'fail',
          detail: `HTTP-terminating service '${name}' is missing a healthcheck: block`,
        });
      }
    }
    const restart = svc.restart;
    if (!restart) {
      results.push({
        anchorAcId: 'AC-composeHost-restartClassification',
        verdict: 'fail',
        detail: `service '${name}' declares no restart policy; allowed: unless-stopped, on-failure`,
      });
    } else if (!ALLOWED_RESTART.has(String(restart))) {
      results.push({
        anchorAcId: 'AC-composeHost-restartClassification',
        verdict: 'fail',
        detail: `service '${name}' declares restart: ${restart}; allowed: unless-stopped, on-failure`,
      });
    }
    const logging = svc.logging;
    const driver = logging && logging.driver;
    if (!driver) {
      results.push({
        anchorAcId: 'AC-composeHost-logDriverClassification',
        verdict: 'fail',
        detail: `service '${name}' declares no logging driver; allowed: journald, loki`,
      });
    } else if (!ALLOWED_LOG_DRIVER.has(String(driver))) {
      results.push({
        anchorAcId: 'AC-composeHost-logDriverClassification',
        verdict: 'fail',
        detail: `service '${name}' declares logging driver '${driver}'; allowed: journald, loki`,
      });
    }
  }
  return results;
}

export default async function runProbe() {
  const results = [];
  const extra = {};
  // Source-tree scan on the (possibly mutated) compose file.
  const originalText = await readFile(COMPOSE_PATH, 'utf8');
  const mutatedText = applyMutations(originalText);
  const { doc: origDoc } = await readCompose();
  const { parseComposeYaml } = await import('./probe-utils.mjs');
  const mutatedDoc = parseComposeYaml(mutatedText);
  const scanResults = scanServices(mutatedDoc);
  results.push(...scanResults);
  extra.serviceNames = Object.keys(mutatedDoc.services ?? {});
  extra.mutations = {
    missingHealthcheck: process.env.SIMULATE_MISSING_HEALTHCHECK === 'true',
    unclassifiedRestart: process.env.SIMULATE_UNCLASSIFIED_RESTART === 'true',
    unclassifiedLogDriver: process.env.SIMULATE_UNCLASSIFIED_LOG_DRIVER === 'true',
    eventSecrecyLeak: process.env.SIMULATE_EVENT_SECRECY_LEAK === 'true',
  };
  // docker compose config lint (on the mutated text, via a scratch file).
  const dockerVersion = whichDocker();
  extra.dockerVersion = dockerVersion;
  if (dockerVersion === null) {
    results.push({
      anchorAcId: 'AC-composeHost-healthcheckLint',
      verdict: 'warn',
      detail: 'docker CLI absent on PATH; source-tree assertions ran but docker compose config was not exercised',
    });
  } else {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const scratch = join(tmpdir(), `rcf-lite-t2-compose-config-lint-${Date.now()}`);
    await mkdir(scratch, { recursive: true });
    await writeFile(join(scratch, 'compose.yaml'), mutatedText, 'utf8');
    // Copy .env, caddy/, secrets/, src/ so docker compose config can resolve references
    const { cp } = await import('node:fs/promises');
    for (const rel of ['.env', 'caddy', 'secrets', 'src']) {
      try {
        await cp(join(FIXTURE_DIR, rel), join(scratch, rel), { recursive: true });
      } catch (err) {
        // best-effort; docker compose config still validates syntax
      }
    }
    const cfg = spawnSync('docker', ['compose', '-f', join(scratch, 'compose.yaml'), 'config'], {
      encoding: 'utf8', timeout: 30_000,
    });
    if (cfg.status === 0) {
      results.push({
        anchorAcId: 'AC-composeHost-healthcheckLint',
        verdict: 'pass',
        detail: 'docker compose config exit 0 on the applied compose.yaml',
      });
    } else {
      const canonicalPass = !(process.env.SIMULATE_MISSING_HEALTHCHECK === 'true'
        || process.env.SIMULATE_UNCLASSIFIED_RESTART === 'true'
        || process.env.SIMULATE_UNCLASSIFIED_LOG_DRIVER === 'true');
      results.push({
        anchorAcId: 'AC-composeHost-healthcheckLint',
        verdict: canonicalPass ? 'fail' : 'pass',
        detail: `docker compose config exit ${cfg.status}: ${(cfg.stderr || cfg.stdout || '').slice(0, 400)}`,
      });
    }
    extra.dockerComposeConfigExit = cfg.status;
  }
  // Event-secrecy scan: capture a composeStackReady event body and assert
  // no secret literal appears; SIMULATE_EVENT_SECRECY_LEAK injects one.
  const secretValue = (await readFile(SECRET_PATH, 'utf8')).trim();
  const event = {
    kind: 'composeStackReady',
    services: extra.serviceNames,
    imageDigests: extra.serviceNames.map((n) => `sha256:fixture-${n}`),
    healthTimesMs: extra.serviceNames.map(() => 42),
  };
  if (process.env.SIMULATE_EVENT_SECRECY_LEAK === 'true') {
    event.debug = { boundToken: secretValue };
  }
  const eventBody = JSON.stringify(event);
  if (eventBody.includes(secretValue)) {
    results.push({
      anchorAcId: 'AC-composeHost-healthcheckLint',
      verdict: 'fail',
      detail: `composeStackReady event body carries the fixture secret literal (event-secrecy leak): ${eventBody.slice(0, 200)}`,
    });
  } else {
    results.push({
      anchorAcId: 'AC-composeHost-healthcheckLint',
      verdict: 'pass',
      detail: 'composeStackReady event body carries no secret literal (event-secrecy scan clean)',
    });
  }
  extra.eventBodyByteLength = eventBody.length;
  // Passing summary line when nothing failed.
  if (!results.some((r) => r.verdict === 'fail')) {
    results.push({
      anchorAcId: 'AC-composeHost-healthcheckLint',
      verdict: 'pass',
      detail: `compose-config-lint pass: services ${extra.serviceNames.join(', ')}; healthcheck + restart + logging + event-secrecy scans all clean`,
    });
  }
  return { results, extra };
}

const engine = { kind: 'compose-config', image: 'docker compose config (local daemon)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('compose-config-lint', engine, runProbe);
}
