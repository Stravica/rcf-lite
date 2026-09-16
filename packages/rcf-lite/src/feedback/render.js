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

import { FEEDBACK_LABELS, labelsForEntry } from './labels.js';
import { BODY_CAP_BYTES } from './redact.js';

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
  const body = capRenderedBody(renderBody(entry, redacted, meta));
  const labels = defaultLabels(entry);
  return { title, body, labels };
}

/**
 * Enforce the design 5 rule 7 / gate F-4 cap on the RENDERED body,
 * not just the free-form body. Evidence rows, the environment table,
 * the fingerprint twin and the consent tail all count against the
 * 8 KB budget; when the sum overflows, truncate the free-form region
 * at the top of the body and re-append the trailing template so the
 * fingerprint line, the HTML comment and the consent tail stay
 * intact - triage keys off those and dedupe would break otherwise.
 * F-slice-2-10.
 *
 * @param {string} body
 * @returns {string}
 */
export function capRenderedBody(body) {
  if (Buffer.byteLength(body, 'utf8') <= BODY_CAP_BYTES) return body;
  const fenceIndex = body.indexOf('\n---\n');
  let out;
  if (fenceIndex < 0) {
    // Should never happen (renderBody always writes the fence) but
    // fall back to a raw byte truncation with a marker so the cap
    // still holds.
    out = `${truncateToBytes(body, BODY_CAP_BYTES - 32)}\n[truncated by rcf feedback]\n`;
  } else {
    const head = body.slice(0, fenceIndex);
    const tail = body.slice(fenceIndex);
    const tailBytes = Buffer.byteLength(tail, 'utf8');
    const marker = '\n\n[truncated by rcf feedback]\n';
    const markerBytes = Buffer.byteLength(marker, 'utf8');
    const headBudget = BODY_CAP_BYTES - tailBytes - markerBytes;
    if (headBudget <= 0) {
      // Tail alone exceeds the cap; keep the tail (fingerprint is
      // load-bearing for dedupe) and drop the entire free-form head.
      out = `[truncated by rcf feedback]${tail}`;
    } else {
      const truncatedHead = truncateToBytes(head, headBudget);
      out = `${truncatedHead}${marker}${tail}`;
    }
  }
  // F-slice-2-10 (fix round 2): oversized evidence can push the whole
  // assembled body past BODY_CAP_BYTES even after the head-side
  // truncation above (the tail-alone case is the obvious one, but
  // heavy evidence rows also inflate the fence-and-tail). Enforce the
  // cap unconditionally at the end so the return is never over-budget.
  if (Buffer.byteLength(out, 'utf8') > BODY_CAP_BYTES) {
    const marker = '\n[truncated by rcf feedback]\n';
    const markerBytes = Buffer.byteLength(marker, 'utf8');
    out = `${truncateToBytes(out, BODY_CAP_BYTES - markerBytes)}${marker}`;
  }
  return out;
}

function truncateToBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let cut = maxBytes;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return buf.slice(0, cut).toString('utf8');
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
  // F-slice-2-12: assemble the header and the section separators
  // WITHOUT a global newline-collapse pass. A body with three or
  // more intentional consecutive newlines would otherwise diverge
  // from the same content posted as a GitHub issue - and design 4.2
  // pins the bundle to the exact rendered issue body.
  const header = [
    '# rcf-lite feedback bundle',
    '',
    `Destination: ${destination.repo
      ? `https://github.com/${destination.repo}/issues/new`
      : '(unresolved)'}`,
  ];
  if (destination.reasonNotFiled) header.push(`Reason not filed: ${destination.reasonNotFiled}`);
  if (destination.libraryContact) header.push(`Library contact: ${destination.libraryContact}`);
  header.push(`Entries: ${rows.length}`);
  header.push(`Generated: ${meta.generatedAt} by rcf-lite ${meta.rcfLiteVersion}`);
  header.push('');
  header.push('Paste each section below as a new issue, title first. The fingerprint');
  header.push('line must be kept verbatim so duplicates fold correctly.');
  const headerBlock = header.join('\n');
  const sections = rows.map((row) => {
    const title = renderTitle(row.entry, row.redacted.title);
    const body = capRenderedBody(renderBody(row.entry, row.redacted, { fingerprint: row.fingerprint, destination }));
    return `## ${title}\n\n${body}`;
  });
  const parts = sections.length > 0 ? [headerBlock, ...sections] : [headerBlock];
  return `${parts.join('\n\n')}\n`;
}

/**
 * The six-label bootstrap catalogue (ADR-4102). Re-exported from the
 * canonical source (src/feedback/labels.js) so existing importers do
 * not break; new code should import FEEDBACK_LABELS directly. The
 * F-6 gate finding required one source of truth for the label
 * catalogue that the submit-time pre-check, the bootstrap script and
 * the render defaults all consume; that source is labels.js and the
 * grep test in test/feedback/labels-catalogue.test.js refuses any
 * bare literal for these names elsewhere.
 */
export const LABEL_CATALOGUE = FEEDBACK_LABELS;

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
  return labelsForEntry(entry?.severity, entry?.kind);
}
