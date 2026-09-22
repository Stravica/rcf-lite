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
  // Round 3 (F-slice-2-10 regression): the fingerprint twin plus
  // consent tail at the very end of the body is load-bearing for
  // triage dedupe. Split it out and treat it as inviolable; the
  // head-side prunable region is everything before the fingerprint
  // marker. The earlier logic anchored on the `\n---\n` evidence
  // fence and then applied an unconditional END-side truncate as a
  // safety net, which sliced BOTH fingerprint markers off an
  // 8192-byte-evidence body and broke dedupe.
  const fpIndex = body.indexOf('<!-- rcf-feedback-fingerprint:');
  if (fpIndex < 0) {
    // No fingerprint block; fall back to a raw byte truncation with
    // a marker so the cap still holds. Should never happen: renderBody
    // and renderComment both stamp a fingerprint line.
    return `${truncateToBytes(body, BODY_CAP_BYTES - 32)}\n[truncated by rcf feedback]\n`;
  }
  const head = body.slice(0, fpIndex);
  const tail = body.slice(fpIndex);
  const tailBytes = Buffer.byteLength(tail, 'utf8');
  const marker = '\n[truncated by rcf feedback]\n';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const headBudget = BODY_CAP_BYTES - tailBytes - markerBytes;
  if (headBudget <= 0) {
    // Fingerprint tail alone exceeds the cap. Dedupe integrity beats
    // the cap: keep both fingerprint markers verbatim and drop the
    // free-form head entirely so triage can still fold duplicates.
    return `[truncated by rcf feedback]\n${tail}`;
  }
  const truncatedHead = truncateToBytes(head, headBudget);
  return `${truncatedHead}${marker}${tail}`;
}

function truncateToBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let cut = maxBytes;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return buf.slice(0, cut).toString('utf8');
}

/**
 * Render the fold comment body used on the dedupe path (slice 4).
 * 0.28.2 (issue #234, Barry ruling 2026-09-21): the retired
 * "+1 from another reporter." payload is gone; the comment always
 * carries the full report so a human can judge whether the fold is
 * correct. The header line names the fold decision. The visible
 * fingerprint line at the bottom stays so a later submit can still
 * match on it.
 *
 * @param {object} entry
 * @param {{ title: string, body: string, evidence: Array<{ kind: string, value: string }>, ledger: Array<{ rule: string, count: number }> }} redacted
 * @param {{ fingerprint: string, matchedTitle?: string }} meta
 * @returns {RenderedComment}
 */
export function renderComment(entry, redacted, meta) {
  const lines = [];
  lines.push('Apparent duplicate of the issue subject; posting the full report so a human can judge.');
  lines.push('');
  lines.push(`## Report: ${renderTitle(entry, redacted.title)}`);
  lines.push('');
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
  // 0.28.2 (issue #234): a "target" row goes on the environment
  // table for core entries too, so submit's fingerprint-verification
  // step can compare the entry's verb path against a candidate's
  // recorded target and refuse to fold across differing targets. For
  // blueprint entries the blueprint cell already carries the target
  // identity, so the target row is left as "-" to avoid duplication.
  const targetCell = kind === 'blueprint'
    ? '-'
    : (typeof t.ref === 'string' && t.ref.length > 0 ? t.ref : '-');
  const rows = [
    ['field', 'value'],
    ['kind', kind],
    ['blueprint', blueprintCell],
    ['target', targetCell],
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
