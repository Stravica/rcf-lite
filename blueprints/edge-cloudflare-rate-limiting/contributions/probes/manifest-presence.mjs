// Probe: rate-limit manifest presence.
//
// anchorAcId: AC-36101-1 (also surfaces AC-36108-1's missing-file
// negative through SIMULATE_MANIFEST_MISSING). accountBound: false.
//
// Reads the cf-edge fixture manifest directory (cloudflare/rate-limits/),
// asserts:
//   - at least one JSON file is present under the directory.
//   - every file parses as JSON.
//   - every file carries the seven required Cloudflare WAF rate-limiting
//     rules fields (id, expression, threshold, period, characteristics,
//     action, duration).
//   - no file body carries a plaintext bearer token, private key or
//     inline CF_API_TOKEN reference.
//
// Under SIMULATE_MANIFEST_MISSING=true the probe treats the first
// manifest file as absent and returns aggregateVerdict: fail with
// the missing basename named in the detail (AC-36108-1).

import { readManifestFiles, scanForPlaintextSecrets, REQUIRED_FIELDS } from './probe-utils.mjs';

export const anchorAcId = 'AC-36101-1';
export const accountBound = false;

export default async function runProbe() {
  const { present, entries, files = [], hiddenBySimulate = [] } = await readManifestFiles();
  const results = [];
  if (!present) {
    results.push({
      anchorAcId: 'AC-36101-1',
      verdict: 'fail',
      detail: 'manifest directory holds zero JSON files; cf-edge fixture must ship at least one rule file under cloudflare/rate-limits/.',
    });
    return { results };
  }
  if (hiddenBySimulate.length > 0) {
    results.push({
      anchorAcId: 'AC-36108-1',
      verdict: 'fail',
      detail: `manifest file missing: ${hiddenBySimulate.join(', ')} (SIMULATE_MANIFEST_MISSING=true).`,
    });
    return { results };
  }
  let missingFieldCount = 0;
  let plaintextCount = 0;
  const fileFindings = [];
  for (const f of files) {
    let doc;
    try {
      doc = JSON.parse(f.text);
    } catch (err) {
      results.push({
        anchorAcId: 'AC-36101-1',
        verdict: 'fail',
        detail: `manifest file ${f.name} does not parse as JSON: ${err.message}`,
      });
      continue;
    }
    const missing = REQUIRED_FIELDS.filter((k) => !(k in doc));
    if (missing.length > 0) {
      missingFieldCount += 1;
      results.push({
        anchorAcId: 'AC-36101-1',
        verdict: 'fail',
        detail: `manifest file ${f.name} missing required fields: ${missing.join(', ')}`,
      });
    }
    const hits = scanForPlaintextSecrets(f.text);
    if (hits.length > 0) {
      plaintextCount += 1;
      results.push({
        anchorAcId: 'AC-36101-1',
        verdict: 'fail',
        detail: `manifest file ${f.name} carries plaintext secret pattern(s): ${hits.join(', ')}`,
      });
    }
    fileFindings.push({ name: f.name, ruleId: doc.id ?? null });
  }
  if (results.length === 0) {
    results.push({
      anchorAcId: 'AC-36101-1',
      verdict: 'pass',
      detail: `${files.length} manifest file(s) inspected; every file carries the ${REQUIRED_FIELDS.length} required fields and no plaintext secret pattern was found.`,
    });
  }
  return {
    results,
    extra: {
      manifestFileCount: files.length,
      manifestFiles: fileFindings,
      missingFieldFileCount: missingFieldCount,
      plaintextHitFileCount: plaintextCount,
    },
  };
}
