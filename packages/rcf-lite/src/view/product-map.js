// Product Map tab: re-buckets the review-surface tree model by product-
// shaped axes rather than the flat REQ list the Requirements tab shows.
// Four groupings + a status filter, all applied to the same in-memory
// BuiltTreeModel. Pure over the tree model - no I/O, no schema change,
// no walker work. Groupings ride on the maps the walker already computes
// (childrenByParent, storiesByReqId, usByTacId, acIdsByUsId, tsByAcId,
// tcsByAcId, fbsByAcId) and on the REQ document's own tags[] and
// shapeClassification.shapes[] fields.
//
// Spec: projects/rcf-lite-wsd/docs/2026-09-21_product-map-proposal.md.
// Chain: REQ-170 (tab) + REQ-171 (capability tag convention).

import { detailsWrap, escapeHtml } from './doc-renderers/helpers.js';
import { renderReq, renderUserStory } from './doc-renderers/index.js';

export const GROUPINGS = ['shape', 'component', 'trace', 'capability'];
export const STATUSES = ['all', 'draft', 'review', 'needsRevision', 'approved', 'superseded'];
export const DEFAULT_GROUPING = 'shape';
export const DEFAULT_STATUS = 'all';

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

/**
 * Return the shape bucket ids each REQ belongs to. A REQ can appear
 * under more than one shape. REQs without a shapeClassification return
 * ['unclassified']. Classified REQs whose shapes[] is empty are
 * treated as unclassified.
 */
export function shapesForReq(req) {
  const shapes = req?.shapeClassification?.shapes;
  if (!Array.isArray(shapes) || shapes.length === 0) return ['unclassified'];
  return [...shapes];
}

/**
 * Bucket the REQ set by shape.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {{ id: string, label: string, reqs: object[] }[]}
 */
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

/**
 * Bucket the REQ set by TAC (component). Level 1 = TACs, level 2 = US
 * stories under the TAC (usByTacId), level 3 = each story's parent REQ
 * (us.reqId), level 4 = ACs. REQs reachable by no TAC are collected in
 * an "unmapped" bucket.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {{
 *   tacs: { tacId: string, name: string, dependencies: string[], stories: { us: object, req: object|null }[] }[],
 *   unmapped: object[],
 * }}
 */
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

/**
 * Bucket the REQ set by trace-coverage completeness. Order matters: a
 * REQ is placed in the FIRST bucket whose condition it meets.
 *
 * Buckets (in order):
 *   missing-stories       - no US attached
 *   missing-ac-scope      - a US has no ACs
 *   missing-component     - no US carries a tacIds link to any TAC
 *   missing-tests         - some AC has no test suite / test case coverage
 *   complete              - none of the above
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {{ id: string, label: string, entries: { req: object, missing: string }[] }[]}
 */
export function groupByTraceCoverage(model) {
  const buckets = {
    'missing-stories': [],
    'missing-ac-scope': [],
    'missing-component': [],
    'missing-tests': [],
    complete: [],
  };
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
    const hasTac = stories.some((us) => Array.isArray(us.tacIds) && us.tacIds.length > 0);
    if (!hasTac) {
      buckets['missing-component'].push({ req, missing: 'no story links to a TAC (tacIds[] is empty on every US)' });
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

/**
 * Extract every capability:<slug> tag on a REQ. Returns an array of
 * slug strings (without the `capability:` prefix). REQs without any
 * capability tag return [].
 */
export function capabilitiesForReq(req) {
  const tags = Array.isArray(req?.tags) ? req.tags : [];
  return tags
    .filter((t) => typeof t === 'string' && t.startsWith('capability:'))
    .map((t) => t.slice('capability:'.length))
    .filter(Boolean);
}

/**
 * Bucket the REQ set by capability tag. Multi-tag REQs appear under
 * every capability they carry. REQs with no capability tag land in
 * "unclassified".
 *
 * Buckets sorted by REQ count desc, then alphabetically. Unclassified
 * is always rendered last.
 */
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
 * Render the Product Map tab panel body. Server-side render includes
 * every grouping's DOM; the inline script's product-map wiring hides
 * all but the active grouping and applies the status filter. Every
 * REQ block carries a `data-req-status="<status>"` attribute so the
 * status filter is a client-side DOM query.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {string}
 */
export function renderProductMapPanel(model) {
  const shape = groupByShape(model);
  const component = groupByComponent(model);
  const trace = groupByTraceCoverage(model);
  const capability = groupByCapability(model);

  const shapeSection = renderShapeSection(model, shape);
  const componentSection = renderComponentSection(model, component);
  const traceSection = renderTraceSection(model, trace);
  const capabilitySection = renderCapabilitySection(model, capability);

  const groupButtons = GROUPINGS.map((g) => (
    `<button type="button" role="tab" class="pm-group-btn" data-pm-group="${g}"`
      + `${g === DEFAULT_GROUPING ? ' aria-selected="true"' : ' aria-selected="false"'}`
      + ` aria-controls="pm-group-${g}">${escapeHtml(pmGroupLabel(g))}</button>`
  )).join('');

  const statusOptions = STATUSES.map((s) => (
    `<option value="${escapeHtml(s)}"${s === DEFAULT_STATUS ? ' selected' : ''}>${escapeHtml(s)}</option>`
  )).join('');

  return `
<div class="pm-controls">
  <div class="pm-group-tabs" role="tablist" aria-label="Product Map grouping">
    ${groupButtons}
  </div>
  <label class="pm-status-filter">
    <span>Status:</span>
    <select class="pm-status-select" aria-label="Filter Product Map by REQ status">${statusOptions}</select>
  </label>
</div>
<section id="pm-group-shape" class="pm-group" data-pm-group="shape" role="tabpanel">
  <h3 class="pm-group-heading">By shape</h3>
  ${shapeSection}
</section>
<section id="pm-group-component" class="pm-group" data-pm-group="component" role="tabpanel" hidden>
  <h3 class="pm-group-heading">By component</h3>
  ${componentSection}
</section>
<section id="pm-group-trace" class="pm-group" data-pm-group="trace" role="tabpanel" hidden>
  <h3 class="pm-group-heading">By trace coverage</h3>
  ${traceSection}
</section>
<section id="pm-group-capability" class="pm-group" data-pm-group="capability" role="tabpanel" hidden>
  <h3 class="pm-group-heading">By capability</h3>
  ${capabilitySection}
</section>
`.trim();
}

function pmGroupLabel(g) {
  return {
    shape: 'Shape',
    component: 'Component',
    trace: 'Trace coverage',
    capability: 'Capability',
  }[g] ?? g;
}

function renderReqDrilldown(model, req) {
  const reqBody = renderReq(req, {
    raw: model.rawById.get(req.reqId),
    errors: model.errorsById.get(req.reqId),
    subdiagram: undefined,
  });
  const stories = model.storiesByReqId.get(req.reqId) ?? [];
  const usBlocks = stories.map((u) => detailsWrap({
    id: `pm-${u.usId}`,
    summary: `${u.usId} - ${u.title ?? ''}`,
    className: 'doc-us-wrap pm-us',
    status: u.status,
    body: renderUserStory(u, {
      raw: model.rawById.get(u.usId),
      errors: model.errorsById.get(u.usId),
      fbsByAcId: model.fbsByAcId,
    }),
  })).join('\n');
  const storiesSection = usBlocks
    ? `<section class="nested-details"><h4>User stories</h4>${usBlocks}</section>`
    : '<p><em>No user stories under this requirement.</em></p>';
  return detailsWrap({
    id: `pm-${req.reqId}`,
    summary: `${req.reqId} - ${req.title ?? ''}`,
    className: 'doc-req-wrap pm-req',
    status: req.status,
    body: `<div class="pm-req-body" data-req-id="${escapeHtml(req.reqId)}" data-req-status="${escapeHtml(req.status ?? '')}">${reqBody}\n${storiesSection}</div>`,
  });
}

function renderReqWrapper(model, req) {
  // Adds the data-req-status attribute at the outer details level so the
  // client-side status filter can hide the whole REQ card (and its
  // stories/ACs beneath) with a single query.
  const inner = renderReqDrilldown(model, req);
  const status = req.status ?? '';
  // Splice data-req-status into the outer <details>.
  return inner.replace('<details class="doc-details doc-req-wrap pm-req"',
    `<details class="doc-details doc-req-wrap pm-req" data-req-status="${escapeHtml(status)}"`);
}

function renderShapeSection(model, buckets) {
  if (buckets.length === 0) return '<p><em>No requirements on disk.</em></p>';
  return buckets.map((b) => {
    const reqBlocks = b.reqs.map((r) => renderReqWrapper(model, r)).join('\n');
    return `
<section class="pm-bucket" data-pm-bucket-id="${escapeHtml(b.id)}">
  <h4 class="pm-bucket-heading"><span class="pm-bucket-label">${escapeHtml(b.label)}</span> <span class="pm-bucket-count">(${b.reqs.length})</span></h4>
  ${reqBlocks || '<p class="pm-bucket-empty"><em>0 requirements match this filter.</em></p>'}
</section>`.trim();
  }).join('\n');
}

function renderComponentSection(model, { tacs, unmapped }) {
  const tadHeading = model.tad
    ? `<div class="pm-tad-root"><h4>${escapeHtml(model.tad.tadId)} - ${escapeHtml(model.tad.title ?? model.tad.name ?? '')}</h4></div>`
    : '';
  const tacBlocks = tacs.map((t) => {
    const depsLine = t.dependencies.length > 0
      ? `<p class="pm-tac-deps"><strong>Dependencies:</strong> ${t.dependencies.map((d) => escapeHtml(d)).join(', ')}</p>`
      : '<p class="pm-tac-deps"><em>No dependencies.</em></p>';
    const storyBlocks = t.stories.map(({ us, req }) => {
      const usInner = detailsWrap({
        id: `pm-comp-${us.usId}`,
        summary: `${us.usId} - ${us.title ?? ''}`,
        className: 'doc-us-wrap pm-us',
        status: us.status,
        body: renderUserStory(us, {
          raw: model.rawById.get(us.usId),
          errors: model.errorsById.get(us.usId),
          fbsByAcId: model.fbsByAcId,
        }),
      });
      const reqLine = req
        ? `<p class="pm-req-parent"><strong>Parent REQ:</strong> <a href="#${escapeHtml(req.reqId)}">${escapeHtml(req.reqId)} - ${escapeHtml(req.title ?? '')}</a> <span class="status ${escapeHtml(req.status ?? '')}">${escapeHtml(req.status ?? '')}</span></p>`
        : '<p class="pm-req-parent"><em>Orphan story (no reqId).</em></p>';
      return `<div class="pm-comp-story" data-req-status="${escapeHtml(req?.status ?? '')}">${reqLine}${usInner}</div>`;
    }).join('\n');
    return `
<section class="pm-bucket" data-pm-bucket-id="${escapeHtml(t.tacId)}">
  <h4 class="pm-bucket-heading"><span class="pm-bucket-label">${escapeHtml(t.tacId)} - ${escapeHtml(t.name)}</span> <span class="pm-bucket-count">(${t.stories.length})</span></h4>
  ${depsLine}
  ${storyBlocks || '<p class="pm-bucket-empty"><em>No stories linked to this component.</em></p>'}
</section>`.trim();
  }).join('\n');
  const unmappedBlock = unmapped.length > 0
    ? `<section class="pm-bucket pm-bucket-unmapped" data-pm-bucket-id="unmapped">
  <h4 class="pm-bucket-heading"><span class="pm-bucket-label">Unmapped</span> <span class="pm-bucket-count">(${unmapped.length})</span></h4>
  ${unmapped.map((r) => renderReqWrapper(model, r)).join('\n')}
</section>`
    : '';
  return `${tadHeading}${tacBlocks}${unmappedBlock}`.trim();
}

function renderTraceSection(model, buckets) {
  if (buckets.length === 0) return '<p><em>No requirements on disk.</em></p>';
  return buckets.map((b) => {
    const rows = b.entries.map(({ req, missing }) => {
      const missingLine = missing
        ? `<p class="pm-trace-missing"><strong>Missing:</strong> ${escapeHtml(missing)}</p>`
        : '<p class="pm-trace-missing"><em>Nothing missing.</em></p>';
      const reqInner = renderReqWrapper(model, req);
      return `<div class="pm-trace-row" data-req-status="${escapeHtml(req.status ?? '')}">${missingLine}${reqInner}</div>`;
    }).join('\n');
    return `
<section class="pm-bucket" data-pm-bucket-id="${escapeHtml(b.id)}">
  <h4 class="pm-bucket-heading"><span class="pm-bucket-label">${escapeHtml(b.label)}</span> <span class="pm-bucket-count">(${b.entries.length})</span></h4>
  ${rows}
</section>`.trim();
  }).join('\n');
}

function renderCapabilitySection(model, buckets) {
  if (buckets.length === 0) return '<p><em>No requirements on disk.</em></p>';
  return buckets.map((b) => {
    const reqBlocks = b.reqs.map((r) => renderReqWrapper(model, r)).join('\n');
    const idAttr = `capability-${b.id}`;
    return `
<section class="pm-bucket" data-pm-bucket-id="${escapeHtml(idAttr)}">
  <h4 class="pm-bucket-heading"><span class="pm-bucket-label">${escapeHtml(b.label)}</span> <span class="pm-bucket-count">(${b.reqs.length})</span></h4>
  ${reqBlocks || '<p class="pm-bucket-empty"><em>0 requirements match this filter.</em></p>'}
</section>`.trim();
  }).join('\n');
}
