// Readiness delta counts (FBS-206, TAC-4135-readiness-command-page,
// ADR-4139). Pure HTML string renderer: emits six count numbers
// (changed, added, removed, briefSince, impacted, impactedFbs) and
// hides the per-document list and its diff widgets inside a
// collapsed <details> so a thousand-document delta no longer buries
// the failing ids.
//
// AC-18005-3 pins the expanded contract: when the reader opens the
// <details>, the per-document list renders (changed with the diff
// component, added, removed, impacted ACs and FBS as links); when
// closed, only the six counts are visible.
//
// No command text, no write affordance.

import { escapeHtml } from '../doc-renderers/helpers.js';
import { diff } from '../components/diff.js';

/**
 * @typedef {object} DeltaCounts
 * @property {number} changed
 * @property {number} added
 * @property {number} removed
 * @property {number} briefSince
 * @property {number} impacted
 * @property {number} impactedFbs
 * @property {boolean} expanded     renderer-side flag mirroring the <details open> state
 */

/**
 * Fold the six counts from a ReadinessDelta.
 *
 * @param {import('../../query/readiness.js').ReadinessDelta | null | undefined} d
 * @returns {Omit<DeltaCounts, 'expanded'>}
 */
export function foldCounts(d) {
  if (!d || typeof d !== 'object') {
    return { changed: 0, added: 0, removed: 0, briefSince: 0, impacted: 0, impactedFbs: 0 };
  }
  return {
    changed: Array.isArray(d.changed) ? d.changed.length : 0,
    added: Array.isArray(d.added) ? d.added.length : 0,
    removed: Array.isArray(d.removed) ? d.removed.length : 0,
    briefSince: Array.isArray(d.briefSince) ? d.briefSince.length : 0,
    impacted: Array.isArray(d.impacted) ? d.impacted.length : 0,
    impactedFbs: Array.isArray(d.impactedFbs) ? d.impactedFbs.length : 0,
  };
}

/**
 * Build the delta-counts block (overview sub-view). The six count
 * tiles are always visible; the per-document list sits inside a
 * collapsed <details>.
 *
 * @param {object} args
 * @param {import('../../query/readiness.js').ReadinessDelta | null | undefined} args.delta
 * @param {object | null | undefined} [args.freezeRecord]
 * @param {boolean} [args.expanded]   default false
 * @returns {string}
 */
export function renderDeltaCounts({ delta, freezeRecord, expanded }) {
  const counts = foldCounts(delta);
  const totalTouched = counts.changed + counts.added + counts.removed;
  const empty = totalTouched === 0 && counts.briefSince === 0 && counts.impacted === 0 && counts.impactedFbs === 0;
  if (empty) {
    return `<section class="rcf-readiness-delta-counts" data-rcf-expanded="${expanded ? 'yes' : 'no'}">`
      + `<h3>Delta since freeze</h3>`
      + `<p><em>No delta since the last freeze.</em></p>`
      + `</section>`;
  }
  const tiles = [
    tile('changed', counts.changed, 'Documents changed'),
    tile('added', counts.added, 'Documents added'),
    tile('removed', counts.removed, 'Documents removed'),
    tile('briefSince', counts.briefSince, 'Brief statements since freeze'),
    tile('impacted', counts.impacted, 'ACs to re-verify'),
    tile('impactedFbs', counts.impactedFbs, 'FBS to re-execute'),
  ].join('');
  const open = expanded ? ' open' : '';
  const docsList = renderDocsList(delta, freezeRecord);
  return `<section class="rcf-readiness-delta-counts" data-rcf-expanded="${expanded ? 'yes' : 'no'}">`
    + `<h3>Delta since freeze</h3>`
    + `<div class="rcf-readiness-delta-counts__tiles" role="group" aria-label="Delta counts">${tiles}</div>`
    + `<details class="rcf-readiness-delta-counts__details"${open}>`
    + `<summary>Show per-document changes</summary>`
    + docsList
    + `</details>`
    + `</section>`;
}

function tile(key, n, label) {
  const empty = n === 0 ? ' rcf-readiness-delta-counts__tile--empty' : '';
  return `<div class="rcf-readiness-delta-counts__tile${empty}" data-rcf-count="${escapeHtml(key)}" data-rcf-count-value="${n}">`
    + `<span class="rcf-readiness-delta-counts__n">${n}</span>`
    + `<span class="rcf-readiness-delta-counts__label">${escapeHtml(label)}</span>`
    + `</div>`;
}

function renderDocsList(delta, freezeRecord) {
  const d = delta && typeof delta === 'object' ? delta : null;
  if (!d) return '';
  const frozenHashes = (freezeRecord && typeof freezeRecord === 'object' && freezeRecord.docHashes && typeof freezeRecord.docHashes === 'object')
    ? freezeRecord.docHashes
    : {};
  const currentHashes = (d && typeof d.currentDocHashes === 'object' && d.currentDocHashes !== null)
    ? d.currentDocHashes
    : {};
  const added = Array.isArray(d.added) ? d.added : [];
  const changed = Array.isArray(d.changed) ? d.changed : [];
  const removed = Array.isArray(d.removed) ? d.removed : [];
  const brief = Array.isArray(d.briefSince) ? d.briefSince : [];
  const impactedAc = Array.isArray(d.impacted) ? d.impacted : [];
  const impactedFbs = Array.isArray(d.impactedFbs) ? d.impactedFbs : [];
  const docsBlock = (added.length + changed.length + removed.length) > 0
    ? `<section class="rcf-readiness-delta-counts__docs">`
      + `<h4>Documents (${added.length + changed.length + removed.length})</h4>`
      + `<ul>`
      + added.map((id) => `<li><a href="#${escapeHtml(String(id))}">${escapeHtml(String(id))}</a> <em>added</em>${renderDocDiff(id, frozenHashes, currentHashes, 'added')}</li>`).join('')
      + changed.map((id) => `<li><a href="#${escapeHtml(String(id))}">${escapeHtml(String(id))}</a> <em>changed</em>${renderDocDiff(id, frozenHashes, currentHashes, 'changed')}</li>`).join('')
      + removed.map((id) => `<li>${escapeHtml(String(id))} <em>removed</em>${renderDocDiff(id, frozenHashes, currentHashes, 'removed')}</li>`).join('')
      + `</ul>`
      + `</section>`
    : '';
  const briefBlock = brief.length > 0
    ? `<section class="rcf-readiness-delta-counts__brief">`
      + `<h4>Brief statements since freeze (${brief.length})</h4>`
      + `<ul>${brief.map((n) => `<li>#${escapeHtml(String(n))}</li>`).join('')}</ul>`
      + `</section>`
    : '';
  const impactedBlock = (impactedAc.length + impactedFbs.length) > 0
    ? `<section class="rcf-readiness-delta-counts__impacted" data-rcf-impacted-ac="${impactedAc.length}" data-rcf-impacted-fbs="${impactedFbs.length}">`
      + `<h4>Impacted by delta (${impactedAc.length} AC, ${impactedFbs.length} FBS)</h4>`
      + (impactedAc.length > 0
        ? `<p class="muted small">To re-verify (${impactedAc.length}):</p>`
          + `<ul class="rcf-readiness-delta-counts__impacted-ac">${impactedAc.map((n) => `<li><a href="#${escapeHtml(String(n))}">${escapeHtml(String(n))}</a></li>`).join('')}</ul>`
        : '')
      + (impactedFbs.length > 0
        ? `<p class="muted small">To re-execute (${impactedFbs.length}):</p>`
          + `<ul class="rcf-readiness-delta-counts__impacted-fbs">${impactedFbs.map((id) => `<li><a href="#${escapeHtml(String(id))}">${escapeHtml(String(id))}</a></li>`).join('')}</ul>`
        : '')
      + `</section>`
    : '';
  return docsBlock + briefBlock + impactedBlock;
}

function renderDocDiff(id, frozenHashes, currentHashes, kind) {
  const frozenHash = typeof frozenHashes?.[id] === 'string' ? frozenHashes[id] : null;
  const currentHash = typeof currentHashes?.[id] === 'string' ? currentHashes[id] : null;
  const beforeNote = 'frozen body not captured in freeze record';
  const before = kind === 'added'
    ? { note: 'not in the frozen tree' }
    : { hash: frozenHash ?? '', note: beforeNote };
  const after = kind === 'removed'
    ? { note: 'removed from the live tree' }
    : { hash: currentHash ?? '', note: 'current body available on the document tab' };
  return ` ${diff(before, after)}`;
}
