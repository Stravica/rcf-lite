// Deterministic tag-scoring standards selector for the bundle assembler.
//
// Design brief §Selective per-FBS retrieval (agentic): a small model
// call is allowed but not required. Phase 1 ships a pure heuristic —
// deterministic tag-hit counting over the FBS work text against the
// registered standards' tags, slugs and summaries. This satisfies the
// selective-retrieval ACs (deterministic, hermetic, never blocks) and
// keeps the seam clean for a smarter selector to slot in.
//
// Selection order: standards manifest order (authored); ties inside a
// score break by manifest order too. Silence on the FBS side returns an
// empty selection; the bundle assembler treats that as "no standards".

/**
 * @param {object} fbs - the FBS document
 * @param {Array<{ slug: string, tags?: string[], summary?: string }>} standards
 * @returns {{ standardIds: string[], scoresById: Record<string, number> }}
 */
export function selectStandards(fbs, standards) {
  const source = normaliseText([
    fbs?.title,
    fbs?.summary,
    fbs?.approach,
    fbs?.notes,
    (fbs?.acceptanceCriteria ?? []).map((ac) => `${ac?.description ?? ''} ${ac?.given ?? ''} ${ac?.when ?? ''} ${ac?.then ?? ''}`).join(' '),
  ].filter(Boolean).join(' '));
  const packs = Array.isArray(standards) ? standards : [];
  const scoresById = {};
  const selected = [];
  for (const pack of packs) {
    const score = scorePack(source, pack);
    scoresById[pack.slug] = score;
    if (score > 0) selected.push(pack.slug);
  }
  return { standardIds: selected, scoresById };
}

function scorePack(source, pack) {
  let score = 0;
  const tokens = new Set();
  for (const tag of pack.tags ?? []) tokens.add(String(tag).toLowerCase());
  tokens.add(String(pack.slug ?? '').toLowerCase());
  for (const token of tokens) {
    if (!token) continue;
    if (source.includes(token)) score += 1;
  }
  return score;
}

function normaliseText(s) {
  return String(s ?? '').toLowerCase();
}
