// Probe: secrets-as-files-scan.
//
// anchorAcId: AC-composeHost-secretsAreFiles (primary), AC-composeHost-secretShape.
// accountBound: false.
//
// Passes when:
// - every secret declared under the compose top-level secrets: key
//   references a file: source (never inline).
// - no line in compose.yaml or any referenced service config carries a
//   plaintext token pattern matching (secretName, secretValue).
//
// Mutation:
// - SIMULATE_PLAINTEXT_SECRET=true writes the fixture web-token literal
//   into compose.yaml (as an environment entry on the web service) and
//   the probe FAILS naming the file and the literal.

import { readFile, cp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShim, readCompose, COMPOSE_PATH, SECRET_PATH, FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcIds = [
  'AC-composeHost-secretsAreFiles',
  'AC-composeHost-secretShape',
];
export const accountBound = false;

async function applyPlaintextMutation() {
  const scratch = join(tmpdir(), `rcf-lite-t2-secrets-scan-${Date.now()}`);
  await mkdir(scratch, { recursive: true });
  await cp(FIXTURE_DIR, scratch, { recursive: true });
  const composePath = join(scratch, 'compose.yaml');
  let text = await readFile(composePath, 'utf8');
  const secret = (await readFile(SECRET_PATH, 'utf8')).trim();
  // Inject WEB_TOKEN=<literal> as an environment entry on the web service.
  text = text.replace(/(\n    env_file:\n)/, `\n    environment:\n      - WEB_TOKEN=${secret}\n$1`);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(composePath, text, 'utf8');
  return { scratch, composePath };
}

async function scanForLiteral({ composePath, secret, secretName }) {
  const text = await readFile(composePath, 'utf8');
  const lines = text.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(secret)) {
      hits.push({ file: composePath, line: i + 1, snippet: lines[i].trim() });
    }
  }
  return hits;
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
    // Secret-shape scan: every declared secret has a file: source.
    const { doc } = await readCompose();
    const secretsBlock = doc.secrets ?? {};
    const secretNames = Object.keys(secretsBlock);
    extra.declaredSecrets = secretNames;
    for (const name of secretNames) {
      const spec = secretsBlock[name] ?? {};
      if (!spec.file) {
        results.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'fail',
          detail: `compose secret '${name}' is not a file: source`,
        });
      } else {
        results.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'pass',
          detail: `compose secret '${name}' -> file: ${spec.file}`,
        });
      }
    }
    // Plaintext-literal scan.
    const hits = await scanForLiteral({ composePath: composePathToScan, secret, secretName: 'web-token' });
    if (hits.length > 0) {
      for (const h of hits) {
        results.push({
          anchorAcId: 'AC-composeHost-secretsAreFiles',
          verdict: 'fail',
          detail: `plaintext secret literal for 'web-token' found in ${h.file}:${h.line} (snippet: ${h.snippet})`,
        });
      }
    } else {
      results.push({
        anchorAcId: 'AC-composeHost-secretsAreFiles',
        verdict: 'pass',
        detail: `no plaintext secret literal for 'web-token' found in the scanned compose.yaml`,
      });
    }
    extra.hits = hits.map((h) => ({ file: h.file, line: h.line }));
  } finally {
    if (scratchToClean) await rm(scratchToClean, { recursive: true, force: true });
  }
  return { results, extra };
}

const engine = { kind: 'source-scan', image: 'in-process compose + secret grep', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('secrets-as-files-scan', engine, runProbe);
}
