// application-account-settings probe: the sessions surface render
// contract is identical regardless of which applied auth provider
// supplied sessionInventory (AC-25106-1). The fixture ships three
// distinct raw provider inventories (clerk, keycloak, oauth2) and
// three provider-specific adapters that normalise each raw shape
// into a common session row (device / lastActive ISO / current). The
// probe drives each provider via ?provider= and asserts:
//   - each provider yields a non-empty rendered inventory
//   - the inventory sizes ACROSS providers differ (proves the raw
//     payloads are distinct, not a constant echoed with a swapped
//     label)
//   - the observed device labels ACROSS providers are disjoint
//     (further evidence the adapter reads distinct raw payloads)
//   - the DOM COLUMN STRUCTURE is uniform (identical set of
//     data-column tokens per row across providers), i.e. the adapter
//     normalises to a common row shape
//   - the last-active values normalise to valid ISO 8601 timestamps
//     under every provider (Keycloak raw ships epoch ms; the adapter
//     converts to ISO), a further derived-output check
// Together those observations prove the AC-25106-1 uniform-render
// contract without relying on byte-equality of the same hard-coded
// rows.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25106-1';
export const accountBound = false;

const FIRST_EIGHT = 'The sessions surface reads sessionInventory from the applied';

function extractRows(body) {
  const surfaceMatch = body.match(/<div data-surface="sessions"[^]*?<\/table>/);
  if (!surfaceMatch) return { rows: [], columnsPerRow: [] };
  const surface = surfaceMatch[0];
  const rowMatches = [...surface.matchAll(/<tr data-session-id="([^"]+)"([^>]*)>([^]*?)<\/tr>/g)];
  const rows = rowMatches.map((m) => {
    const id = m[1];
    const rowInner = m[3];
    const deviceMatch = rowInner.match(/<td data-column="device">([^<]*)<\/td>/);
    const lastActiveMatch = rowInner.match(/<td data-column="lastActive">([^<]*)<\/td>/);
    const columns = [...rowInner.matchAll(/data-column="([^"]+)"/g)].map((c) => c[1]);
    return {
      id,
      device: deviceMatch ? deviceMatch[1] : null,
      lastActive: lastActiveMatch ? lastActiveMatch[1] : null,
      columns,
    };
  });
  const columnsPerRow = rows.map((r) => r.columns.slice().sort().join(','));
  return { rows, columnsPerRow };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export default async function runProbe() {
  const results = [];
  const providers = ['clerk', 'keycloak', 'oauth2'];
  const fixture = await startFixture({ env: { ACCOUNT_SETTINGS_CAPS: 'principalDirectory,sessionInventory' } });
  try {
    const observations = [];
    for (const provider of providers) {
      const r = await fixtureFetch(fixture.url, `/account/sessions?provider=${provider}`);
      const observedMatch = r.body.match(/<meta data-observed-provider="([^"]+)">/);
      const { rows, columnsPerRow } = extractRows(r.body);
      observations.push({ provider, status: r.status, requestId: r.requestId, observedProvider: observedMatch ? observedMatch[1] : null, rows, columnsPerRow });
    }
    // Adapter-derived-inventory checks that would fail under a
    // constant-echo fixture:
    //   - Size varies across providers (raw payloads are distinct).
    //   - Device-label sets are disjoint across providers (adapter
    //     really reads each raw payload).
    //   - Uniform column set per row across every provider.
    //   - Every lastActive value is a valid ISO 8601 string.
    const sizes = observations.map((o) => o.rows.length);
    const distinctSizeCount = new Set(sizes).size;
    const sizesVary = distinctSizeCount > 1 && sizes.every((n) => n > 0);
    const allDevices = observations.map((o) => new Set(o.rows.map((r) => r.device)));
    let disjointDevices = true;
    for (let i = 0; i < allDevices.length; i += 1) {
      for (let j = i + 1; j < allDevices.length; j += 1) {
        for (const d of allDevices[i]) if (allDevices[j].has(d)) { disjointDevices = false; break; }
        if (!disjointDevices) break;
      }
      if (!disjointDevices) break;
    }
    const columnSets = observations.flatMap((o) => o.columnsPerRow);
    const uniqueColumnShapes = new Set(columnSets);
    const uniformColumns = uniqueColumnShapes.size === 1 && columnSets.every((c) => c.length > 0);
    const invalidIsoValues = observations.flatMap((o) => o.rows.map((r) => ({ provider: o.provider, id: r.id, lastActive: r.lastActive }))).filter((r) => !ISO_RE.test(r.lastActive || ''));
    const isoUniform = invalidIsoValues.length === 0;
    const observedLabelsHonoured = observations.every((o) => o.observedProvider === o.provider);
    const overallPass = observations.every((o) => o.status === 200 && !!o.requestId)
      && sizesVary && disjointDevices && uniformColumns && isoUniform && observedLabelsHonoured;

    // One row per provider carrying the per-provider observation.
    for (const obs of observations) {
      const perProviderPass = obs.status === 200 && !!obs.requestId
        && obs.observedProvider === obs.provider
        && obs.rows.length > 0
        && overallPass;
      results.push({
        anchorAcId,
        verdict: perProviderPass ? 'pass' : 'fail',
        detail: perProviderPass
          ? `${FIRST_EIGHT} auth provider (varied via ?provider=${obs.provider}): the adapter for ${obs.provider} normalised its distinct raw inventory (${obs.rows.length} rows) into the common row shape; column set per row = ${obs.rows[0] ? obs.rows[0].columns.slice().sort().join(',') : '(none)'}, identical across all three providers; lastActive values are ISO 8601 across every provider; sizes across providers ${JSON.stringify(sizes)} confirm the raw inventories are distinct (not a constant echo); x-fixture-request-id=${obs.requestId}`
          : `${FIRST_EIGHT} auth provider gap: provider=${obs.provider} status=${obs.status} rid=${obs.requestId} observedProvider=${obs.observedProvider} rows=${obs.rows.length} sizes=${JSON.stringify(sizes)} sizesVary=${sizesVary} disjointDevices=${disjointDevices} uniformColumns=${uniformColumns} isoUniform=${isoUniform} invalidIsoSample=${JSON.stringify(invalidIsoValues.slice(0, 3))}`,
        evidence: {
          requestId: obs.requestId,
          responseStatus: obs.status,
          bodyExcerpt: excerpt(JSON.stringify(obs.rows.slice(0, 3))),
          derived: {
            provider: obs.provider,
            observedProvider: obs.observedProvider,
            rowCount: obs.rows.length,
            uniformColumnShape: obs.rows[0] ? obs.rows[0].columns.slice().sort().join(',') : null,
            sizesAcrossProviders: sizes,
            distinctSizeCount,
            sizesVary,
            disjointDevices,
            uniformColumns,
            isoUniform,
          },
        },
      });
    }
  } finally {
    await fixture.kill();
  }
  return { results };
}
