// `rcf define blueprint dispositions <slug> [--json]` sub-verb.
// Read-only view over the per-slug disposition ledger written by
// `disposition-ledger.js`. Emits either a human-readable table (one
// AC per line) or a JSON dump.

import { readLedger, ledgerRelPath } from './disposition-ledger.js';

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.slug
 * @param {boolean} [args.asJson]
 * @returns {Promise<{ output: string, exitCode: number }>}
 */
export async function renderDispositions({ projectRoot, slug, asJson = false }) {
  const doc = await readLedger(projectRoot, slug);
  if (!doc) {
    if (asJson) {
      return {
        output: `${JSON.stringify({ slug, present: false, ledgerPath: ledgerRelPath(slug), records: [] }, null, 2)}\n`,
        exitCode: 0,
      };
    }
    return {
      output: `[blueprint] no disposition ledger found for '${slug}' at ${ledgerRelPath(slug)}\n`,
      exitCode: 0,
    };
  }
  if (asJson) {
    return {
      output: `${JSON.stringify({ slug, present: true, ledgerPath: ledgerRelPath(slug), records: doc.records }, null, 2)}\n`,
      exitCode: 0,
    };
  }
  const lines = [`[blueprint] '${slug}' disposition ledger (${doc.records.length} record(s)) at ${ledgerRelPath(slug)}:`];
  for (const rec of doc.records) {
    const parts = [rec.acId, rec.storyId, rec.action];
    if (rec.reason) parts.push(`reason: ${rec.reason}`);
    if (rec.resolvedAt) parts.push(`resolvedAt: ${rec.resolvedAt}`);
    if (rec.escalatedAt) parts.push(`escalatedAt: ${rec.escalatedAt}`);
    lines.push(`  ${parts.join('  ')}`);
  }
  return { output: `${lines.join('\n')}\n`, exitCode: 0 };
}
