/**
 * security-secrets-management shim for the fixture.
 *
 * The fixture applies security-secrets-management so the compose-time
 * gate passes. The shim realises the secretRef opaque-string contract by
 * reading a project-local .rcf/secrets/dev.env file at the fixture root
 * (or, when the file is absent, from OS env vars matching the same
 * names).
 *
 * The credential pair here is fixture-only: MINIO_ROOT_USER /
 * MINIO_ROOT_PASSWORD from docker-compose.yml. A real project's
 * dev.env or secrets vault holds the R2 or AWS credential pair.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(HERE, '..');

function parseEnvFile(source) {
  const out = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

let cached = null;

async function loadSecrets() {
  if (cached) return cached;
  const overrides = {};
  try {
    const src = await readFile(resolve(FIXTURE_ROOT, '.rcf', 'secrets', 'dev.env'), 'utf8');
    Object.assign(overrides, parseEnvFile(src));
  } catch { /* file optional */ }
  cached = {
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || overrides.S3_ACCESS_KEY_ID || 'rcf-dev',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || overrides.S3_SECRET_ACCESS_KEY || 'rcf-dev-only',
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || overrides.R2_ACCOUNT_ID || null,
    R2_BUCKET: process.env.R2_BUCKET || overrides.R2_BUCKET || null,
  };
  return cached;
}

export const secretsShim = {
  async getSecret(name) {
    const secrets = await loadSecrets();
    if (name === 'objectStorageCredentials') {
      return {
        accessKeyId: secrets.S3_ACCESS_KEY_ID,
        secretAccessKey: secrets.S3_SECRET_ACCESS_KEY,
      };
    }
    if (name === 'r2Endpoint') {
      if (!secrets.R2_ACCOUNT_ID || !secrets.R2_BUCKET) return null;
      return {
        accountId: secrets.R2_ACCOUNT_ID,
        bucket: secrets.R2_BUCKET,
        endpoint: `https://${secrets.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      };
    }
    throw new Error(`unknown secret name ${name}`);
  },
};
