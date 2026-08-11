// Canary record composer + fixture-manifest writer (spec §3.5, §7.4).
//
// Records land on a fixture manifest (not a real chain manifest) at
// packages/rcf-lite/fixtures/canary-manifest.json. Consumers grep the top
// record's verdict to decide whether to gate a release; a
// ship-despite-fail record carries `shipDespiteFailReason` so the
// operator's ruling is durable and greppable.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Location of the fixture manifest that carries the canary history. */
export const DEFAULT_CANARY_MANIFEST_PATH = resolve(here, '..', '..', 'fixtures', 'canary-manifest.json');

const ID_RE = /^rc-\d{4}-\d{2}-\d{2}-(\d{3})$/;

function nextCanaryId(records, now = new Date()) {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  const prefix = `rc-${yyyy}-${mm}-${dd}-`;
  let maxN = 0;
  for (const r of records) {
    if (typeof r?.id !== 'string' || !r.id.startsWith(prefix)) continue;
    const m = r.id.match(ID_RE);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  return `${prefix}${(maxN + 1).toString().padStart(3, '0')}`;
}

/**
 * Compose a registerCanary[] record for one fixture run.
 *
 * @param {object} args
 * @param {object[]} args.existingRecords
 * @param {string} args.buildVersion
 * @param {string} args.fixturePromptId
 * @param {string} args.responseBody
 * @param {{ verdict: 'pass'|'fail', grades: object }} args.grade
 * @param {string} [args.shipDespiteFailReason]
 * @param {Date} [args.now]
 * @returns {object}
 */
export function composeCanaryRecord({ existingRecords, buildVersion, fixturePromptId, responseBody, grade, shipDespiteFailReason, now = new Date() }) {
  const isoNow = now.toISOString();
  const record = {
    id: nextCanaryId(existingRecords, now),
    createdAt: isoNow,
    buildVersion,
    fixturePromptId,
    responseWordCount: countWords(responseBody),
    grades: grade.grades,
    verdict: grade.verdict,
  };
  if (typeof shipDespiteFailReason === 'string' && shipDespiteFailReason.length > 0) {
    record.shipDespiteFailReason = shipDespiteFailReason;
  }
  return record;
}

function countWords(text) {
  const stripped = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .trim();
  if (stripped.length === 0) return 0;
  return stripped.split(/\s+/).length;
}

/**
 * Read the fixture manifest (or return an empty seed when missing).
 *
 * @param {string} [path]
 * @returns {Promise<{ registerCanary: object[] }>}
 */
export async function readCanaryManifest(path = DEFAULT_CANARY_MANIFEST_PATH) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.registerCanary)) {
      return { ...parsed, registerCanary: [] };
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return { registerCanary: [] };
    throw err;
  }
}

/**
 * Write the fixture manifest atomically. `records` is the full array
 * (append-only usage: read, append the new record, write the result).
 *
 * @param {object} args
 * @param {object[]} args.records
 * @param {string} [args.path]
 * @returns {Promise<void>}
 */
export async function writeCanaryManifest({ records, path = DEFAULT_CANARY_MANIFEST_PATH }) {
  const abs = path;
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp`;
  const body = { registerCanary: records };
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  try {
    await rename(tmp, abs);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Convenience: append one record to the fixture manifest and write back.
 *
 * @param {object} args
 * @param {object} args.record
 * @param {string} [args.path]
 * @returns {Promise<{ records: object[] }>}
 */
export async function appendCanaryRecord({ record, path = DEFAULT_CANARY_MANIFEST_PATH }) {
  const manifest = await readCanaryManifest(path);
  const records = [...(manifest.registerCanary ?? []), record];
  await writeCanaryManifest({ records, path });
  return { records };
}
