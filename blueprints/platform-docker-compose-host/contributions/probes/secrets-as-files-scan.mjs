// Probe: secrets-as-files-scan (v1.1.4 closure fix).
//
// anchorAcIds: AC-composeHost-secretsAreFiles (primary),
// AC-composeHost-secretShape.
// accountBound: false.
//
// Every result row carries an `evidence` object (Addendum rule 3).
//
// Scans:
//   - compose.yaml: every declared secret references a file: source
//     (secretShape); every service that references a secret does so via
//     the secrets: block, never as an environment entry.
//   - .env: no plaintext token literal appears (env file).
//   - caddy/**: no plaintext token literal appears in service configs.
//   - compose.yaml itself: no plaintext token literal (canonical + a
//     scratch copy under SIMULATE_PLAINTEXT_SECRET).

import { readFile, cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
          evidence: { secretName: name, spec },
        });
      } else {
        results.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'pass',
          detail: `compose secret '${name}' declares file: ${spec.file}`,
          evidence: { secretName: name, fileSource: spec.file },
        });
      }
    }
    // Every service that references a secret does so via the service
    // secrets: block; a secret name appearing in a service's env or
    // environment array fails.
    const services = doc.services ?? {};
    for (const [svcName, svc] of Object.entries(services)) {
      const referencesInSecretsBlock = Array.isArray(svc && svc.secrets)
        ? svc.secrets.map((s) => (typeof s === 'string' ? s : (s && s.source) || null)).filter(Boolean)
        : [];
      const inlineEnvHits = [];
      const environment = (svc && svc.environment) || [];
      const envList = Array.isArray(environment) ? environment : Object.keys(environment).map((k) => `${k}=${environment[k]}`);
      for (const entry of envList) {
        for (const n of secretNames) {
          if (String(entry).includes(n) && !referencesInSecretsBlock.includes(n)) {
            inlineEnvHits.push({ envEntry: entry, secretName: n });
          }
        }
      }
      if (inlineEnvHits.length > 0) {
        results.push({
          anchorAcId: 'AC-composeHost-secretsAreFiles',
          verdict: 'fail',
          detail: `service '${svcName}' references secret(s) via environment entries: ${inlineEnvHits.map((h) => h.envEntry).join('; ')}`,
          evidence: { service: svcName, inlineHits: inlineEnvHits },
        });
      }
    }
    // Plaintext-literal scan across compose.yaml, .env and every file
    // under caddy/.
    const scanTargets = [composePathToScan, ENV_PATH];
    const caddyDir = resolve(FIXTURE_DIR, 'caddy');
    for (const f of await walkFiles(caddyDir)) scanTargets.push(f);
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
          evidence: { file: h.file, line: h.line, snippet: h.snippet },
        });
      }
    } else {
      results.push({
        anchorAcId: 'AC-composeHost-secretsAreFiles',
        verdict: 'pass',
        detail: `no plaintext secret literal for 'web-token' found in scanned compose.yaml, .env or caddy/ files`,
        evidence: {
          scannedFiles: scanTargets.map((f) => f.replace(FIXTURE_DIR + '/', '')),
          fileCount: scanTargets.length,
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
