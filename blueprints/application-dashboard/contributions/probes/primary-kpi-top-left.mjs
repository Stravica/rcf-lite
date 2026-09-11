// primary-kpi-top-left probe for application-dashboard v1.0.6.
//
// Verifies AC-19102-1: on the rendered surface the tile carrying
// data-tile-role="primary-kpi" is first in DOM order inside the
// tile row, the tile's inline CSS carries grid-column-start:1 AND
// grid-row-start:1, and the tile carries a data-kpi-kind whose
// value is one of the ADR-2001 enum (revenue, active-users,
// error-rate, throughput, custom).
//
// anchorAcId: application-dashboard-AC-19102-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-002';
export const accountBound = false;

const KPI_ENUM = ['revenue', 'active-users', 'error-rate', 'throughput', 'custom'];

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const okRes = await fetch(`${fixture.baseUrl}/`);
    const okBody = await okRes.text();
    // Isolate the tile-row region and inspect the first <article>
    // inside it so DOM order is a real observation of the tile row.
    const tileRowMatch = okBody.match(/<section[^>]+data-region="tile-row"[^>]*>([\s\S]*?)<\/section>/);
    const firstArticle = tileRowMatch ? tileRowMatch[1].match(/<article[^>]*>/) : null;
    const firstAttrs = firstArticle ? firstArticle[0] : '';
    const isPrimaryFirst = /data-tile-role="primary-kpi"/.test(firstAttrs);
    const hasColumnStart = /grid-column-start:1/.test(firstAttrs);
    const hasRowStart = /grid-row-start:1/.test(firstAttrs);
    const kindMatch = firstAttrs.match(/data-kpi-kind="([^"]+)"/);
    const kindValue = kindMatch ? kindMatch[1] : null;
    const kindOk = kindValue !== null && KPI_ENUM.includes(kindValue);
    const okPass = okRes.status === 200 && isPrimaryFirst && hasColumnStart && hasRowStart && kindOk;

    results.push({
      anchorAcId: 'application-dashboard-AC-19102-1',
      anchorReqId: 'application-dashboard-REQ-002',
      verdict: okPass ? 'pass' : 'fail',
      detail: okPass
        ? `primary KPI tile is first in tile-row DOM order with grid-column-start:1, grid-row-start:1 and data-kpi-kind="${kindValue}"`
        : `primary-first fault: primaryFirst=${isPrimaryFirst} colStart=${hasColumnStart} rowStart=${hasRowStart} kind=${kindValue}`,
      evidence: evidenceFromResponse({
        route: '/',
        response: okRes,
        bodyText: okBody,
        extraFields: {
          input: { adr2001Enum: KPI_ENUM },
          derived: { firstArticleAttrs: firstAttrs.slice(0, 240), primaryFirst: isPrimaryFirst, colStart: hasColumnStart, rowStart: hasRowStart, kindValue },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
