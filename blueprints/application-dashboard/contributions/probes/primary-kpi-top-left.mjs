// primary-kpi-top-left probe for application-dashboard v1.0.9.
//
// AC-19102-1 requires computed layout at 1440/1024/360 viewports;
// that observation is browser-only and recorded as notObservableHere
// per the browser-only rule. The server-observable half - primary tile
// first in DOM order, inline grid-column-start:1 AND grid-row-start:1,
// data-kpi-kind in the ADR-2001 enum - remains a real evidence row.
//
// anchorAcId: application-dashboard-AC-19102-1.

import { startFixture, evidenceFromResponse, conformanceOnlyResult } from './probe-utils.mjs';

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

 results.push(conformanceOnlyResult({
 anchorAcId: 'application-dashboard-AC-19102-1',
 anchorReqId: 'application-dashboard-REQ-002',
 verdict: okPass ? 'pass' : 'fail',
 detail: `Given a rendered dashboard surface at each of - primary tile first in DOM order with inline grid-column-start:1, grid-row-start:1, data-kpi-kind="${kindValue}" (server-observable half of AC-19102-1)`,
 evidence: evidenceFromResponse({
 route: '/',
 response: okRes,
 bodyText: okBody,
 extraFields: {
 input: { adr2001Enum: KPI_ENUM },
 derived: { firstArticleAttrs: firstAttrs.slice(0, 240), primaryFirst: isPrimaryFirst, colStart: hasColumnStart, rowStart: hasRowStart, kindValue },
 },
 }),
 limitation: 'application-dashboard-AC-19102-1: computed CSS layout at 1440/1024/360 viewports is browser-only',
 }));

 return { results };
 } finally {
 await fixture.close();
 }
}
