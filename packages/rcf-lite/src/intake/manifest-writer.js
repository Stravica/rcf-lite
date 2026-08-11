// Intake record composer + writer (spec §3.4).
//
// Composes the `intakeClassification` block and appends/replaces it on
// the manifest, then writes the manifest atomically after schema
// validation. Uses the same `.tmp → rename` pattern as the preflight
// writer.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '#core/errors';
import { validateDocument } from '#core/store';

const ID_RE = /^ic-\d{4}-\d{2}-\d{2}-(\d{3})$/;

/**
 * Compose the next monotonic intake id for the current date.
 *
 * @param {object|null} manifest
 * @param {Date} [now]
 * @returns {string}
 */
export function nextIntakeId(manifest, now = new Date()) {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  const prefix = `ic-${yyyy}-${mm}-${dd}-`;
  const existingRec = manifest?.intakeClassification ?? null;
  let maxN = 0;
  if (existingRec && typeof existingRec.id === 'string' && existingRec.id.startsWith(prefix)) {
    const m = existingRec.id.match(ID_RE);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  return `${prefix}${(maxN + 1).toString().padStart(3, '0')}`;
}

/**
 * Compose an intakeClassification block.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.fidelity
 * @param {object[]} args.artefacts
 * @param {object[]} args.validationFindings
 * @param {object} args.elicitationScope
 * @param {Date} [args.now]
 * @returns {object}
 */
export function composeIntakeRecord({ manifest, fidelity, artefacts, validationFindings, elicitationScope, now = new Date() }) {
  const isoNow = now.toISOString();
  const record = {
    id: nextIntakeId(manifest, now),
    createdAt: isoNow,
    fidelity,
    artefacts,
    validationFindings,
    elicitationScope,
    operatorAckAt: isoNow,
  };
  return record;
}

/**
 * Write the composed intakeClassification onto the manifest.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {object} args.record
 * @returns {Promise<{ record: object } | import('#core/errors').RcfError>}
 */
export async function writeIntakeRecord({ projectRoot, tree, record }) {
  const manifest = tree?.manifest ?? {};
  const nextManifest = { ...manifest, intakeClassification: record };
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: 'rcf/manifest.json' });
  if (validation) return validation;
  const abs = join(projectRoot, 'rcf', 'manifest.json');
  try {
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    try {
      await rename(tmp, abs);
    } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `intake: manifest write failed: ${err.message}`,
      filePath: 'rcf/manifest.json',
      stack: err.stack,
    });
  }
  return { record };
}
