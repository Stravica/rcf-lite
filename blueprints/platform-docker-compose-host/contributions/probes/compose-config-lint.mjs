// Probe: compose-config-lint (v1.1.8).
//
// This is an offline validator: it parses the shipped compose.yaml
// and (when a Docker daemon is reachable) shells out to
// `docker compose config`. It has no engine-minted identifier - the
// sha256 of compose.yaml is computed by this probe with Node's
// `createHash` and the service names are Compose's own choices, not
// engine-returned identities. Every result row is a
// `conformanceOnly` de-claim naming the shipped AC clause the
// offline check does not observe; the live observation for each
// property lives on the account-bound probes that stand a real
// compose stack up.
//
// Splits per-property observations into their own result rows:
//   - AC-composeHost-healthcheckLint  per HTTP-terminating service.
//   - AC-composeHost-restartClassification  per service.
//   - AC-composeHost-logDriverClassification  per service, and one
//     top-level check that every service uses the single elicited
//     driver (LOG_DRIVER env, default journald).
//   - AC-composeHost-healthcheckLint  one summary docker-compose-config
//     exit row when the daemon is reachable.
//
// The compose.yaml bytes hash and the observed values (driver,
// restart policy, healthcheck keys, docker compose config exit)
// stay on the row as derived context.
//
// accountBound: false.

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runShim, readCompose, COMPOSE_PATH, FIXTURE_DIR, whichDocker, parseComposeYaml } from './probe-utils.mjs';

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const anchorAcIds = [];
export const accountBound = false;

const HTTP_SERVICES = new Set(['web', 'caddy']);
const ALLOWED_RESTART = new Set(['unless-stopped', 'on-failure']);
const ALLOWED_LOG_DRIVER = new Set(['journald', 'loki']);

const LIMIT_HC = 'AC-composeHost-healthcheckLint: healthcheck presence is validated offline against the shipped compose.yaml; the live observation (a healthy compose service reporting healthy in `docker compose ps`) is carried by real-account-minimal-stack-up.';
const LIMIT_RESTART = 'AC-composeHost-restartClassification: restart-policy classification is validated offline against the shipped compose.yaml; the live observation (a compose stack applying and honouring the policy) is carried by real-account-minimal-stack-up.';
const LIMIT_LOG = 'AC-composeHost-logDriverClassification: log-driver classification is validated offline against the shipped compose.yaml against the elicited LOG_DRIVER; the live observation (a compose stack routing logs through the applied driver) lives on the account-bound branch.';

function applyMutations(text) {
  let out = text;
  if (process.env.SIMULATE_MISSING_HEALTHCHECK === 'true') {
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

function scanHealthchecks(doc, extra, composeSha256) {
  const results = [];
  const services = doc.services ?? {};
  const httpNames = Object.keys(services).filter((n) => HTTP_SERVICES.has(n));
  for (const name of httpNames) {
    const svc = services[name] ?? {};
    if (!svc.healthcheck) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_HC,
        verdict: 'fail',
        detail: `offline compose-config-lint: HTTP-terminating service '${name}' is missing a healthcheck: block`,
        evidence: { composeSha256, serviceName: name, missingServices: [name], expectedShape: 'healthcheck block', observedShape: 'absent' },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_HC,
        verdict: 'pass',
        detail: `offline compose-config-lint: HTTP-terminating service '${name}' carries a healthcheck: block`,
        evidence: {
          composeSha256,
          serviceName: name,
          healthcheckKeys: Object.keys(svc.healthcheck || {}).sort(),
        },
      });
    }
  }
  return results;
}

function scanRestart(doc, composeSha256) {
  const results = [];
  const services = doc.services ?? {};
  for (const name of Object.keys(services)) {
    const svc = services[name] ?? {};
    const restart = svc.restart;
    if (!restart) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_RESTART,
        verdict: 'fail',
        detail: `offline compose-config-lint: service '${name}' declares no restart policy; allowed: unless-stopped, on-failure`,
        evidence: { composeSha256, serviceName: name, restart: null },
      });
    } else if (!ALLOWED_RESTART.has(String(restart))) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_RESTART,
        verdict: 'fail',
        detail: `offline compose-config-lint: service '${name}' declares restart: ${restart}; allowed: unless-stopped, on-failure`,
        evidence: { composeSha256, serviceName: name, restart: String(restart), allowed: ['unless-stopped', 'on-failure'] },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_RESTART,
        verdict: 'pass',
        detail: `offline compose-config-lint: service '${name}' declares restart: ${restart}`,
        evidence: { composeSha256, serviceName: name, restart: String(restart) },
      });
    }
  }
  return results;
}

function scanLogging(doc, composeSha256) {
  const results = [];
  const services = doc.services ?? {};
  const elicitedDriver = process.env.LOG_DRIVER || 'journald';
  const observedDrivers = [];
  for (const name of Object.keys(services)) {
    const svc = services[name] ?? {};
    const driver = svc.logging && svc.logging.driver;
    if (!driver) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_LOG,
        verdict: 'fail',
        detail: `offline compose-config-lint: service '${name}' declares no logging driver; allowed: journald, loki`,
        evidence: { composeSha256, serviceName: name, driver: null },
      });
      observedDrivers.push(null);
      continue;
    }
    if (!ALLOWED_LOG_DRIVER.has(String(driver))) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_LOG,
        verdict: 'fail',
        detail: `offline compose-config-lint: service '${name}' declares logging driver '${driver}'; allowed: journald, loki`,
        evidence: { composeSha256, serviceName: name, driver: String(driver), allowed: ['journald', 'loki'] },
      });
      observedDrivers.push(String(driver));
      continue;
    }
    observedDrivers.push(String(driver));
  }
  const distinct = new Set(observedDrivers.filter(Boolean));
  if (distinct.size > 1) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMIT_LOG,
      verdict: 'fail',
      detail: `offline compose-config-lint: services declare more than one log driver (${[...distinct].join(', ')}); the elicited log-driver=${elicitedDriver} requires every service to match`,
      evidence: { composeSha256, composeFile: 'compose.yaml', elicitedDriver, observedDrivers, distinct: [...distinct] },
    });
  } else if (distinct.size === 1 && !distinct.has(elicitedDriver)) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMIT_LOG,
      verdict: 'fail',
      detail: `offline compose-config-lint: services declare log driver ${[...distinct][0]} but the elicited log-driver is ${elicitedDriver}`,
      evidence: { composeSha256, composeFile: 'compose.yaml', elicitedDriver, observedDrivers },
    });
  } else if (distinct.size === 1) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMIT_LOG,
      verdict: 'pass',
      detail: `offline compose-config-lint: every service uses the elicited log driver ${[...distinct][0]}`,
      evidence: { composeSha256, composeFile: 'compose.yaml', elicitedDriver, observedDrivers },
    });
  }
  return results;
}

export default async function runProbe() {
  const results = [];
  const extra = {};
  const originalText = await readFile(COMPOSE_PATH, 'utf8');
  const mutatedText = applyMutations(originalText);
  const composeSha256 = sha256(mutatedText);
  extra.composeSha256 = composeSha256;
  const mutatedDoc = parseComposeYaml(mutatedText);
  extra.serviceNames = Object.keys(mutatedDoc.services ?? {});
  extra.mutations = {
    missingHealthcheck: process.env.SIMULATE_MISSING_HEALTHCHECK === 'true',
    unclassifiedRestart: process.env.SIMULATE_UNCLASSIFIED_RESTART === 'true',
    unclassifiedLogDriver: process.env.SIMULATE_UNCLASSIFIED_LOG_DRIVER === 'true',
  };
  results.push(...scanHealthchecks(mutatedDoc, extra, composeSha256));
  results.push(...scanRestart(mutatedDoc, composeSha256));
  results.push(...scanLogging(mutatedDoc, composeSha256));
  const dockerVersion = whichDocker();
  extra.dockerVersion = dockerVersion;
  if (dockerVersion === null) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMIT_HC,
      verdict: 'warn',
      detail: 'offline compose-config-lint: docker CLI absent on PATH; source-tree assertions ran but docker compose config was not exercised',
      evidence: { composeSha256, dockerLocal: null },
    });
  } else {
    const { writeFile, mkdir, cp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const scratch = join(tmpdir(), `rcf-lite-t2-compose-config-lint-${Date.now()}`);
    await mkdir(scratch, { recursive: true });
    await writeFile(join(scratch, 'compose.yaml'), mutatedText, 'utf8');
    for (const rel of ['.env', 'caddy', 'secrets', 'src']) {
      try {
        await cp(join(FIXTURE_DIR, rel), join(scratch, rel), { recursive: true });
      } catch (err) {
        // best-effort
      }
    }
    const cfg = spawnSync('docker', ['compose', '-f', join(scratch, 'compose.yaml'), 'config'], {
      encoding: 'utf8', timeout: 30_000,
    });
    if (cfg.status === 0) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_HC,
        verdict: 'pass',
        detail: `offline compose-config-lint: docker compose config exit 0 (docker ${dockerVersion})`,
        evidence: {
          composeSha256,
          composeFile: 'compose.yaml',
          dockerVersion,
          engineNote: 'Docker Engine (compose sub-command); vendor documentation https://docs.docker.com/compose/compose-file/, verifiedOn 2026-09-11',
          exitStatus: 0,
        },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_HC,
        verdict: 'fail',
        detail: `offline compose-config-lint: docker compose config exit ${cfg.status}: ${(cfg.stderr || cfg.stdout || '').slice(0, 400)}`,
        evidence: {
          composeSha256,
          composeFile: 'compose.yaml',
          dockerVersion,
          exitStatus: cfg.status,
          stderr: (cfg.stderr || '').slice(0, 400),
        },
      });
    }
    extra.dockerComposeConfigExit = cfg.status;
  }
  return { results, extra };
}

const engine = { kind: 'compose-config', image: 'docker compose config (local daemon)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('compose-config-lint', engine, runProbe);
}
