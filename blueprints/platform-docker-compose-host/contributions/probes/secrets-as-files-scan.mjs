// Probe: secrets-as-files-scan (v1.1.4 closure re-run fix).
//
// anchorAcIds: AC-composeHost-secretsAreFiles (primary),
// AC-composeHost-secretShape.
// accountBound: false.
//
// Every result row carries an `evidence` object (Addendum rule 3).
//
// Scans (reclosure Item 11):
//   - compose.yaml: every declared secret references a file: source
//     (secretShape); AND for every consuming service, the reference
//     lives in the service-level secrets: array (not env); AND the
//     mounted mode (if declared) is 0o400.
//   - compose.yaml, .env, plus EVERY file under EVERY service's
//     bind-mount source directory (config discovery walks the compose
//     service list, not the hardcoded caddy/ dir): no plaintext token
//     literal appears.
//   - The mutation switch SIMULATE_PLAINTEXT_SECRET writes a plaintext
//     literal into compose.yaml and the probe FAILS naming file+line.

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
// entries. Reclosure Item 11: config discovery was hardcoded to caddy/.
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
  if (typeof svcSecretsEntry === 'string') return null; // short-form: no explicit mode, default 0o400
  if (svcSecretsEntry && typeof svcSecretsEntry === 'object') {
    if (svcSecretsEntry.mode === undefined || svcSecretsEntry.mode === null) return null;
    return svcSecretsEntry.mode;
  }
  return null;
}

function isAcceptableSecretMode(mode) {
  // Compose supports both int (256 = 0o400) and octal literal (0o400
  // or 0400 in YAML). We accept only 0o400 / 256; anything else fails.
  if (mode === null || mode === undefined) return true; // default = 0o400
  if (mode === 256) return true;
  if (typeof mode === 'string') {
    const trimmed = mode.trim();
    if (trimmed === '0400' || trimmed === '0o400' || trimmed === '400') return true;
    return false;
  }
  return false;
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

    // Per-declared-secret shape row (AC-composeHost-secretShape).
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

    // Reclosure Item 11: for every consuming service, VALIDATE that the
    // reference lives in the service-level secrets: array (not env),
    // AND the mounted mode (long-form only) is 0o400.
    const services = doc.services ?? {};
    for (const [svcName, svc] of Object.entries(services)) {
      const svcSecrets = Array.isArray(svc && svc.secrets) ? svc.secrets : [];
      // Row (per service+secret): service-level reference exists?
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
        const mode = getServiceSecretMode(entry);
        if (!isAcceptableSecretMode(mode)) {
          results.push({
            anchorAcId: 'AC-composeHost-secretsAreFiles',
            verdict: 'fail',
            detail: `service '${svcName}' mounts secret '${secretName}' with mode '${String(mode)}'; AC requires 0o400 (compose default)`,
            evidence: { service: svcName, secretName, mode: String(mode), expected: '0o400 (256) or unset (compose default)' },
          });
        } else {
          results.push({
            anchorAcId: 'AC-composeHost-secretsAreFiles',
            verdict: 'pass',
            detail: `service '${svcName}' references secret '${secretName}' via service-level secrets: (mode=${mode === null ? 'default 0o400' : String(mode)})`,
            evidence: { service: svcName, secretName, mode: mode === null ? 'default(0o400)' : String(mode), source: 'compose.yaml service secrets: block' },
          });
        }
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

    // Config discovery (reclosure Item 11): walk every service's bind
    // mount source, not the hardcoded caddy/ dir.
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
