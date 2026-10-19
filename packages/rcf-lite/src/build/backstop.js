// FBS-221 (US-19003, TAC-4148): the verified backstop on `bundle --next`.
//
// rcf/define/backstop.json { fromBuildOrder, adoptedAt, adoptedBy,
// overrides? } opens a window: every FBS at or above fromBuildOrder that
// sits at `complete` (merged, not yet `verified`) holds the queue. A tree
// with no backstop.json has the backstop off (grandfathered by absence).
// The file is not a sidecar ledger, so it never enters the freeze delta.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const BACKSTOP_REL_PATH = 'rcf/define/backstop.json';

/**
 * Read the backstop record, or null when the file is absent.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<object|null>}
 */
export async function loadBackstop({ projectRoot }) {
  let raw;
  try {
    raw = await readFile(join(projectRoot, BACKSTOP_REL_PATH), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw);
}

/**
 * The FBS inside the window still at `complete`, in queue order.
 *
 * @param {{ items: Array<{fbsId: string, buildOrder: number, executionStatus: string}> }} queue
 * @param {{ fromBuildOrder: number }} backstop
 * @returns {string[]}
 */
export function unverifiedInWindow(queue, backstop) {
  return queue.items
    .filter((i) => i.executionStatus === 'complete' && (i.buildOrder ?? 0) >= backstop.fromBuildOrder)
    .map((i) => i.fbsId);
}

/**
 * Write the backstop record: JSON, two-space indent, trailing newline.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.record
 * @returns {Promise<void>}
 */
export async function saveBackstop({ projectRoot, record }) {
  const filePath = join(projectRoot, BACKSTOP_REL_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}
