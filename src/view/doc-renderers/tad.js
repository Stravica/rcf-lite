// TAD renderer. Curated fields per spec D11; iterates the architecturePrinciples[]
// array rather than hard-coding a count.

import {
  anchorIdFor,
  brokenBanner,
  docLinkList,
  escapeHtml,
  fieldList,
  fieldPara,
  rawJsonDisclosure,
} from './helpers.js';

/**
 * @param {object} tad
 * @param {object} ctx
 * @param {string|undefined} ctx.raw
 * @param {import('../../errors/index.js').RcfError[]} [ctx.errors]
 * @returns {string}
 */
export function renderTad(tad, ctx) {
  if (!tad) return '';
  const anchor = anchorIdFor(tad.tadId ?? 'TAD');
  const broken = ctx.errors?.length ? brokenBanner(ctx.errors) : '';
  const overview = tad.systemOverview ?? {};
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
  <section class="field-list"><h4>Components (TACs)</h4><p>${docLinkList(tad.componentIds)}</p></section>
  <section class="field-list"><h4>Architectural decisions (ADRs)</h4><p>${docLinkList(tad.architecturalDecisionIds)}</p></section>
  ${rawJsonDisclosure(ctx.raw, tad)}
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
    const rows = Object.entries(section).map(([k, v]) => {
      if (typeof v === 'string') return `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`;
      if (Array.isArray(v)) return `<dt>${escapeHtml(k)}</dt><dd>${v.map((x) => `<code>${escapeHtml(typeof x === 'object' ? JSON.stringify(x) : x)}</code>`).join(', ')}</dd>`;
      return `<dt>${escapeHtml(k)}</dt><dd><pre>${escapeHtml(JSON.stringify(v, null, 2))}</pre></dd>`;
    }).join('\n');
    out.push(`<section class="field-list"><h4>${escapeHtml(label)}</h4><dl>${rows}</dl></section>`);
  }
  return out.join('\n');
}
