// shell-five-regions probe for application-dashboard v1.0.9.
//
// AC-19101-1: the DOM carries five labelled role="region" elements.
// The fixture accepts a startServer({ regions: [...] }) override, so
// the probe DRIVES two distinct region sets and asserts the
// rendered DOM follows each input ( - derived, not
// fixed inventory).
//
// anchorAcId: application-dashboard-AC-19101-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

const FULL_SET = ['tile-row', 'chart-region', 'filter-chrome', 'timeframe-picker', 'export-handle'];
const REDUCED_SET = ['tile-row', 'timeframe-picker', 'export-handle'];

function scrapeRegions(body) {
 const sectionRe = /<section\b([^>]*)>/g;
 const regions = [];
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
 return regions;
}

async function driveOne(startServer, regionsInput, expected) {
 const fixture = await new Promise((resolve, reject) => {
 startServer({ port: 0, regions: regionsInput }).then((started) => {
 resolve({ server: started.server, port: started.port, baseUrl: `http://127.0.0.1:${started.port}`, close: () => new Promise((r, rj) => started.server.close((e) => (e ? rj(e) : r()))) });
 }).catch(reject);
 });
 try {
 const res = await fetch(`${fixture.baseUrl}/`);
 const body = await res.text();
 const regions = scrapeRegions(body);
 const dataRegionsFound = regions.map((r) => r.dataRegion).filter(Boolean);
 // Only count REAL known-content regions (skip shell-root wrapper if present).
 const contentRegions = dataRegionsFound.filter((r) => r !== 'shell-root');
 const matchesInput = contentRegions.length === expected.length
 && expected.every((r) => contentRegions.includes(r))
 && contentRegions.every((r) => expected.includes(r));
 return { res, body, regions, dataRegionsFound, contentRegions, matchesInput, fixture };
 } finally {
 await fixture.close();
 }
}

export const anchorReqId = 'application-dashboard-REQ-001';
export const accountBound = false;

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');

 const results = [];
 const runFull = await driveOne(startServer, FULL_SET, FULL_SET);
 const runReduced = await driveOne(startServer, REDUCED_SET, REDUCED_SET);
 const derivedFromInput = runFull.matchesInput && runReduced.matchesInput
 && JSON.stringify(runFull.contentRegions) !== JSON.stringify(runReduced.contentRegions);
 const labelsUniqueFull = new Set(runFull.regions.map((r) => r.ariaLabel).filter(Boolean)).size === runFull.regions.length;
 const allLabelledFull = runFull.regions.every((r) => typeof r.ariaLabel === 'string' && r.ariaLabel.length > 0);
 const pass = runFull.res.status === 200 && runReduced.res.status === 200
 && derivedFromInput && labelsUniqueFull && allLabelledFull && runFull.contentRegions.length === 5;

 results.push({
 anchorAcId: 'application-dashboard-AC-19101-1',
 verdict: pass ? 'pass' : 'fail',
 detail: `Given a rendered dashboard surface, the DOM carries - drove two distinct region sets: full=[${runFull.contentRegions.join(',')}] reduced=[${runReduced.contentRegions.join(',')}]; regions follow the input (${derivedFromInput}); five labels unique in the full run (${labelsUniqueFull})`,
 evidence: evidenceFromResponse({
 route: '/',
 response: runFull.res,
 bodyText: runFull.body,
 extraFields: {
 input: { runFull: FULL_SET, runReduced: REDUCED_SET },
 derived: {
 fullContentRegions: runFull.contentRegions,
 reducedContentRegions: runReduced.contentRegions,
 derivedFromInput,
 fullLabelsUnique: labelsUniqueFull,
 fullAllLabelled: allLabelledFull,
 },
 altBodyExcerpt: runReduced.body.slice(0, 240),
 },
 }),
 });
 return { results };
}
