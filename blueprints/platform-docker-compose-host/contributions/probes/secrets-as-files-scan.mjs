// Probe: secrets-as-files-scan (v1.1.8).
//
// This is an offline scanner: it reads the shipped compose.yaml,
// the shipped .env, and every file under every declared service
// bind-mount source, looking for a plaintext-token literal and for
// the file-source shape of every top-level secret. It has no
// engine-minted identifier - the sha256 of compose.yaml is
// computed by this probe with Node's `createHash` and the service
// and secret names are Compose's own choices, not engine-returned
// identities.
//
// Every result row is a `conformanceOnly` de-claim naming the
// shipped AC clause the offline scan does not observe. The live
// observation for both AC-composeHost-secretShape ("mounted 0o400"
// clause, in-container stat) and AC-composeHost-secretsAreFiles
// (service secrets actually mounted, not present in env) lives on
// `real-account-minimal-stack-up`, which runs
// `docker exec ... stat -c %a /run/secrets/<name>` inside every
// consuming container. The mode observation belongs there, not to
// this offline scan.
//
// accountBound: false.
//
// Scans:
//   - compose.yaml: every declared top-level secret references a
//     file: source (secretShape); every top-level secret has at
//     least one consuming service (an orphan top-level entry fails).
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
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, isAbsolute, relative } from 'node:path';
import { runShim, readCompose, COMPOSE_PATH, SECRET_PATH, ENV_PATH, FIXTURE_DIR } from './probe-utils.mjs';

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const anchorAcIds = [];
export const accountBound = false;

const LIMIT_SHAPE = 'AC-composeHost-secretShape: top-level `file:` source is validated offline against the shipped compose.yaml; the live observation ("mounted at mode 0o400" clause, in-container `stat -c %a /run/secrets/<name>`) is carried by real-account-minimal-stack-up.';
const LIMIT_FILES = 'AC-composeHost-secretsAreFiles: service-level secrets: reference shape is validated offline against the shipped compose.yaml; the live observation (the service consuming the file mount inside the container) is carried by real-account-minimal-stack-up.';

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

function collectServiceConfigSources(doc, composeDir) {
  const sources = new Set();
  const services = doc.services ?? {};
  for (const [, svc] of Object.entries(services)) {
    const vols = (svc && svc.volumes) || [];
    if (!Array.isArray(vols)) continue;
    for (const v of vols) {
      if (typeof v === 'string') {
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

function getServiceSecretMode(svcSecretsEntry) {
  if (typeof svcSecretsEntry === 'string') return null;
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
    const composeTextForHash = await readFile(composePathToScan, 'utf8');
    const composeSha256 = sha256(composeTextForHash);
    const { doc } = await readCompose();
    const secretsBlock = doc.secrets ?? {};
    const secretNames = Object.keys(secretsBlock);
    extra.declaredSecrets = secretNames;

    for (const name of secretNames) {
      const spec = secretsBlock[name] ?? {};
      if (!spec.file) {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_SHAPE,
          verdict: 'fail',
          detail: `offline secrets-as-files-scan: compose secret '${name}' is not a file: source`,
          evidence: { composeSha256, declaredSecretName: name, spec, expectedShape: 'file: <path>' },
        });
      } else {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_SHAPE,
          verdict: 'pass',
          detail: `offline secrets-as-files-scan: compose secret '${name}' declares file: ${spec.file}`,
          evidence: { composeSha256, declaredSecretName: name, fileSource: spec.file, scannedFrom: 'compose.yaml top-level secrets block' },
        });
      }
    }

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
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_SHAPE,
          verdict: 'fail',
          detail: `offline secrets-as-files-scan: compose secret '${name}' is declared at the top level but no service references it via the service-level secrets: array (orphan)`,
          evidence: { composeSha256, declaredSecretName: name, consumingServices: [], expectedShape: 'at least one consuming service' },
        });
      } else {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_SHAPE,
          verdict: 'pass',
          detail: `offline secrets-as-files-scan: compose secret '${name}' is referenced by ${consumers.length} service(s): ${consumers.join(', ')}`,
          evidence: { composeSha256, declaredSecretName: name, consumingServices: consumers, scannedFrom: 'compose.yaml services block' },
        });
      }
    }

    for (const [svcName, svc] of Object.entries(services)) {
      const svcSecrets = Array.isArray(svc && svc.secrets) ? svc.secrets : [];
      for (const entry of svcSecrets) {
        const secretName = typeof entry === 'string' ? entry : (entry && entry.source) || null;
        if (!secretName) continue;
        if (!secretNames.includes(secretName)) {
          results.push({
            anchorAcId: null,
            conformanceOnly: true,
            limitation: LIMIT_FILES,
            verdict: 'fail',
            detail: `offline secrets-as-files-scan: service '${svcName}' references undeclared secret '${secretName}' via the service-level secrets: block`,
            evidence: { composeSha256, serviceName: svcName, declaredSecretName: secretName, declaredSecrets: secretNames },
          });
          continue;
        }
        const declaredMode = getServiceSecretMode(entry);
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_FILES,
          verdict: 'pass',
          detail: `offline secrets-as-files-scan: service '${svcName}' references secret '${secretName}' via service-level secrets: (declaredMode=${declaredMode === null ? 'unset' : String(declaredMode)})`,
          evidence: {
            composeSha256,
            serviceName: svcName,
            declaredSecretName: secretName,
            declaredMode: declaredMode === null ? 'unset' : String(declaredMode),
            scannedFrom: 'compose.yaml service secrets: block',
          },
        });
      }
      const environment = (svc && svc.environment) || [];
      const envList = Array.isArray(environment) ? environment : Object.keys(environment).map((k) => `${k}=${environment[k]}`);
      const svcSecretRefNames = svcSecrets.map((e) => (typeof e === 'string' ? e : (e && e.source) || null)).filter(Boolean);
      for (const entry of envList) {
        for (const n of secretNames) {
          if (String(entry).includes(n) && !svcSecretRefNames.includes(n)) {
            results.push({
              anchorAcId: null,
              conformanceOnly: true,
              limitation: LIMIT_FILES,
              verdict: 'fail',
              detail: `offline secrets-as-files-scan: service '${svcName}' references secret '${n}' via environment entry '${entry}' instead of the service-level secrets: block`,
              evidence: { composeSha256, serviceName: svcName, envEntry: String(entry), declaredSecretName: n },
            });
          }
        }
      }
    }

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

    const allHits = [];
    for (const t of scanTargets) {
      allHits.push(...await scanFileForLiteral(t, secret));
    }
    if (allHits.length > 0) {
      for (const h of allHits) {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_FILES,
          verdict: 'fail',
          detail: `offline secrets-as-files-scan: plaintext secret literal for 'web-token' found in ${h.file}:${h.line} (snippet: ${h.snippet})`,
          evidence: { composeSha256, scannedFile: h.file, lineNumber: h.line, snippet: h.snippet, declaredSecretName: 'web-token' },
        });
      }
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_FILES,
        verdict: 'pass',
        detail: `offline secrets-as-files-scan: no plaintext secret literal for 'web-token' found across ${scanTargets.length} scanned files (compose.yaml, .env, and every file under each service's bind-mount source)`,
        evidence: {
          composeSha256,
          scannedFilenames: scanTargets.map((f) => f.replace(FIXTURE_DIR + '/', '')),
          fileCount: scanTargets.length,
          discoveredConfigSources: extra.discoveredConfigSources,
          declaredSecretName: 'web-token',
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
