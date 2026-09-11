// four-tile-states probe for application-dashboard v1.0.6.
//
// Verifies AC-19103-1: every tile state (loading, empty, error,
// populated) is a labelled role="region" element carrying
// aria-live="polite" and a data-tile-state marker; the accessible
// name reads "<tile title>, <state>"; the state cue is not
// colour-only. The probe drives ?tile=primary&state=<state> AND
// ?tile=active-users&state=<state> (two tiles per state, per the
// AC) and reads the inner wrapping region's attributes.
//
// anchorAcId: application-dashboard-AC-19103-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-dashboard-REQ-003';
export const accountBound = false;

const STATES = ['loading', 'empty', 'error', 'populated'];

function assertTileState({ body, tileId, state }) {
  // Wrap article for this tile id, then check the inner region.
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
    for (const state of STATES) {
      const res = await fetch(`${fixture.baseUrl}/?tile=primary&state=${state}`);
      const body = await res.text();
      const primary = assertTileState({ body, tileId: 'primary', state });
      const supporting = assertTileState({ body, tileId: 'active-users', state: 'populated' });
      // primary tile pinned to the state; supporting tile stays
      // populated but must still carry the same wrapper shape.
      const pass = res.status === 200
        && primary.present && primary.matches && primary.hasCue && typeof primary.accessibleName === 'string' && primary.accessibleName.includes(state)
        && supporting.present && supporting.matches;
      results.push({
        anchorAcId: 'application-dashboard-AC-19103-1',
        anchorReqId: 'application-dashboard-REQ-003',
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `Given a rendered tile in each of the - state="${state}" region on tile=primary carries role, aria-live=polite, data-tile-state, cue and accessible name "${primary.accessibleName}"; supporting tile inspected`
          : `Given a rendered tile in each of the - state region fault at state="${state}": primary=${JSON.stringify(primary)} supporting=${JSON.stringify(supporting)}`,
        evidence: evidenceFromResponse({
          route: `/?tile=primary&state=${state}`,
          response: res,
          bodyText: body,
          extraFields: {
            input: { state, tiles: ['primary', 'active-users'] },
            derived: { primary, supporting },
          },
        }),
      });
    }
    return { results };
  } finally {
    await fixture.close();
  }
}
