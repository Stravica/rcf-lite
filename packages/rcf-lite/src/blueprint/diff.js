// `rcf blueprint diff <topic>` implementation.
//
// Side-by-side view of every applied blueprint's scope:global ADR on a
// given topic. Reads titles + decisions off the tree's byId map (the
// walker already parsed and validated the ADR bodies) and returns
// them in a shape a CLI renderer can format into two columns.
//
// This verb is read-only. It does not run the conflict detector -- an
// operator staring at a diff is usually deciding how to resolve the
// conflict, not asking whether one exists.

/**
 * @typedef {object} DiffAdrEntry
 * @property {string} slug        blueprint slug
 * @property {string} adrId       ADR id inside that blueprint's contribution set
 * @property {string} path        rcf-relative path to the ADR file
 * @property {string} [title]     ADR title (when the tree carries the loaded doc)
 * @property {string} [decision]  ADR decision (ditto)
 * @property {string} [context]   ADR context (ditto)
 * @property {string} [status]    ADR status (ditto)
 */

/**
 * @typedef {object} DiffResult
 * @property {string}          topic
 * @property {DiffAdrEntry[]}  entries    two or more when a conflict exists
 */

/**
 * @param {object} args
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.topic
 * @returns {DiffResult}
 */
export function diffBlueprintTopic({ tree, topic }) {
  const entries = [];
  const applied = Array.isArray(tree.manifest?.blueprints) ? tree.manifest.blueprints : [];
  for (const bp of applied) {
    for (const c of bp.contributions ?? []) {
      if (c.kind !== 'adr' || c.scope !== 'global' || c.topic !== topic) continue;
      const entry = { slug: bp.slug, adrId: c.id, path: c.path };
      const doc = tree.byId?.get(c.id);
      if (doc && typeof doc === 'object') {
        if (typeof doc.title === 'string') entry.title = doc.title;
        if (typeof doc.decision === 'string') entry.decision = doc.decision;
        if (typeof doc.context === 'string') entry.context = doc.context;
        if (typeof doc.status === 'string') entry.status = doc.status;
      }
      entries.push(entry);
    }
  }
  return { topic, entries };
}

/**
 * Render a DiffResult as an operator-readable two-column-ish block.
 * The renderer intentionally stays plain-text and terminal-friendly
 * (no ANSI, no fancy box-drawing) so it composes with piped output.
 *
 * @param {DiffResult} diff
 * @returns {string}
 */
export function renderDiff(diff) {
  const lines = [];
  lines.push(`[rcf] blueprint diff on topic (${diff.topic}): ${diff.entries.length} scope:global ADR(s).`);
  if (diff.entries.length === 0) {
    lines.push('');
    lines.push(`  no applied blueprint carries a scope:global ADR on '${diff.topic}'.`);
    return `${lines.join('\n')}\n`;
  }
  for (let i = 0; i < diff.entries.length; i += 1) {
    const e = diff.entries[i];
    lines.push('');
    lines.push(`  [${i + 1}] blueprint ${e.slug}`);
    lines.push(`      id:       ${e.adrId}`);
    lines.push(`      path:     ${e.path}`);
    if (e.title)    lines.push(`      title:    ${e.title}`);
    if (e.status)   lines.push(`      status:   ${e.status}`);
    if (e.decision) lines.push(`      decision: ${e.decision}`);
  }
  return `${lines.join('\n')}\n`;
}
