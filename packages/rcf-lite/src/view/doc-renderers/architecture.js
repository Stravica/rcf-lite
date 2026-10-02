// Architecture tab renderers (viewer UI refresh PR 4, w-2026-10-02-dave-010
// decisions 5 and 14, design doc section 5.5).
//
// The Architecture tab shows the TAD as six collapsed sections, one per
// canonical area, with a one-line preview on each summary. An absent
// section keeps its heading, reads "Nothing written yet" and names the
// `rcf define update TAD-001 --set` call that authors it; absence
// stays an empty state in the tab's own register and never points at
// Readiness (amendment 12.4). Below the TAD, Components (TAC) and
// Decisions (ADR) each render as filterable DocRow lists; TAC rows
// carry interface and dependency count badges, ADR rows a status pill.
// Long doc ids on the summary are shortened to a leading-id glyph plus
// an ellipsis; the full id is on the data-doc-id anchor and the title.
//
// The TAD section renderer is pure HTML; wiring (filter state) lives
// in page-init.js for the FilterBar namespaces architecture-components
// and architecture-decisions.

import { escapeHtml } from './helpers.js';

const AUTHORING_CMD = 'rcf define update TAD-001 --set';

/**
 * Canonical TAD sections rendered on the Architecture tab, in order.
 * Each entry carries:
 *   - key: the TAD field name
 *   - heading: visible section heading
 *   - fields: subfield names the authoring command hint lists (first few)
 *   - preview: function (section, tad) returning the one-line preview text
 *   - body:    function (section) returning body HTML when the section
 *              has content; must return a non-empty string
 *
 * Design decision: deploymentArchitecture is omitted - the wireframe
 * (projects/rcf-lite-wsd/wireframes/2026-10-02_architecture.html) lands
 * on these six and so does the design doc section 5.5.
 */
const TAD_SECTIONS = [
  {
    key: 'systemOverview',
    heading: 'System overview',
    fields: ['executiveSummary', 'systemPurpose', 'architecturalApproach'],
    preview: previewSystemOverview,
    body: bodySystemOverview,
  },
  {
    key: 'architecturePrinciples',
    heading: 'Architecture principles',
    fields: ['architecturePrinciples.0.name', 'architecturePrinciples.0.description'],
    preview: previewArchitecturePrinciples,
    body: bodyArchitecturePrinciples,
  },
  {
    key: 'integrationArchitecture',
    heading: 'Integration architecture',
    fields: ['apiDesign', 'eventModel', 'externalSystems'],
    preview: previewMappedObject,
    body: bodyMappedObject({
      apiDesign: 'API design',
      eventModel: 'Event model',
    }),
  },
  {
    key: 'operationalConcerns',
    heading: 'Operational concerns',
    fields: ['healthChecks', 'logging', 'monitoring'],
    preview: previewMappedObject,
    body: bodyMappedObject({
      healthChecks: 'Health checks',
      logging: 'Logging',
      monitoring: 'Monitoring',
    }),
  },
  {
    key: 'dataArchitecture',
    heading: 'Data architecture',
    fields: ['dataStores', 'coreEntities'],
    preview: previewMappedObject,
    body: bodyDataArchitecture,
  },
  {
    key: 'securityArchitecture',
    heading: 'Security architecture',
    fields: ['authentication', 'authorization', 'secrets'],
    preview: previewMappedObject,
    body: bodyMappedObject({
      authentication: 'Authentication',
      authorization: 'Authorization',
      secrets: 'Secrets',
      threatModel: 'Threat model',
    }),
  },
];

/**
 * Render the six canonical TAD sections, each as a collapsed <details>
 * row with a one-line preview on the summary. Absent sections render
 * the "Nothing written yet" empty state with the authoring command.
 *
 * @param {object|null|undefined} tad
 * @returns {string}
 */
export function renderTadSections(tad) {
  const t = tad && typeof tad === 'object' ? tad : {};
  const blocks = TAD_SECTIONS.map((section) => {
    const value = t[section.key];
    const present = sectionIsPresent(value);
    if (!present) {
      return emptySectionBlock(section);
    }
    const preview = section.preview(value, t);
    const body = section.body(value, t);
    return filledSectionBlock(section, preview, body);
  });
  return `<div class="rcf-tad-sections" data-rcf-tad-sections>${blocks.join('\n')}</div>`;
}

/**
 * Shorten a long doc id for the summary chip. Keeps the first "KIND-NNN"
 * prefix (two tokens) and adds an ellipsis if more follows. The full id
 * stays on data-doc-id and the title so deep links still land.
 *
 * @param {string} id
 * @returns {string}
 */
export function shortenDocId(id) {
  if (typeof id !== 'string' || id.length === 0) return '';
  const parts = id.split('-');
  if (parts.length <= 2) return id;
  // Preserve KIND-NNN...; trim long trailing descriptor suffix.
  const head = `${parts[0]}-${parts[1]}`;
  if (id.length <= head.length + 3) return id;
  return `${head}...`;
}

// ---- section helpers -------------------------------------------------

function sectionIsPresent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    for (const v of Object.values(value)) {
      if (v == null) continue;
      if (typeof v === 'string' && v.trim().length === 0) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return true;
    }
    return false;
  }
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function emptySectionBlock(section) {
  const field = section.fields[0] ?? section.key;
  const fieldList = section.fields.map((f) => `<code>${escapeHtml(f.split('.')[0])}</code>`).join(', ');
  const cmd = `${AUTHORING_CMD} ${section.key}.${field.split('.').slice(1).join('.') || firstScalarField(section)}="..."`;
  const authoringLine = section.fields.length > 1
    ? `Nothing written yet. Author it with <code class="rcf-tad-empty-command">${escapeHtml(cmd)}</code> (fields: ${fieldList}); this section fills in live.`
    : `Nothing written yet. Author it with <code class="rcf-tad-empty-command">${escapeHtml(cmd)}</code>; this section fills in live.`;
  return `<details class="rcf-row doc-row rcf-tad-section rcf-tad-section--empty" data-rcf-tad-section="${escapeHtml(section.key)}" data-empty="1">
  <summary>
    <span class="rcf-tad-section-title"><strong>${escapeHtml(section.heading)}</strong> <span class="rcf-tad-preview muted small">Nothing written yet</span></span>
    <span class="meta"><span class="rcf-badge rcf-badge--facet" title="Section is empty"><span class="rcf-badge-value">empty</span></span></span>
  </summary>
  <div class="rcf-row-body body">
    <p class="rcf-tad-empty small">${authoringLine}</p>
  </div>
</details>`;
}

function filledSectionBlock(section, preview, body) {
  return `<details class="rcf-row doc-row rcf-tad-section" data-rcf-tad-section="${escapeHtml(section.key)}">
  <summary>
    <span class="rcf-tad-section-title"><strong>${escapeHtml(section.heading)}</strong> <span class="rcf-tad-preview muted small">${escapeHtml(preview)}</span></span>
  </summary>
  <div class="rcf-row-body body">
    ${body}
  </div>
</details>`;
}

function firstScalarField(section) {
  // Fallback for sections whose authoring example did not nest its hint.
  return section.fields[0] ?? 'value';
}

// ---- preview and body renderers --------------------------------------

function clipPreview(s, max = 110) {
  const str = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (str.length <= max) return str;
  return `${str.slice(0, max)}...`;
}

function previewSystemOverview(section) {
  if (!section || typeof section !== 'object') return '';
  const parts = [section.executiveSummary, section.systemPurpose, section.architecturalApproach]
    .filter((v) => typeof v === 'string' && v.trim().length > 0);
  return clipPreview(parts[0] ?? '');
}

function bodySystemOverview(section) {
  if (!section || typeof section !== 'object') return '';
  const executive = typeof section.executiveSummary === 'string' && section.executiveSummary.length > 0
    ? `<p>${escapeHtml(section.executiveSummary)}</p>`
    : '';
  const purpose = typeof section.systemPurpose === 'string' && section.systemPurpose.length > 0
    ? `<h4>Purpose</h4><p>${escapeHtml(section.systemPurpose)}</p>`
    : '';
  const approach = typeof section.architecturalApproach === 'string' && section.architecturalApproach.length > 0
    ? `<h4>Approach</h4><p>${escapeHtml(section.architecturalApproach)}</p>`
    : '';
  const caps = Array.isArray(section.keyCapabilities) && section.keyCapabilities.length > 0
    ? `<h4>Key capabilities</h4><ul>${section.keyCapabilities.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
    : '';
  return `${executive}${purpose}${approach}${caps}`;
}

function previewArchitecturePrinciples(principles) {
  if (!Array.isArray(principles) || principles.length === 0) return '';
  const names = principles.map((p) => (p && typeof p === 'object' ? p.name : null))
    .filter((n) => typeof n === 'string' && n.length > 0);
  if (names.length === 0) return clipPreview(`${principles.length} principles`);
  const label = `${principles.length} principle${principles.length === 1 ? '' : 's'}`;
  return clipPreview(`${label}: ${names.join(', ')}`);
}

function bodyArchitecturePrinciples(principles) {
  if (!Array.isArray(principles) || principles.length === 0) return '';
  const items = principles.map((p) => {
    if (!p || typeof p !== 'object') return '';
    const name = typeof p.name === 'string' ? p.name : '';
    const description = typeof p.description === 'string' ? p.description : '';
    const rationale = typeof p.rationale === 'string' && p.rationale.length > 0
      ? `<br/><em>Rationale:</em> ${escapeHtml(p.rationale)}`
      : '';
    return `<li><strong>${escapeHtml(name)}.</strong> ${escapeHtml(description)}${rationale}</li>`;
  }).join('');
  return `<ul>${items}</ul>`;
}

function previewMappedObject(section) {
  if (!section || typeof section !== 'object') return '';
  if (Array.isArray(section)) {
    return clipPreview(section.filter((v) => typeof v === 'string').join('; '));
  }
  const stringParts = Object.values(section)
    .filter((v) => typeof v === 'string' && v.trim().length > 0);
  return clipPreview(stringParts[0] ?? '');
}

function bodyMappedObject(labels) {
  return function body(section) {
    if (!section || typeof section !== 'object') return '';
    const entries = [];
    for (const [key, value] of Object.entries(section)) {
      if (value == null) continue;
      const label = labels[key] ?? prettyLabel(key);
      if (typeof value === 'string') {
        if (value.trim().length === 0) continue;
        entries.push(`<h4>${escapeHtml(label)}</h4><p>${escapeHtml(value)}</p>`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) continue;
        if (value.every((v) => typeof v === 'string')) {
          entries.push(`<h4>${escapeHtml(label)}</h4><ul>${value.map((v) => `<li>${escapeHtml(v)}</li>`).join('')}</ul>`);
        } else {
          const items = value.map((v) => `<li>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</li>`).join('');
          entries.push(`<h4>${escapeHtml(label)}</h4><ul>${items}</ul>`);
        }
      } else if (typeof value === 'object') {
        entries.push(`<h4>${escapeHtml(label)}</h4><pre class="mono small">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`);
      }
    }
    return entries.join('\n');
  };
}

function bodyDataArchitecture(section) {
  if (!section || typeof section !== 'object') return '';
  const parts = [];
  if (Array.isArray(section.dataStores) && section.dataStores.length > 0) {
    const rows = section.dataStores.map((s) => `<tr><td>${escapeHtml(s.name ?? '')}</td><td>${escapeHtml(s.kind ?? '')}</td><td>${escapeHtml(s.purpose ?? '')}</td></tr>`).join('');
    parts.push(`<h4>Data stores</h4><table class="data-table"><thead><tr><th>Name</th><th>Kind</th><th>Purpose</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
  if (Array.isArray(section.coreEntities) && section.coreEntities.length > 0) {
    const rows = section.coreEntities.map((e) => `<tr><td>${escapeHtml(e.name ?? '')}</td><td>${escapeHtml(e.description ?? '')}</td></tr>`).join('');
    parts.push(`<h4>Core entities</h4><table class="data-table"><thead><tr><th>Name</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
  for (const [key, value] of Object.entries(section)) {
    if (key === 'dataStores' || key === 'coreEntities') continue;
    if (value == null) continue;
    if (typeof value === 'string' && value.length > 0) {
      parts.push(`<h4>${escapeHtml(prettyLabel(key))}</h4><p>${escapeHtml(value)}</p>`);
    }
  }
  return parts.join('\n');
}

function prettyLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

// Exposed for tests only.
export const _internal = { TAD_SECTIONS };
