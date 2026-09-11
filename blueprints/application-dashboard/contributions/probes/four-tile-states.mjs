// four-tile-states probe for application-dashboard v1.0.9.
//
// Verifies AC-19103-1: every tile state (loading, empty, error,
// populated) is rendered on each of two named tiles. The probe
// drives ?tile=primary&state=<state> AND ?tile=active-users&state=<state>
// so each state is observed on two tiles ( - the
// varied input is the state and tile id, the derived output is the
// state attribute and cue on the correct tile's region).
//
// anchorAcId: application-dashboard-AC-19103-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-003';
export const accountBound = false;

const STATES = ['loading', 'empty', 'error', 'populated'];
const TILES = ['primary', 'active-users'];

function assertTileState({ body, tileId, state }) {
 const articleRe = new RegExp(`<article[^>]+data-tile-id="${tileId}"[^>]*>([\\s\\S]*?)<\/article>`);
 const article = body.match(articleRe);
 if (!article) return { present: false, reason: `no article for ${tileId}` };
 const inner = article[1];
 const wrapperRe = /<div[^>]+role="region"[^>]+aria-live="polite"[^>]+data-tile-state="([^"]+)"[^>]+aria-label="([^"]+)"[^>]*>/;
 const wrap = inner.match(wrapperRe);
 if (!wrap) return { present: false, reason: 'inner region missing role/aria-live/data-tile-state/aria-label' };
 const cueRe = new RegExp(`data-state-cue="${state}"`);
 const hasCue = cueRe.test(inner);
 return {
 present: true,
 stateAttr: wrap[1],
 accessibleName: wrap[2],
 hasCue,
 matches: wrap[1] === state,
 };
}

export default async function runProbe() {
 const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js');
 const fixture = await startFixture({ startServer, port: 0 });
 try {
 const results = [];
 for (const tileId of TILES) {
 for (const state of STATES) {
 const res = await fetch(`${fixture.baseUrl}/?tile=${tileId}&state=${state}`);
 const body = await res.text();
 const observation = assertTileState({ body, tileId, state });
 const pass = res.status === 200
 && observation.present
 && observation.matches
 && observation.hasCue
 && typeof observation.accessibleName === 'string' && observation.accessibleName.includes(state);
 results.push({
 anchorAcId: 'application-dashboard-AC-19103-1',
 anchorReqId: 'application-dashboard-REQ-003',
 verdict: pass ? 'pass' : 'fail',
 detail: `Given a rendered tile in each of the - tile=${tileId} at state="${state}" carries role="region" aria-live="polite" data-tile-state="${observation.stateAttr}" data-state-cue="${state}" accessibleName="${observation.accessibleName}"`,
 evidence: evidenceFromResponse({
 route: `/?tile=${tileId}&state=${state}`,
 response: res,
 bodyText: body,
 extraFields: {
 input: { tileId, state },
 derived: observation,
 },
 }),
 });
 }
 }
 return { results };
 } finally {
 await fixture.close();
 }
}
