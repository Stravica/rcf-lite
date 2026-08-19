// Shared atomic writer for the manifest.blueprints[] and
// manifest.standards[] sections. Modelled on
// src/ui-baseline/manifest-writer.js (schema-validate the composed
// manifest, tmp-write + rename).

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { validateDocument } from '#core/store';

/**
 * Read the manifest from tree, apply `mutate(manifest)`, revalidate,
 * atomically write. Returns the updated manifest or an RcfError.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.manifest - the current manifest object
 * @param {(next: object) => void} args.mutate - mutates `next` in place
 * @param {boolean} [args.dryRun]
 * @returns {Promise<{ manifest: object } | import('../core/errors/index.js').RcfError>}
 */
export async function updateManifest({ projectRoot, manifest, mutate, dryRun = false }) {
  const next = deepClone(manifest ?? {});
  mutate(next);
  const relPath = 'rcf/manifest.json';
  const validation = validateDocument({ doc: next, kind: 'manifest', filePath: relPath });
  if (validation) return validation;
  if (dryRun) return { manifest: next };
  const absPath = join(projectRoot, 'rcf', 'manifest.json');
  try {
    await mkdir(dirname(absPath), { recursive: true });
    const tmp = `${absPath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    try {
      await rename(tmp, absPath);
    } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `manifest write failed: ${err.message}`, filePath: relPath });
  }
  return { manifest: next };
}

function deepClone(x) {
  return JSON.parse(JSON.stringify(x));
}
