// application-account-settings probe: tabs shell renders one
// role="tab" per applied capability plus the always-on profile tab
// (AC-25101-1).
//
// Varied inputs: three caps configurations produce three different
// derived tab counts. The probe asserts the derived tab count on the
// rendered nav matches the sum of the always-on tab + the enabled
// capability tabs.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25101-1';
export const accountBound = false;

function countTabs(body) {
  return (body.match(/<a role="tab"[^>]*>/g) || []).length;
}

async function tabsFor(fixture, caps, apps) {
  const q = new URLSearchParams({ caps: caps.join(','), apps: apps.join(',') });
  const r = await fixtureFetch(fixture.url, `/account?${q.toString()}`);
  return { r, count: countTabs(r.body) };
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const configs = [
      { name: 'profile-only', caps: ['principalDirectory'], apps: [], expected: 1 },
      { name: 'profile+sessions', caps: ['principalDirectory', 'sessionInventory'], apps: [], expected: 2 },
      { name: 'profile+security+sessions+notifications+theme', caps: ['principalDirectory', 'credentialSelfService', 'sessionInventory'], apps: ['application-notifications-in-app', 'application-spa'], expected: 5 },
    ];
    for (const cfg of configs) {
      const { r, count } = await tabsFor(fixture, cfg.caps, cfg.apps);
      const tablistPresent = /<nav[^>]*role="tablist"/.test(r.body);
      const pass = r.status === 200 && !!r.requestId && count === cfg.expected && tablistPresent;
      results.push({
        anchorAcId,
        verdict: pass ? 'pass' : 'fail',
        detail: pass
          ? `GET /account?caps=${cfg.caps.join(',')}&apps=${cfg.apps.join(',')} (${cfg.name}) returned 200 with role="tablist" nav and derived tab count=${count} matching expected=${cfg.expected}; x-fixture-request-id=${r.requestId}`
          : `${cfg.name} evidence gap: status=${r.status} rid=${r.requestId} tabs=${count} expected=${cfg.expected} tablist=${tablistPresent}`,
        evidence: {
          requestId: r.requestId,
          responseStatus: r.status,
          bodyExcerpt: excerpt((r.body.match(/<nav[^>]*role="tablist"[^]{0,240}/) || [''])[0]),
          derived: { config: cfg.name, capsInput: cfg.caps, appsInput: cfg.apps, tabCount: count, expected: cfg.expected, tablistPresent },
        },
      });
    }
  } finally {
    fixture.kill();
  }
  return { results };
}
