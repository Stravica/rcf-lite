// Feedback renderer (TAC-4105-feedback-render). Deterministic templates
// for the GitHub issue title and body, the +1 comment body, and the
// outbox bundle markdown. What the renderer emits is exactly what the
// operator sees in `rcf feedback preview` and what the submit path
// (slice 4) ships to `gh issue create`.
//
// The renderer never re-runs redaction; callers pass the already
// redacted title, body and evidence rows plus the ledger for the
// disclosure surface. All output is UTF-8, LF line endings, ASCII
// hyphens only (register rule; also keeps the fingerprint input
// stable).
//
// Design references:
//   - section 4.3 issue title and body template
//   - section 4.2 outbox bundle
//   - section 6 fingerprint twin (visible line + HTML comment)

/**
 * @typedef {object} RenderedIssue
 * @property {string} title
 * @property {string} body
 * @property {string[]} labels
 */

/**
 * @typedef {object} RenderedComment
 * @property {string} body
 */

/**
 * @typedef {object} BundleDestination
 * @property {string} repo                  OWNER/REPO
 * @property {'public' | 'private' | 'unresolved'} visibility
 * @property {string} [reasonNotFiled]      free-text reason
 * @property {string} [libraryContact]      publisher.contact from the registry
 */

/**
 * Render an issue create call payload (title, body, labels) for one
 * entry. `redacted` is `{ title, body, evidence, ledger }` from the
 * caller; the renderer only assembles.
 *
 * @param {object} entry
 * @param {{ title: string, body: string, evidence: Array<{ kind: string, value: string }>, ledger: Array<{ rule: string, count: number }> }} redacted
 * @param {{ fingerprint: string, destination: BundleDestination }} meta
 * @returns {RenderedIssue}
 */
export function renderIssue(entry, redacted, meta) {
  const title = renderTitle(entry, redacted.title);
  const body = renderBody(entry, redacted, meta);
  const labels = defaultLabels(entry);
  return { title, body, labels };
}

/**
 * Render the `+1 from another reporter` comment body used on the
 * dedupe path (slice 4). Kept in this module because triage sees one
 * shape from `create` and `comment`.
 *
 * @param {object} entry
 * @param {{ body: string, ledger: Array<{ rule: string, count: number }> }} redacted
 * @param {{ fingerprint: string, includeBody?: boolean }} meta
 * @returns {RenderedComment}
 */
export function renderComment(entry, redacted, meta) {
  const lines = [];
  lines.push('+1 from another reporter.');
  lines.push('');
  lines.push(...renderEnvironmentTable(entry).split('\n'));
  if (meta.includeBody) {
    lines.push('');
    lines.push('Report body:');
    lines.push('');
    lines.push(redacted.body);
  }
  lines.push('');
  lines.push(`rcf-feedback-fingerprint: ${meta.fingerprint}`);
  return { body: `${lines.join('\n')}\n` };
}

/**
 * Render an outbox bundle file. One `## ` section per entry containing
 * the rendered issue title and body. Header carries the destination,
 * the reason nothing was filed, the library contact when known, and
 * the entry count.
 *
 * @param {BundleDestination} destination
 * @param {Array<{ entry: object, redacted: { title: string, body: string, evidence: Array<{ kind: string, value: string }>, ledger: Array<{ rule: string, count: number }> }, fingerprint: string }>} rows
 * @param {{ generatedAt: string, rcfLiteVersion: string }} meta
 * @returns {string}
 */
export function renderBundle(destination, rows, meta) {
  const lines = [];
  lines.push('# rcf-lite feedback bundle');
  lines.push('');
  const repoUrl = destination.repo
    ? `https://github.com/${destination.repo}/issues/new`
    : '(unresolved)';
  lines.push(`Destination: ${repoUrl}`);
  if (destination.reasonNotFiled) lines.push(`Reason not filed: ${destination.reasonNotFiled}`);
  if (destination.libraryContact) lines.push(`Library contact: ${destination.libraryContact}`);
  lines.push(`Entries: ${rows.length}`);
  lines.push(`Generated: ${meta.generatedAt} by rcf-lite ${meta.rcfLiteVersion}`);
  lines.push('');
  lines.push('Paste each section below as a new issue, title first. The fingerprint');
  lines.push('line must be kept verbatim so duplicates fold correctly.');
  lines.push('');
  for (const row of rows) {
    const title = renderTitle(row.entry, row.redacted.title);
    const body = renderBody(row.entry, row.redacted, { fingerprint: row.fingerprint, destination });
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(body);
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/**
 * The six-label bootstrap catalogue (ADR-4102). Exported so the slice-4
 * label pre-check and the `scripts/bootstrap-feedback-labels.mjs`
 * script consume the same source (F-6 catalogue drift guard).
 */
export const LABEL_CATALOGUE = Object.freeze([
  'rcf-feedback',
  'severity:blocker',
  'severity:major',
  'severity:minor',
  'area:blueprint',
  'area:core',
]);

// -- internal -------------------------------------------------------------

function renderTitle(entry, redactedTitle) {
  const clean = String(redactedTitle ?? '').replace(/\s+/g, ' ').trim();
  if (entry?.kind === 'blueprint') {
    const slug = entry?.target?.effectiveSlug ?? entry?.target?.ref ?? 'unknown';
    return `[${slug}] ${clean}`;
  }
  return `[rcf-lite] ${clean}`;
}

function renderBody(entry, redacted, meta) {
  const lines = [];
  lines.push(redacted.body);
  lines.push('');
  lines.push('---');
  lines.push('**Evidence**');
  if (Array.isArray(redacted.evidence) && redacted.evidence.length > 0) {
    for (const ev of redacted.evidence) {
      lines.push(`- \`${ev.value}\` (${ev.kind})`);
    }
  } else {
    lines.push('- (none)');
  }
  lines.push('');
  lines.push(renderEnvironmentTable(entry));
  lines.push('');
  lines.push(`<!-- rcf-feedback-fingerprint: ${meta.fingerprint} -->`);
  lines.push(`rcf-feedback-fingerprint: ${meta.fingerprint}`);
  const ledgerRows = Array.isArray(redacted.ledger)
    ? redacted.ledger.filter((r) => r.count > 0)
    : [];
  const summary = ledgerRows
    .map((r) => `${r.count} ${r.rule}`)
    .join(', ');
  const consentTail = summary
    ? `Filed by rcf-lite's feedback verb with the reporter's explicit consent. Redaction ledger: ${summary}.`
    : "Filed by rcf-lite's feedback verb with the reporter's explicit consent. Redaction ledger: nothing replaced.";
  lines.push(consentTail);
  return lines.join('\n');
}

function renderEnvironmentTable(entry) {
  const env = entry?.environment ?? {};
  const kind = entry?.kind ?? 'core';
  const t = entry?.target ?? {};
  const blueprintCell = kind === 'blueprint'
    ? [
      t.effectiveSlug ?? t.ref ?? 'unknown',
      t.blueprintVersion ? `${t.blueprintVersion}` : null,
      t.libraryPrefix ? `(library ${t.libraryPrefix}${t.libraryRef ? ` ${t.libraryRef}` : ''}${t.resolvedSha ? `, git ${String(t.resolvedSha).slice(0, 7)}` : t.tarballSha256 ? `, tarball ${String(t.tarballSha256).slice(0, 7)}` : ''})` : null,
    ].filter(Boolean).join(' ')
    : 'n/a';
  const rows = [
    ['field', 'value'],
    ['kind', kind],
    ['blueprint', blueprintCell],
    ['anchor', entry?.anchor ?? '-'],
    ['symptom class', entry?.symptomClass ?? '-'],
    ['severity', entry?.severity ?? '-'],
    ['rcf-lite', env.rcfLiteVersion ?? '-'],
    ['harness', env.harness ?? '-'],
    ['node / platform', `${env.nodeVersion ?? '-'} / ${env.platform ?? '-'}`],
  ];
  const out = [];
  out.push('**Environment**');
  out.push('| field | value |');
  out.push('|---|---|');
  for (const [field, value] of rows.slice(1)) {
    out.push(`| ${field} | ${value} |`);
  }
  return out.join('\n');
}

function defaultLabels(entry) {
  const sev = entry?.severity;
  const area = entry?.kind === 'blueprint' ? 'area:blueprint' : 'area:core';
  const sevLabel = sev && LABEL_CATALOGUE.includes(`severity:${sev}`) ? `severity:${sev}` : null;
  return ['rcf-feedback', ...(sevLabel ? [sevLabel] : []), area];
}
