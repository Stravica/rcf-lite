// Probe: secrets-as-files-scan (v1.1.5).

// anchorAcIds: AC-composeHost-secretsAreFiles (service-level reference
// shape rows), AC-composeHost-secretShape (top-level file: source
// rows). This offline probe cannot observe the in-container mode a
// compose stack applies at runtime; the mode observation belongs to
// real-account-minimal-stack-up, which runs
// `docker exec ... stat -c %a /run/secrets/<name>` inside every
// consuming container. The mode rows here are conformanceOnly with
// `notObservableHere.ac = 'AC-composeHost-secretShape'` and a
// limitation naming the AC clause the offline scan does not observe.
// accountBound: false.

// Every result row carries an `evidence` object with an identity key
// AND an observation key or a body excerpt / derived value.

// Scans:
//   - compose.yaml: every declared top-level secret references a
//     file: source (secretShape); every top-level secret has at
//     least one consuming service (a top-level entry no service
//     references is an orphan and fails).
//   - compose.yaml: for every consuming service, the reference lives
//     in the service-level secrets: array (never in environment).
//     A long-form entry with an explicit `mode` field is recorded
//     verbatim; missing modes are NOT assumed to be 0o400 here (that
//     assertion belongs to the real-account probe that observes the
//     mounted file inside the container).
//   - compose.yaml, .env, plus every file under every service's
//     bind-mount source directory (config discovery walks the compose
//     service list, not a hardcoded caddy/ dir): no plaintext token
//     literal appears.
//   - The mutation switch SIMULATE_PLAINTEXT_SECRET writes a plaintext
//     literal into a scratch copy of compose.yaml and the probe FAILS
//     naming file+line.

import { readFile, cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, isAbsolute, relative } from 'node:path';
import { runShim, readCompose, COMPOSE_PATH, SECRET_PATH, ENV_PATH, FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcIds = [
  'AC-composeHost-secretsAreFiles',
  'AC-composeHost-secretShape',
];
export const accountBound = false;

async function walkFiles(root) {
  const out = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(root, e.name);
    if (e.isDirectory()) {
      out.push(...await walkFiles(full));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function applyPlaintextMutation() {
  const scratch = join(tmpdir(), `rcf-lite-t2-secrets-scan-${Date.now()}`);
  await mkdir(scratch, { recursive: true });
  await cp(FIXTURE_DIR, scratch, { recursive: true });
  const composePath = join(scratch, 'compose.yaml');
  let text = await readFile(composePath, 'utf8');
  const secret = (await readFile(SECRET_PATH, 'utf8')).trim();
  text = text.replace(/(\n    env_file:\n)/, `\n    environment:\n      - WEB_TOKEN=${secret}\n$1`);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(composePath, text, 'utf8');
  return { scratch, composePath };
}

async function scanFileForLiteral(file, secret) {
  try {
    const s = await stat(file);
    if (s.size > 4 * 1024 * 1024) return []; // skip large binaries
    const text = await readFile(file, 'utf8');
    const hits = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(secret)) {
        hits.push({ file, line: i + 1, snippet: lines[i].trim().slice(0, 200) });
      }
    }
    return hits;
  } catch (_) {
    return [];
  }
}

// Enumerate every filesystem source referenced by every service in the
// applied compose.yaml. Handles both short-form (`- ./caddy:/etc/caddy:ro`)
// and long-form (`- type: bind, source: ./caddy, target: ...`) volume
// entries.
function collectServiceConfigSources(doc, composeDir) {
  const sources = new Set();
  const services = doc.services ?? {};
  for (const [, svc] of Object.entries(services)) {
    const vols = (svc && svc.volumes) || [];
    if (!Array.isArray(vols)) continue;
    for (const v of vols) {
      if (typeof v === 'string') {
        // Short-form: SRC:TARGET[:MODE] - extract the SRC before the
        // first colon; if it starts with ./ or / or ~, treat as a path.
        const idx = v.indexOf(':');
        if (idx <= 0) continue;
        const src = v.slice(0, idx);
        if (src.startsWith('./') || src.startsWith('/') || src.startsWith('~')) {
          sources.add(isAbsolute(src) ? src : resolve(composeDir, src));
        }
      } else if (v && typeof v === 'object') {
        if (v.type === 'bind' && typeof v.source === 'string') {
          sources.add(isAbsolute(v.source) ? v.source : resolve(composeDir, v.source));
        }
      }
    }
  }
  return [...sources];
}

// Return the mode declared for a service-level secrets entry (if any).
// Compose long-form: - source: web-token, mode: 0400 (as int or oct).
function getServiceSecretMode(svcSecretsEntry) {
  if (typeof svcSecretsEntry === 'string') return null; // short-form: mode not declared here
  if (svcSecretsEntry && typeof svcSecretsEntry === 'object') {
    if (svcSecretsEntry.mode === undefined || svcSecretsEntry.mode === null) return null;
    return svcSecretsEntry.mode;
  }
  return null;
}

export default async function runProbe() {
  const results = [];
  const extra = {};
  const secret = (await readFile(SECRET_PATH, 'utf8')).trim();
  const mutationOn = process.env.SIMULATE_PLAINTEXT_SECRET === 'true';
  extra.mutations = { plaintextSecret: mutationOn };
  let composePathToScan = COMPOSE_PATH;
  let scratchToClean = null;
  if (mutationOn) {
    const m = await applyPlaintextMutation();
    composePathToScan = m.composePath;
    scratchToClean = m.scratch;
  }
  try {
    const { doc } = await readCompose();
    const secretsBlock = doc.secrets ?? {};
    const secretNames = Object.keys(secretsBlock);
    extra.declaredSecrets = secretNames;

    // Per-declared-secret shape row (AC-composeHost-secretShape): the
    // file: source clause of the AC.
    for (const name of secretNames) {
      const spec = secretsBlock[name] ?? {};
      if (!spec.file) {
        results.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'fail',
          detail: `compose secret '${name}' is not a file: source`,
          evidence: { secretName: name, spec, expected: 'file: <path>' },
        });
      } else {
        results.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'pass',
          detail: `compose secret '${name}' declares file: ${spec.file}`,
          evidence: { secretName: name, fileSource: spec.file, source: 'compose.yaml top-level secrets block' },
        });
      }
    }

    // Consuming-service row: every top-level secret must be
    // referenced by at least one service (an orphan top-level entry
    // is a defect).
    const services = doc.services ?? {};
    const consumerBySecret = {};
    for (const name of secretNames) consumerBySecret[name] = [];
    for (const [svcName, svc] of Object.entries(services)) {
      const svcSecrets = Array.isArray(svc && svc.secrets) ? svc.secrets : [];
      for (const entry of svcSecrets) {
        const secretName = typeof entry === 'string' ? entry : (entry && entry.source) || null;
        if (secretName && secretNames.includes(secretName)) consumerBySecret[secretName].push(svcName);
      }
    }
    for (const name of secretNames) {
      const consumers = consumerBySecret[name];
      if (consumers.length === 0) {
        results.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'fail',
          detail: `compose secret '${name}' is declared at the top level but no service references it via the service-level secrets: array (orphan)`,
          evidence: { secretName: name, consumingServices: [], expected: 'at least one consuming service' },
        });
      } else {
        results.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'pass',
          detail: `compose secret '${name}' is referenced by ${consumers.length} service(s): ${consumers.join(', ')}`,
          evidence: { secretName: name, consumingServices: consumers, source: 'compose.yaml services block' },
        });
      }
    }

    // Service-level shape rows (AC-composeHost-secretsAreFiles):
    // every service-level reference must live in the service secrets:
    // array (never in env), and long-form entries carry their mode
    // verbatim into the evidence. The AC's "mounted 0o400" clause is
    // observed by the real-account probe (docker exec stat), not
    // here.
    for (const [svcName, svc] of Object.entries(services)) {
      const svcSecrets = Array.isArray(svc && svc.secrets) ? svc.secrets : [];
      for (const entry of svcSecrets) {
        const secretName = typeof entry === 'string' ? entry : (entry && entry.source) || null;
        if (!secretName) continue;
        if (!secretNames.includes(secretName)) {
          results.push({
            anchorAcId: 'AC-composeHost-secretsAreFiles',
            verdict: 'fail',
            detail: `service '${svcName}' references undeclared secret '${secretName}' via the service-level secrets: block`,
            evidence: { service: svcName, secretName, declaredSecrets: secretNames },
          });
          continue;
        }
        const declaredMode = getServiceSecretMode(entry);
        results.push({
          anchorAcId: 'AC-composeHost-secretsAreFiles',
          verdict: 'pass',
          detail: `service '${svcName}' references secret '${secretName}' via service-level secrets: (declaredMode=${declaredMode === null ? 'unset' : String(declaredMode)})`,
          evidence: {
            service: svcName,
            secretName,
            declaredMode: declaredMode === null ? 'unset' : String(declaredMode),
            source: 'compose.yaml service secrets: block',
          },
        });
        // Mode row: this offline scan CANNOT observe the in-container
        // mode. De-claim the row so no invented "default 0o400" claim
        // reaches the record.
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: 'offline scan cannot observe the in-container mode; AC-composeHost-secretShape "mounted at mode 0o400" clause is observed by real-account-minimal-stack-up which runs docker exec stat -c %a inside the consuming container.',
          notObservableHere: { ac: 'AC-composeHost-secretShape' },
          verdict: 'pass',
          detail: `service '${svcName}' secret '${secretName}' declaredMode=${declaredMode === null ? 'unset' : String(declaredMode)}; in-container mode observation lives on the real-account probe.`,
          evidence: {
            service: svcName,
            secretName,
            declaredMode: declaredMode === null ? 'unset' : String(declaredMode),
            source: 'compose.yaml service secrets: block',
          },
        });
      }
      // A service that mentions a secret NAME in env or environment
      // without a corresponding service-level secrets: entry fails.
      const environment = (svc && svc.environment) || [];
      const envList = Array.isArray(environment) ? environment : Object.keys(environment).map((k) => `${k}=${environment[k]}`);
      const svcSecretRefNames = svcSecrets.map((e) => (typeof e === 'string' ? e : (e && e.source) || null)).filter(Boolean);
      for (const entry of envList) {
        for (const n of secretNames) {
          if (String(entry).includes(n) && !svcSecretRefNames.includes(n)) {
            results.push({
              anchorAcId: 'AC-composeHost-secretsAreFiles',
              verdict: 'fail',
              detail: `service '${svcName}' references secret '${n}' via environment entry '${entry}' instead of the service-level secrets: block`,
              evidence: { service: svcName, envEntry: String(entry), secretName: n },
            });
          }
        }
      }
    }

    // Config discovery: walk every service's bind mount source, not a
    // hardcoded caddy/ dir.
    const composeDir = dirname(composePathToScan);
    const scanTargets = [composePathToScan, ENV_PATH];
    const configSources = collectServiceConfigSources(doc, composeDir);
    extra.discoveredConfigSources = configSources.map((p) => relative(FIXTURE_DIR, p));
    for (const src of configSources) {
      try {
        const s = await stat(src);
        if (s.isDirectory()) {
          for (const f of await walkFiles(src)) scanTargets.push(f);
        } else if (s.isFile()) {
          scanTargets.push(src);
        }
      } catch (_) { /* skip missing/unresolvable sources */ }
    }

    // Plaintext-literal scan across every discovered target.
    const allHits = [];
    for (const t of scanTargets) {
      allHits.push(...await scanFileForLiteral(t, secret));
    }
    if (allHits.length > 0) {
      for (const h of allHits) {
        results.push({
          anchorAcId: 'AC-composeHost-secretsAreFiles',
          verdict: 'fail',
          detail: `plaintext secret literal for 'web-token' found in ${h.file}:${h.line} (snippet: ${h.snippet})`,
          evidence: { file: h.file, line: h.line, snippet: h.snippet, secretName: 'web-token' },
        });
      }
    } else {
      results.push({
        anchorAcId: 'AC-composeHost-secretsAreFiles',
        verdict: 'pass',
        detail: `no plaintext secret literal for 'web-token' found across ${scanTargets.length} scanned files (compose.yaml, .env, and every file under each service's bind-mount source)`,
        evidence: {
          scannedFiles: scanTargets.map((f) => f.replace(FIXTURE_DIR + '/', '')),
          fileCount: scanTargets.length,
          discoveredConfigSources: extra.discoveredConfigSources,
          secretName: 'web-token',
        },
      });
    }
    extra.scannedFileCount = scanTargets.length;
  } finally {
    if (scratchToClean) await rm(scratchToClean, { recursive: true, force: true });
  }
  return { results, extra };
}

const engine = { kind: 'source-scan', image: 'in-process compose + secret grep', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('secrets-as-files-scan', engine, runProbe);
}
