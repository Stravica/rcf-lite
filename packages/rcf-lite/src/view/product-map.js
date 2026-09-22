// Product Map tab: re-buckets the review-surface tree model by product-
// shaped axes rather than the flat REQ list the Requirements tab shows.
// Five re-bucketings + a status filter, all applied to the same
// in-memory BuiltTreeModel. Pure over the tree model - no I/O, no
// schema change, no walker work. Groupings ride on the maps the walker
// already computes (childrenByParent, storiesByReqId, usByTacId,
// acIdsByUsId, tsByAcId, tcsByAcId, fbsByAcId), on the REQ document's
// own tags[] and shapeClassification.shapes[] fields, and (for the
// by-blueprint grouping added under AC-17008-1) on
// manifest.blueprints[].contributions[] carried on model.manifest.
//
// Spec: projects/rcf-lite-wsd/docs/2026-09-21_product-map-proposal.md.
// Chain: REQ-170 (tab) + REQ-171 (capability tag convention) + US-17008
// (blueprint badge and by-blueprint grouping, AC-17008-1).
//
// Interaction model (AC-17006-1): every bucket is a <details class="pm-bucket">
// collapsed by default, with a summary row carrying label + total count
// + per-status mini pills. A jump-nav chip row lists every bucket in
// the active grouping and clicking a chip opens + scrolls to it. Open-
// bucket state is encoded in the hash and persisted through SSE swaps
// via a stable per-bucket data-doc-id.
//
// Lazy render (AC-17007-1): the server emits only the DEFAULT grouping's
// REQ cards fully. The other groupings emit only their bucket headings
// (label + counts + status pills) with data-pm-lazy="true" on the
// grouping section. The client fetches /product-map/<group> on first
// activation and replaces the grouping's innerHTML in place.
//
// Blueprint attribution (AC-17008-1): every REQ row an applied blueprint
// contributed carries a pm-blueprint-badge in its summary in EVERY
// grouping. The source of truth is manifest.blueprints[].contributions[]
// (parsed by scope.contributionsForBlueprint on the applied record).
// When a manifest carries a blueprint record without contributions[]
// (older applied records that predate the field, or hand-authored
// manifests), the id-prefix fallback derives the slug from the reqId's
// leading kebab-slug segment when that slug matches an applied blueprint.

import { detailsWrap, escapeHtml } from './doc-renderers/helpers.js';
import { renderReq, renderUserStory } from './doc-renderers/index.js';
import { contributionsForBlueprint } from './scope.js';

export const GROUPINGS = ['shape', 'component', 'trace', 'capability', 'blueprint'];
export const STATUSES = ['all', 'draft', 'review', 'needsRevision', 'approved', 'superseded'];
export const DEFAULT_GROUPING = 'shape';
export const DEFAULT_STATUS = 'all';
// Status ids that get a mini pill in the bucket summary. "all" is the
// select's default option, not a real status, so it is intentionally
// absent here.
export const STATUS_MINI = ['draft', 'review', 'needsRevision', 'approved', 'superseded'];

const SHAPE_ORDER = ['webUi', 'httpApi', 'auth', 'persistence', 'notifications', 'none', 'unclassified'];
const SHAPE_LABELS = {
  webUi: 'Web UI',
  httpApi: 'HTTP API',
  auth: 'Auth',
  persistence: 'Persistence',
  notifications: 'Notifications',
  none: 'Business rules',
  unclassified: 'Unclassified',
};

// Bucket id used for the project's own REQs inside the by-blueprint
// grouping. The label is "Project"; the id is stable so hashes and
// data-doc-id anchors round-trip.
const PROJECT_BUCKET_ID = 'project';
const PROJECT_BUCKET_LABEL = 'Project';

export function shapesForReq(req) {
  const shapes = req?.shapeClassification?.shapes;
  if (!Array.isArray(shapes) || shapes.length === 0) return ['unclassified'];
  return [...shapes];
}

export function groupByShape(model) {
  const buckets = new Map();
  for (const shape of SHAPE_ORDER) buckets.set(shape, []);
  for (const req of model.requirements) {
    const seen = new Set();
    for (const shape of shapesForReq(req)) {
      if (seen.has(shape)) continue;
      seen.add(shape);
      const list = buckets.get(shape) ?? [];
      list.push(req);
      buckets.set(shape, list);
    }
  }
  return SHAPE_ORDER
    .map((id) => ({ id, label: SHAPE_LABELS[id], reqs: buckets.get(id) ?? [] }))
    .filter((b) => b.reqs.length > 0);
}

export function groupByComponent(model) {
  const reachedReqIds = new Set();
  const tacRows = [];
  for (const tac of model.tacs) {
    const usIds = model.usByTacId?.get(tac.tacId) ?? [];
    const stories = [];
    for (const usId of usIds) {
      const us = model.userStories.find((u) => u.usId === usId);
      if (!us) continue;
      const req = model.requirements.find((r) => r.reqId === us.reqId) ?? null;
      if (req) reachedReqIds.add(req.reqId);
      stories.push({ us, req });
    }
    const dependencies = Array.isArray(tac.dependencies)
      ? tac.dependencies.map((d) => (typeof d === 'string' ? d : d?.name ?? '')).filter(Boolean)
      : [];
    tacRows.push({
      tacId: tac.tacId,
      name: tac.name ?? '',
      dependencies,
      stories,
    });
  }
  const unmapped = model.requirements.filter((r) => !reachedReqIds.has(r.reqId));
  return { tacs: tacRows, unmapped };
}

export function groupByTraceCoverage(model) {
  const buckets = {
    'missing-stories': [],
    'missing-ac-scope': [],
    'missing-component': [],
    'missing-tests': [],
    complete: [],
  };
  const usIdsReachingRealTac = new Set();
  for (const usIds of model.usByTacId?.values() ?? []) {
    for (const usId of usIds) usIdsReachingRealTac.add(usId);
  }
  for (const req of model.requirements) {
    const stories = model.storiesByReqId.get(req.reqId) ?? [];
    if (stories.length === 0) {
      buckets['missing-stories'].push({ req, missing: 'no user stories under this REQ' });
      continue;
    }
    let acScopeGap = null;
    for (const us of stories) {
      const acIds = model.acIdsByUsId.get(us.usId) ?? [];
      if (acIds.length === 0) { acScopeGap = us.usId; break; }
    }
    if (acScopeGap) {
      buckets['missing-ac-scope'].push({ req, missing: `no ACs on ${acScopeGap}` });
      continue;
    }
    const hasTac = stories.some((us) => usIdsReachingRealTac.has(us.usId));
    if (!hasTac) {
      buckets['missing-component'].push({ req, missing: 'no story links to a real TAC (tacIds[] empty or dangling on every US)' });
      continue;
    }
    let missingTests = null;
    for (const us of stories) {
      const acIds = model.acIdsByUsId.get(us.usId) ?? [];
      for (const acId of acIds) {
        const tsList = model.tsByAcId?.get(acId) ?? [];
        const tcList = model.tcsByAcId?.get(acId) ?? [];
        if (tsList.length === 0 && tcList.length === 0) {
          missingTests = acId;
          break;
        }
      }
      if (missingTests) break;
    }
    if (missingTests) {
      buckets['missing-tests'].push({ req, missing: `no TS/TC covers ${missingTests}` });
      continue;
    }
    buckets.complete.push({ req, missing: '' });
  }
  const labels = {
    'missing-stories': 'Missing stories',
    'missing-ac-scope': 'Missing AC scope',
    'missing-component': 'Missing component owner',
    'missing-tests': 'Missing tests',
    complete: 'Complete',
  };
  return Object.entries(buckets)
    .map(([id, entries]) => ({ id, label: labels[id], entries }))
    .filter((b) => b.entries.length > 0);
}

export function capabilitiesForReq(req) {
  const tags = Array.isArray(req?.tags) ? req.tags : [];
  return tags
    .filter((t) => typeof t === 'string' && t.startsWith('capability:'))
    .map((t) => t.slice('capability:'.length))
    .filter(Boolean);
}

export function groupByCapability(model) {
  const bySlug = new Map();
  const unclassified = [];
  for (const req of model.requirements) {
    const slugs = capabilitiesForReq(req);
    if (slugs.length === 0) { unclassified.push(req); continue; }
    const seen = new Set();
    for (const slug of slugs) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      const list = bySlug.get(slug) ?? [];
      list.push(req);
      bySlug.set(slug, list);
    }
  }
  const sorted = [...bySlug.entries()]
    .map(([slug, reqs]) => ({ id: slug, label: slug, reqs }))
    .sort((a, b) => {
      if (b.reqs.length !== a.reqs.length) return b.reqs.length - a.reqs.length;
      return a.id.localeCompare(b.id);
    });
  if (unclassified.length > 0) {
    sorted.push({ id: 'unclassified', label: 'Unclassified', reqs: unclassified });
  }
  return sorted;
}

/**
 * Build the reqId -> blueprint-slug attribution map from a walked model.
 * Truth is manifest.blueprints[].contributions[] (each entry names the
 * kind + stamped id + on-disk path); we filter to kind === 'req'. When a
 * blueprint record carries no contributions[] we fall back to matching
 * the reqId's leading kebab-slug segment against the applied blueprint
 * slugs so older applied records still light up the badge.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {Map<string, string>} reqId -> blueprint slug
 */
export function buildBlueprintAttribution(model) {
  const attribution = new Map();
  const manifest = model?.manifest ?? null;
  const applied = Array.isArray(manifest?.blueprints) ? manifest.blueprints : [];
  const appliedSlugs = new Set();
  for (const record of applied) {
    if (typeof record?.slug !== 'string' || record.slug.length === 0) continue;
    appliedSlugs.add(record.slug);
    const { contributionIds } = contributionsForBlueprint(manifest, record.slug);
    if (!Array.isArray(contributionIds) || contributionIds.length === 0) continue;
    // contributionIds is every stamped contribution id (any kind); the
    // renderer only cares about REQs, so intersect with the tree's REQ ids.
    for (const id of contributionIds) {
      if (typeof id !== 'string') continue;
      // Keep first-writer-wins: if the same REQ id somehow appears in
      // more than one blueprint's contributions (should not happen
      // under apply.js's stamping rule, but defensive), the first
      // record's slug sticks so the badge is stable.
      if (!attribution.has(id)) attribution.set(id, record.slug);
    }
  }
  // id-prefix fallback: only kick in when a REQ has no direct match
  // above. We look for the longest applied-slug prefix on the reqId
  // (case-sensitive kebab), then confirm the next character is '-' so
  // "auth" does not match "authentication".
  if (appliedSlugs.size > 0) {
    const sortedSlugs = [...appliedSlugs].sort((a, b) => b.length - a.length);
    for (const req of model.requirements) {
      const id = req?.reqId;
      if (typeof id !== 'string') continue;
      if (attribution.has(id)) continue;
      for (const slug of sortedSlugs) {
        if (id.length > slug.length + 1 && id.startsWith(slug) && id[slug.length] === '-') {
          attribution.set(id, slug);
          break;
        }
      }
    }
  }
  return attribution;
}

/**
 * Build the by-blueprint buckets. One bucket per entry in
 * manifest.blueprints[] plus a Project bucket for the project's own
 * REQs (REQs with no attribution). Blueprint buckets are ordered by
 * REQ count desc then by slug alphabetically; Project is always last.
 * When the manifest has no applied blueprints, only the Project bucket
 * appears.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {Array<{ id: string, label: string, reqs: object[], isProject: boolean }>}
 */
export function groupByBlueprint(model) {
  const attribution = buildBlueprintAttribution(model);
  const bySlug = new Map();
  const project = [];
  const manifest = model?.manifest ?? null;
  const applied = Array.isArray(manifest?.blueprints) ? manifest.blueprints : [];
  for (const record of applied) {
    if (typeof record?.slug !== 'string' || record.slug.length === 0) continue;
    if (!bySlug.has(record.slug)) bySlug.set(record.slug, { record, reqs: [] });
  }
  for (const req of model.requirements) {
    const slug = attribution.get(req.reqId) ?? null;
    if (slug && bySlug.has(slug)) {
      bySlug.get(slug).reqs.push(req);
    } else {
      project.push(req);
    }
  }
  const sorted = [...bySlug.entries()]
    .map(([slug, entry]) => ({
      id: slug,
      label: slug,
      reqs: entry.reqs,
      isProject: false,
    }))
    .sort((a, b) => {
      if (b.reqs.length !== a.reqs.length) return b.reqs.length - a.reqs.length;
      return a.id.localeCompare(b.id);
    });
  sorted.push({
    id: PROJECT_BUCKET_ID,
    label: PROJECT_BUCKET_LABEL,
    reqs: project,
    isProject: true,
  });
  return sorted;
}

/**
 * Return per-status counts for a REQ list. Keys are the STATUS_MINI ids
 * plus the total across all REQs (as `total`). REQs with an unknown or
 * missing status count towards `total` only.
 */
function statusMiniCounts(reqs) {
  const out = { total: reqs.length };
  for (const s of STATUS_MINI) out[s] = 0;
  for (const r of reqs) {
    const s = r?.status ?? '';
    if (Object.prototype.hasOwnProperty.call(out, s)) out[s] += 1;
  }
  return out;
}

function renderStatusMini(counts) {
  const nonZero = STATUS_MINI.filter((s) => (counts[s] ?? 0) > 0);
  // Polish (Baz 2026-09-22): when a bucket has exactly one status
  // represented and its count equals the total, the mini pill just
  // repeats the "(n)" total on the summary row. Suppress it so
  // "(21) 21" becomes "(21)"; buckets with a real split (e.g.
  // Unclassified "52 / 7") still render the mini row.
  if (nonZero.length === 1 && counts[nonZero[0]] === counts.total) return '';
  const pills = nonZero
    .map((s) => `<span class="pm-mini pm-mini-${escapeHtml(s)}" title="${escapeHtml(s)}: ${counts[s]}">${counts[s]}</span>`)
    .join('');
  return pills ? `<span class="pm-mini-row">${pills}</span>` : '';
}

/**
 * Render the summary row for a pm-bucket <details>. `label` is the
 * display name, `id` is the bucket key, `total` is the REQ count, and
 * `mini` is the STATUS_MINI counts object.
 */
function bucketSummary({ label, id, total, mini }) {
  return `<summary class="pm-bucket-heading">`
    + `<span class="pm-bucket-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`
    + ` <span class="pm-bucket-count">(${total})</span>`
    + ` ${renderStatusMini(mini)}`
    + `<span class="pm-bucket-anchor" aria-hidden="true"> ${escapeHtml(id)}</span>`
    + `</summary>`;
}

function bucketOpen(group, id, body, { statusCoveredBy } = {}) {
  const dataDocId = `pm-bucket:${group}:${id}`;
  const attr = statusCoveredBy
    ? ` data-pm-bucket-statuses="${escapeHtml(statusCoveredBy.join(','))}"`
    : '';
  return `<details class="pm-bucket" data-pm-bucket-id="${escapeHtml(id)}" data-doc-id="${escapeHtml(dataDocId)}"${attr}>${body}</details>`;
}

/**
 * Render the jump-nav chip row for a grouping. Each chip carries its
 * bucket id + count. The client wires clicks to open + scroll.
 */
function renderJumpNav(group, entries) {
  if (entries.length === 0) return '';
  const chips = entries.map(({ id, label, total, mini }) => (
    `<button type="button" class="pm-jump-chip" data-pm-jump="${escapeHtml(id)}" data-pm-jump-total="${total}" title="${escapeHtml(label)}">`
      + `<span class="pm-jump-label">${escapeHtml(label)}</span>`
      + `<span class="pm-jump-count">${total}</span>`
    + `</button>`
  )).join('');
  return `<nav class="pm-jump-nav" aria-label="Buckets in this grouping" data-pm-jump-group="${escapeHtml(group)}">${chips}</nav>`;
}

/**
 * Render the empty-buckets-under-filter placeholder. Empty buckets keep
 * their <details> but pick up data-pm-empty-under-filter="true" on the
 * client after a filter change; the client rolls them into a summary
 * line above the grouping.
 */
function emptyPlaceholder() {
  return `<div class="pm-empty-roll" hidden><button type="button" class="pm-empty-toggle">Show <span class="pm-empty-count">0</span> empty buckets</button></div>`;
}

export function renderProductMapPanel(model, opts = {}) {
  // Lazy render (AC-17007-1): the initial page ships only bucket
  // headings for every grouping. The client fetches the active
  // grouping's REQ cards from /product-map/<name> when it activates.
  // Callers that need a full render (tests, the partial endpoint pre-
  // render on the server) pass `lazy: new Set()`.
  const { lazy = new Set(GROUPINGS) } = opts;
  const attribution = buildBlueprintAttribution(model);
  const shape = groupByShape(model);
  const component = groupByComponent(model);
  const trace = groupByTraceCoverage(model);
  const capability = groupByCapability(model);
  const blueprint = groupByBlueprint(model);

  const shapeSection = renderShapeGrouping(model, shape, { lazy: lazy.has('shape'), attribution });
  const componentSection = renderComponentGrouping(model, component, { lazy: lazy.has('component'), attribution });
  const traceSection = renderTraceGrouping(model, trace, { lazy: lazy.has('trace'), attribution });
  const capabilitySection = renderCapabilityGrouping(model, capability, { lazy: lazy.has('capability'), attribution });
  const blueprintSection = renderBlueprintGrouping(model, blueprint, { lazy: lazy.has('blueprint'), attribution });

  const groupButtons = GROUPINGS.map((g) => (
    `<button type="button" role="tab" class="pm-group-btn" data-pm-group="${g}"`
      + `${g === DEFAULT_GROUPING ? ' aria-selected="true"' : ' aria-selected="false"'}`
      + ` aria-controls="pm-group-${g}">${escapeHtml(pmGroupLabel(g))}</button>`
  )).join('');

  const statusOptions = STATUSES.map((s) => (
    `<option value="${escapeHtml(s)}"${s === DEFAULT_STATUS ? ' selected' : ''}>${escapeHtml(s)}</option>`
  )).join('');

  return `
<div class="pm-controls" role="toolbar" aria-label="Product Map controls">
  <div class="pm-group-tabs" role="tablist" aria-label="Product Map grouping">
    ${groupButtons}
  </div>
  <label class="pm-status-filter">
    <span>Status</span>
    <select class="pm-status-select" aria-label="Filter Product Map by REQ status">${statusOptions}</select>
  </label>
  <div class="pm-bulk">
    <button type="button" class="pm-bulk-btn" data-pm-bulk="expand" title="Expand every bucket in this grouping">Expand all</button>
    <button type="button" class="pm-bulk-btn" data-pm-bulk="collapse" title="Collapse every bucket in this grouping">Collapse all</button>
  </div>
</div>
<section id="pm-group-shape" class="pm-group" data-pm-group="shape" role="tabpanel"${lazy.has('shape') ? ' data-pm-lazy="true"' : ''}>
  <h3 class="pm-group-heading">By shape</h3>
  ${shapeSection}
</section>
<section id="pm-group-component" class="pm-group" data-pm-group="component" role="tabpanel" hidden${lazy.has('component') ? ' data-pm-lazy="true"' : ''}>
  <h3 class="pm-group-heading">By component</h3>
  ${componentSection}
</section>
<section id="pm-group-trace" class="pm-group" data-pm-group="trace" role="tabpanel" hidden${lazy.has('trace') ? ' data-pm-lazy="true"' : ''}>
  <h3 class="pm-group-heading">By trace coverage</h3>
  ${traceSection}
</section>
<section id="pm-group-capability" class="pm-group" data-pm-group="capability" role="tabpanel" hidden${lazy.has('capability') ? ' data-pm-lazy="true"' : ''}>
  <h3 class="pm-group-heading">By capability</h3>
  ${capabilitySection}
</section>
<section id="pm-group-blueprint" class="pm-group" data-pm-group="blueprint" role="tabpanel" hidden${lazy.has('blueprint') ? ' data-pm-lazy="true"' : ''}>
  <h3 class="pm-group-heading">By blueprint</h3>
  ${blueprintSection}
</section>
`.trim();
}

/**
 * Render a single grouping section body (the innerHTML that goes into
 * `<section id="pm-group-<name>">`). Used by the /product-map/<name>
 * partial endpoint (AC-17007-1) for on-demand hydration. Full render
 * with jump nav and REQ cards; never lazy.
 */
export function renderProductMapGrouping(model, group) {
  const attribution = buildBlueprintAttribution(model);
  switch (group) {
    case 'shape': return renderShapeGrouping(model, groupByShape(model), { lazy: false, attribution });
    case 'component': return renderComponentGrouping(model, groupByComponent(model), { lazy: false, attribution });
    case 'trace': return renderTraceGrouping(model, groupByTraceCoverage(model), { lazy: false, attribution });
    case 'capability': return renderCapabilityGrouping(model, groupByCapability(model), { lazy: false, attribution });
    case 'blueprint': return renderBlueprintGrouping(model, groupByBlueprint(model), { lazy: false, attribution });
    default: return '<p><em>Unknown grouping.</em></p>';
  }
}

function pmGroupLabel(g) {
  return {
    shape: 'Shape',
    component: 'Component',
    trace: 'Trace coverage',
    capability: 'Capability',
    blueprint: 'Blueprint',
  }[g] ?? g;
}

function renderReqDrilldown(model, req, prefix) {
  const idPrefix = prefix ?? '';
  const reqBody = renderReq(req, {
    raw: model.rawById.get(req.reqId),
    errors: model.errorsById.get(req.reqId),
    subdiagram: undefined,
    idPrefix,
    suppressRawJson: true,
  });
  const stories = model.storiesByReqId.get(req.reqId) ?? [];
  const usBlocks = stories.map((u) => detailsWrap({
    id: `${idPrefix}${u.usId}`,
    summary: `${u.usId} - ${u.title ?? ''}`,
    className: 'doc-us-wrap pm-us',
    status: u.status,
    body: renderUserStory(u, {
      raw: model.rawById.get(u.usId),
      errors: model.errorsById.get(u.usId),
      fbsByAcId: model.fbsByAcId,
      idPrefix,
      suppressRawJson: true,
    }),
  })).join('\n');
  const storiesSection = usBlocks
    ? `<section class="nested-details"><h4>User stories</h4>${usBlocks}</section>`
    : '<p><em>No user stories under this requirement.</em></p>';
  return detailsWrap({
    id: `${idPrefix}${req.reqId}`,
    summary: `${req.reqId} - ${req.title ?? ''}`,
    className: 'doc-req-wrap pm-req',
    status: req.status,
    body: `<div class="pm-req-body" data-req-id="${escapeHtml(req.reqId)}" data-req-status="${escapeHtml(req.status ?? '')}">${reqBody}\n${storiesSection}</div>`,
  });
}

/**
 * Render a blueprint badge for a REQ, or empty string when the REQ has
 * no blueprint attribution. Slug is HTML-escaped and doubles as the
 * badge's title (hover text) so a reader can see which blueprint the
 * badge represents without opening the by-blueprint tab.
 */
function renderBlueprintBadge(attribution, reqId) {
  const slug = attribution?.get?.(reqId);
  if (!slug) return '';
  const s = escapeHtml(slug);
  return `<span class="pm-blueprint-badge" data-pm-blueprint-slug="${s}" title="Contributed by blueprint: ${s}">${s}</span>`;
}

function renderReqWrapper(model, req, prefix, { attribution } = {}) {
  const inner = renderReqDrilldown(model, req, prefix);
  const status = req.status ?? '';
  // Splice data-req-status onto the outer details AND inject the
  // blueprint badge into the summary so every grouping's REQ row shows
  // the badge without touching detailsWrap in the shared helpers.
  const badge = renderBlueprintBadge(attribution, req.reqId);
  let out = inner.replace('<details class="doc-details doc-req-wrap pm-req"',
    `<details class="doc-details doc-req-wrap pm-req" data-req-status="${escapeHtml(status)}"`);
  if (badge) {
    out = out.replace('</span><span class="status ', `</span>${badge}<span class="status `);
    // Fallback splice for REQs without a status pill: inject the badge
    // just before </summary>. Keeps the badge visible on statusless
    // fixture rows.
    if (!out.includes('pm-blueprint-badge')) {
      out = out.replace('</summary>', `${badge}</summary>`);
    }
  }
  return out;
}

function renderShapeGrouping(model, buckets, { lazy, attribution }) {
  if (buckets.length === 0) return '<p><em>No requirements on disk.</em></p>';
  const jumpEntries = buckets.map((b) => ({
    id: b.id,
    label: b.label,
    total: b.reqs.length,
    mini: statusMiniCounts(b.reqs),
  }));
  const jump = renderJumpNav('shape', jumpEntries);
  const empty = emptyPlaceholder();
  const bucketsHtml = buckets.map((b) => {
    const prefix = `pm-shape-${b.id}-`;
    const mini = statusMiniCounts(b.reqs);
    const body = lazy
      ? ''
      : b.reqs.map((r) => renderReqWrapper(model, r, prefix, { attribution })).join('\n');
    const summary = bucketSummary({ label: b.label, id: b.id, total: b.reqs.length, mini });
    const contents = `${summary}<div class="pm-bucket-body">${body}</div>`;
    return bucketOpen('shape', b.id, contents, { statusCoveredBy: statusesPresent(b.reqs) });
  }).join('\n');
  return `${jump}${empty}${bucketsHtml}`;
}

function statusesPresent(reqs) {
  const s = new Set();
  for (const r of reqs) if (r?.status) s.add(r.status);
  return [...s];
}

function renderComponentGrouping(model, { tacs, unmapped }, { lazy, attribution }) {
  const tadHeading = model.tad
    ? `<div class="pm-tad-root"><h4>${escapeHtml(model.tad.tadId)} - ${escapeHtml(model.tad.title ?? model.tad.name ?? '')}</h4></div>`
    : '';
  const componentReqs = (t) => t.stories.map((s) => s.req).filter(Boolean);
  const jumpEntries = tacs.map((t) => ({
    id: t.tacId,
    label: `${t.tacId} - ${t.name}`,
    total: t.stories.length,
    mini: statusMiniCounts(componentReqs(t)),
  }));
  if (unmapped.length > 0) {
    jumpEntries.push({
      id: 'unmapped',
      label: 'Unmapped',
      total: unmapped.length,
      mini: statusMiniCounts(unmapped),
    });
  }
  const jump = renderJumpNav('component', jumpEntries);
  const empty = emptyPlaceholder();
  const tacBlocks = tacs.map((t) => {
    const mini = statusMiniCounts(componentReqs(t));
    const summary = bucketSummary({ label: `${t.tacId} - ${t.name}`, id: t.tacId, total: t.stories.length, mini });
    const depsLine = t.dependencies.length > 0
      ? `<p class="pm-tac-deps"><strong>Dependencies:</strong> ${t.dependencies.map((d) => escapeHtml(d)).join(', ')}</p>`
      : '<p class="pm-tac-deps"><em>No dependencies.</em></p>';
    const storyBlocks = lazy ? '' : t.stories.map(({ us, req }) => {
      const badge = renderBlueprintBadge(attribution, req?.reqId ?? '');
      const reqLine = req
        ? `<p class="pm-req-parent"><strong>Parent REQ:</strong> <a href="#pm-comp-${escapeHtml(t.tacId)}-${escapeHtml(req.reqId)}">${escapeHtml(req.reqId)} - ${escapeHtml(req.title ?? '')}</a>${badge} <span class="status ${escapeHtml(req.status ?? '')}">${escapeHtml(req.status ?? '')}</span></p>`
        : '<p class="pm-req-parent"><em>Orphan story (no reqId).</em></p>';
      const usBody = renderUserStory(us, {
        raw: model.rawById.get(us.usId),
        errors: model.errorsById.get(us.usId),
        fbsByAcId: model.fbsByAcId,
        idPrefix: `pm-comp-${t.tacId}-`,
        suppressRawJson: true,
      });
      const usInner = detailsWrap({
        id: `pm-comp-${t.tacId}-${us.usId}`,
        summary: `${us.usId} - ${us.title ?? ''}`,
        className: 'doc-us-wrap pm-us',
        status: us.status,
        body: `${reqLine}${usBody}`,
      });
      return `<div class="pm-comp-story" data-req-status="${escapeHtml(req?.status ?? '')}">${usInner}</div>`;
    }).join('\n');
    const body = `${summary}<div class="pm-bucket-body">${depsLine}${storyBlocks || (lazy ? '' : '<p class="pm-bucket-empty"><em>No stories linked to this component.</em></p>')}</div>`;
    return bucketOpen('component', t.tacId, body);
  }).join('\n');
  const unmappedBlock = unmapped.length > 0
    ? (() => {
        const mini = statusMiniCounts(unmapped);
        const summary = bucketSummary({ label: 'Unmapped', id: 'unmapped', total: unmapped.length, mini });
        const body = lazy ? '' : unmapped.map((r) => renderReqWrapper(model, r, 'pm-comp-unmapped-', { attribution })).join('\n');
        return bucketOpen('component', 'unmapped', `${summary}<div class="pm-bucket-body">${body}</div>`);
      })()
    : '';
  return `${tadHeading}${jump}${empty}${tacBlocks}${unmappedBlock}`.trim();
}

function renderTraceGrouping(model, buckets, { lazy, attribution }) {
  if (buckets.length === 0) return '<p><em>No requirements on disk.</em></p>';
  const jumpEntries = buckets.map((b) => ({
    id: b.id,
    label: b.label,
    total: b.entries.length,
    mini: statusMiniCounts(b.entries.map((e) => e.req)),
  }));
  const jump = renderJumpNav('trace', jumpEntries);
  const empty = emptyPlaceholder();
  const bucketsHtml = buckets.map((b) => {
    const prefix = `pm-trace-${b.id}-`;
    const mini = statusMiniCounts(b.entries.map((e) => e.req));
    const summary = bucketSummary({ label: b.label, id: b.id, total: b.entries.length, mini });
    const rows = lazy ? '' : b.entries.map(({ req, missing }) => {
      const missingLine = missing
        ? `<p class="pm-trace-missing"><strong>Missing:</strong> ${escapeHtml(missing)}</p>`
        : '<p class="pm-trace-missing"><em>Nothing missing.</em></p>';
      const reqInner = renderReqWrapper(model, req, prefix, { attribution });
      return `<div class="pm-trace-row" data-req-status="${escapeHtml(req.status ?? '')}">${missingLine}${reqInner}</div>`;
    }).join('\n');
    return bucketOpen('trace', b.id, `${summary}<div class="pm-bucket-body">${rows}</div>`);
  }).join('\n');
  return `${jump}${empty}${bucketsHtml}`;
}

function renderCapabilityGrouping(model, buckets, { lazy, attribution }) {
  if (buckets.length === 0) return '<p><em>No requirements on disk.</em></p>';
  const jumpEntries = buckets.map((b) => ({
    id: `capability-${b.id}`,
    label: b.label,
    total: b.reqs.length,
    mini: statusMiniCounts(b.reqs),
  }));
  const jump = renderJumpNav('capability', jumpEntries);
  const empty = emptyPlaceholder();
  const bucketsHtml = buckets.map((b) => {
    const idAttr = `capability-${b.id}`;
    const prefix = `pm-${idAttr}-`;
    const mini = statusMiniCounts(b.reqs);
    const summary = bucketSummary({ label: b.label, id: idAttr, total: b.reqs.length, mini });
    const body = lazy ? '' : b.reqs.map((r) => renderReqWrapper(model, r, prefix, { attribution })).join('\n');
    return bucketOpen('capability', idAttr, `${summary}<div class="pm-bucket-body">${body}</div>`);
  }).join('\n');
  return `${jump}${empty}${bucketsHtml}`;
}

/**
 * By-blueprint grouping. Emits one <details class="pm-bucket"> per
 * applied blueprint plus a Project bucket. Inside each bucket the
 * second level is capability (multi-tag REQs appear in each capability
 * sub-heading; untagged REQs collect under an Unclassified sub-heading),
 * and inside each capability sub-heading are the usual pm-req rows with
 * REQ->US->AC drill-down. Each bucket's REQ rows carry the blueprint
 * badge in every grouping via renderReqWrapper.
 */
function renderBlueprintGrouping(model, buckets, { lazy, attribution }) {
  if (buckets.length === 0) return '<p><em>No requirements on disk.</em></p>';
  const jumpEntries = buckets.map((b) => ({
    id: `blueprint-${b.id}`,
    label: b.isProject ? `${b.label} (project's own)` : b.label,
    total: b.reqs.length,
    mini: statusMiniCounts(b.reqs),
  }));
  const jump = renderJumpNav('blueprint', jumpEntries);
  const empty = emptyPlaceholder();
  const bucketsHtml = buckets.map((b) => {
    const idAttr = `blueprint-${b.id}`;
    const prefix = `pm-${idAttr}-`;
    const mini = statusMiniCounts(b.reqs);
    const summary = bucketSummary({
      label: b.isProject ? `${b.label} (project's own)` : b.label,
      id: idAttr,
      total: b.reqs.length,
      mini,
    });
    const body = lazy
      ? ''
      : renderCapabilitySubBuckets(model, b.reqs, prefix, { attribution });
    return bucketOpen('blueprint', idAttr, `${summary}<div class="pm-bucket-body">${body}</div>`);
  }).join('\n');
  return `${jump}${empty}${bucketsHtml}`;
}

/**
 * Render the second level (capability) inside a by-blueprint bucket.
 * Groups the bucket's REQs by capability slug (same rule as
 * groupByCapability), emits a <section class="pm-blueprint-cap"> per
 * capability with an <h4> heading, then the pm-req cards inside.
 */
function renderCapabilitySubBuckets(model, reqs, prefix, { attribution }) {
  if (reqs.length === 0) return '<p class="pm-bucket-empty"><em>No requirements in this bucket.</em></p>';
  const capSub = groupByCapability({ requirements: reqs });
  return capSub.map((cap) => {
    const capHeading = cap.id === 'unclassified' ? 'Unclassified' : cap.label;
    const capReqs = cap.reqs.map((r) => renderReqWrapper(model, r, `${prefix}${cap.id}-`, { attribution })).join('\n');
    return `<section class="pm-blueprint-cap" data-pm-blueprint-capability="${escapeHtml(cap.id)}">`
      + `<h4 class="pm-blueprint-cap-heading">${escapeHtml(capHeading)} <span class="pm-blueprint-cap-count">(${cap.reqs.length})</span></h4>`
      + `<div class="pm-blueprint-cap-body">${capReqs}</div>`
      + `</section>`;
  }).join('');
}
