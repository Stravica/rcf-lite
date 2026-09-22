// TAD renderer. Curated fields per spec D11; iterates the architecturePrinciples[]
// array rather than hard-coding a count. Post-3.7 (D15) the child TAC / ADR
// lists are not read from removed parent fields (`componentIds`,
// `architecturalDecisionIds`) but from computed lists supplied via ctx.

import {
  anchorIdFor,
  brokenBanner,
  docLinkList,
  escapeHtml,
  fieldList,
  fieldObjectTable,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

// 0.28.2 (issue #235): structured fields the TAD schema explicitly
// types as arrays of objects. Each entry maps a field-key to the
// schema-documented column layout so `renderOptionalSections` can
// pick a table renderer over the raw-JSON dump the pre-fix code
// emitted. Columns follow @stravica-ai/rcf-schemas@0.6.3
// schemas/tad.schema.json.
const TAD_STRUCTURED_FIELDS = {
  dataStores: [
    { key: 'name', label: 'Name' },
    { key: 'kind', label: 'Kind' },
    { key: 'purpose', label: 'Purpose' },
  ],
  coreEntities: [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description' },
  ],
  externalSystems: [
    { key: 'name', label: 'Name' },
    { key: 'purpose', label: 'Purpose' },
    { key: 'protocol', label: 'Protocol' },
  ],
};

/**
 * @param {object} tad
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('#core/errors').RcfError[]} [ctx.errors]
 * @param {string[]} [ctx.componentIds] - computed TAC children
 * @param {string[]} [ctx.architecturalDecisionIds] - computed ADR children
 * @returns {string}
 */
export function renderTad(tad, ctx) {
  if (!tad) return '';
  const anchor = anchorIdFor(tad.tadId ?? 'TAD');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const overview = tad.systemOverview ?? {};
  const componentIds = ctx.componentIds ?? [];
  const architecturalDecisionIds = ctx.architecturalDecisionIds ?? [];
  const principles = (tad.architecturePrinciples ?? []).map((p) => `
<li>
  <strong>${escapeHtml(p.name)}.</strong> ${escapeHtml(p.description)}
  <br/><em>Rationale:</em> ${escapeHtml(p.rationale)}
</li>`.trim()).join('\n');
  const optionalSections = renderOptionalSections(tad);
  return `
<article id="${anchor}" class="doc doc-tad">
  <h3>${escapeHtml(tad.tadId ?? 'TAD')} - Technical Architecture Document</h3>
  ${broken}
  ${fieldPara('Executive summary', overview.executiveSummary)}
  ${fieldPara('System purpose', overview.systemPurpose)}
  ${fieldPara('Architectural approach', overview.architecturalApproach)}
  ${fieldList('Key capabilities', overview.keyCapabilities)}
  ${principles ? `<section class="field-list"><h4>Architecture principles</h4><ul>${principles}</ul></section>` : ''}
  ${optionalSections}
  <section class="field-list"><h4>Components (TACs)</h4><p>${docLinkList(componentIds)}</p></section>
  <section class="field-list"><h4>Architectural decisions (ADRs)</h4><p>${docLinkList(architecturalDecisionIds)}</p></section>
  ${rawJsonDisclosure(ctx.raw, tad, tad.tadId)}
</article>`.trim();
}

function renderOptionalSections(tad) {
  const out = [];
  const named = {
    dataArchitecture: 'Data architecture',
    integrationArchitecture: 'Integration architecture',
    securityArchitecture: 'Security architecture',
    deploymentArchitecture: 'Deployment architecture',
    operationalConcerns: 'Operational concerns',
  };
  for (const [key, label] of Object.entries(named)) {
    const section = tad[key];
    if (!section || typeof section !== 'object') continue;
    // 0.28.2 (issue #235): pull the schema-known structured fields
    // (dataStores, coreEntities, externalSystems) out of the generic
    // dl loop and render them as tables. The remaining scalar and
    // array-of-string fields keep their dl treatment.
    const structuredBlocks = [];
    const dlEntries = [];
    for (const [k, v] of Object.entries(section)) {
      if (TAD_STRUCTURED_FIELDS[k] && Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object')) {
        const table = fieldObjectTable(prettyStructuredLabel(k), v, TAD_STRUCTURED_FIELDS[k]);
        if (table) structuredBlocks.push(table);
        continue;
      }
      if (typeof v === 'string') {
        dlEntries.push(`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`);
        continue;
      }
      if (Array.isArray(v)) {
        // Array-of-string keeps the existing inline shape. An
        // unknown array-of-object surface falls through to a nested
        // disclosure so it stays legible even when the schema grows
        // a new field before this renderer knows about it.
        if (v.every((x) => typeof x !== 'object' || x === null)) {
          dlEntries.push(`<dt>${escapeHtml(k)}</dt><dd>${v.map((x) => `<code>${escapeHtml(typeof x === 'object' ? JSON.stringify(x) : x)}</code>`).join(', ')}</dd>`);
        } else {
          const items = v.map((x) => `<li><pre>${escapeHtml(JSON.stringify(x, null, 2))}</pre></li>`).join('');
          dlEntries.push(`<dt>${escapeHtml(k)}</dt><dd><ul>${items}</ul></dd>`);
        }
        continue;
      }
      dlEntries.push(`<dt>${escapeHtml(k)}</dt><dd><pre>${escapeHtml(JSON.stringify(v, null, 2))}</pre></dd>`);
    }
    const dl = dlEntries.length > 0 ? `<dl>${dlEntries.join('\n')}</dl>` : '';
    const structured = structuredBlocks.join('\n');
    out.push(`<section class="field-list"><h4>${escapeHtml(label)}</h4>${dl}${structured}</section>`);
  }
  return out.join('\n');
}

function prettyStructuredLabel(key) {
  const map = {
    dataStores: 'Data stores',
    coreEntities: 'Core entities',
    externalSystems: 'External systems',
  };
  return map[key] ?? key;
}
