// shell-five-regions probe for application-dashboard v1.0.6.
//
// Verifies AC-19101-1: five labelled role="region" elements on the
// shell naming the tile row, chart region, filter chrome, timeframe
// picker and export handle. The probe extracts each <section
// role="region"> element and asserts both the role and a unique
// aria-label per region (AC-19101-4 also asks for unique accessible
// names, so the check reports the accessible-name set as a derived
// output alongside).
//
// anchorAcId: application-dashboard-AC-19101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-001';
export const accountBound = false;

const EXPECTED_DATA_REGIONS = ['tile-row', 'chart-region', 'filter-chrome', 'timeframe-picker', 'export-handle'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];
    const res = await fetch(`${fixture.baseUrl}/`);
    const body = await res.text();

    // Extract every <section ... role="region" ... aria-label="..." ...>
    // block; assert five distinct labelled regions and that every
    // expected data-region marker is inside one of them.
    const regions = [];
    const sectionRe = /<section\b([^>]*)>/g;
    let match;
    while ((match = sectionRe.exec(body)) !== null) {
      const attrs = match[1];
      if (!/role="region"/.test(attrs)) continue;
      const labelMatch = attrs.match(/aria-label="([^"]+)"/);
      const dataRegionMatch = attrs.match(/data-region="([^"]+)"/);
      regions.push({
        ariaLabel: labelMatch ? labelMatch[1] : null,
        dataRegion: dataRegionMatch ? dataRegionMatch[1] : null,
      });
    }
    const dataRegionsFound = regions.map((r) => r.dataRegion).filter((v) => !!v);
    const missing = EXPECTED_DATA_REGIONS.filter((r) => !dataRegionsFound.includes(r));
    const labels = regions.map((r) => r.ariaLabel).filter((v) => !!v);
    const uniqueLabels = new Set(labels);
    const allLabelled = regions.every((r) => typeof r.ariaLabel === 'string' && r.ariaLabel.length > 0);
    const labelsUnique = uniqueLabels.size === labels.length;
    const pass = res.status === 200
      && missing.length === 0
      && regions.length >= 5
      && allLabelled
      && labelsUnique;

    results.push({
      anchorAcId: 'application-dashboard-AC-19101-1',
      anchorReqId: 'application-dashboard-REQ-001',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `shell carries ${regions.length} <section role="region"> elements with unique aria-labels and every expected data-region marker`
        : `region fault: sectionRoles=${regions.length} missing=${JSON.stringify(missing)} allLabelled=${allLabelled} labelsUnique=${labelsUnique}`,
      evidence: evidenceFromResponse({
        route: '/',
        response: res,
        bodyText: body,
        extraFields: {
          input: { expectedDataRegions: EXPECTED_DATA_REGIONS },
          derived: { regionCount: regions.length, dataRegionsFound, ariaLabels: labels, missing, labelsUnique },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
