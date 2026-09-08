// Probe: hcloud dry-run mock.
//
// anchorAcId: AC-37101-1 (provisioner facade sole reader + provisionerReady
// on boot; also covers AC-37109-1 event-secrecy across the lifecycle).
// accountBound: false.
//
// Drives the provisioner facade with the fixture's ci-throwaway manifest
// against the mocked hcloud shim (src/hcloud-mock.mjs). Asserts:
//   - the facade opens on ready() and fires provisionerReady with a
//     metadata-only payload {tool, apiHost}.
//   - createServer parses the mocked JSON stdout and emits
//     hetznerServerProvisioned with id, primaryIpv4, location=fsn1,
//     serverType=cx23.
//   - takeSnapshot fires hetznerSnapshotTaken with snapshot id and time.
//   - destroyServer fires hetznerServerDestroyed with the id.
//   - no event body across the run carries the token, an ssh private-key
//     marker, or the rendered user-data bytes (event-secrecy check).
//
// Mutations:
//   SIMULATE_JSON_PARSE_STRIP=true has hcloud-mock.mjs return non-JSON
//   stdout so JSON.parse throws and the probe FAILS.
//   SIMULATE_EVENT_SECRECY_LEAK=true has provisioner-facade.mjs inject
//   the token into the hetznerServerProvisioned payload; the event-
//   secrecy scan FAILS with a defensive-fake finding.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcId = 'AC-37101-1';
export const accountBound = false;

const TOKEN = 'test-fixture-token-000000000000000000000000000000000000000000';
const USER_DATA_MARKER = 'unattended-upgrades on for security updates';
const PRIVATE_KEY_MARKER = 'BEGIN OPENSSH PRIVATE KEY';

export default async function runProbe() {
  const facadePath = resolve(FIXTURE_DIR, 'src/provisioner-facade.mjs');
  const manifestPath = resolve(FIXTURE_DIR, 'hetzner/servers/ci-throwaway.json');
  const { createProvisionerFacade, createEventLog } = await import(facadePath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { events, eventSink } = createEventLog();
  const facade = createProvisionerFacade({
    token: TOKEN,
    tool: 'hcloud',
    apiHost: 'https://api.hetzner.cloud/v1',
    eventSink,
  });
  const results = [];
  try {
    await facade.ready();
    const server = await facade.createServer(manifest);
    const snapshot = await facade.takeSnapshot({ id: server.id, name: manifest.name }, `${manifest.name}-${new Date().toISOString()}`);
    await facade.destroyServer(server);
    const provisionerReady = events.find((e) => e.event === 'provisionerReady');
    const provisioned = events.find((e) => e.event === 'hetznerServerProvisioned');
    const snapped = events.find((e) => e.event === 'hetznerSnapshotTaken');
    const destroyed = events.find((e) => e.event === 'hetznerServerDestroyed');
    if (!provisionerReady) {
      results.push({ anchorAcId: 'AC-37101-1', verdict: 'fail', detail: 'provisionerReady event did not fire on ready().' });
    } else if (provisionerReady.tool !== 'hcloud' || provisionerReady.apiHost !== 'https://api.hetzner.cloud/v1') {
      results.push({ anchorAcId: 'AC-37101-1', verdict: 'fail', detail: `provisionerReady payload shape wrong: ${JSON.stringify(provisionerReady)}` });
    } else {
      results.push({ anchorAcId: 'AC-37101-1', verdict: 'pass', detail: 'provisionerReady fired with metadata-only {tool, apiHost} payload.' });
    }
    if (!provisioned || !provisioned.id || !provisioned.primaryIpv4 || provisioned.location !== 'fsn1' || provisioned.serverType !== 'cx23') {
      results.push({ anchorAcId: 'AC-37101-1', verdict: 'fail', detail: `hetznerServerProvisioned event missing or malformed: ${JSON.stringify(provisioned)}` });
    } else {
      results.push({ anchorAcId: 'AC-37101-1', verdict: 'pass', detail: `hetznerServerProvisioned fired with id=${provisioned.id} primaryIpv4=${provisioned.primaryIpv4} location=fsn1 serverType=cx23.` });
    }
    if (!snapped || !snapped.snapshotId || !snapped.wallClockTime) {
      results.push({ anchorAcId: 'AC-37101-1', verdict: 'fail', detail: `hetznerSnapshotTaken event missing or malformed: ${JSON.stringify(snapped)}` });
    }
    if (!destroyed || !destroyed.id) {
      results.push({ anchorAcId: 'AC-37101-1', verdict: 'fail', detail: `hetznerServerDestroyed event missing or malformed: ${JSON.stringify(destroyed)}` });
    }
    // Event-secrecy scan across every event body.
    const leaks = [];
    for (const e of events) {
      const body = JSON.stringify(e);
      if (body.includes(TOKEN)) leaks.push({ event: e.event, marker: 'HETZNER_ACCOUNT_API_KEY value' });
      if (body.includes(PRIVATE_KEY_MARKER)) leaks.push({ event: e.event, marker: 'ssh private key' });
      if (body.includes(USER_DATA_MARKER)) leaks.push({ event: e.event, marker: 'rendered user-data bytes' });
    }
    if (leaks.length > 0) {
      results.push({
        anchorAcId: 'AC-37109-1',
        verdict: 'fail',
        detail: `event-secrecy leak: ${leaks.map((l) => `${l.event} carries ${l.marker}`).join('; ')} (defensive-fake finding; check for a SIMULATE_EVENT_SECRECY_LEAK mutation).`,
      });
    } else {
      results.push({
        anchorAcId: 'AC-37109-1',
        verdict: 'pass',
        detail: `event-secrecy scan across ${events.length} event bodies found no leak of the token, ssh private key, or user-data content.`,
      });
    }
  } catch (err) {
    results.push({
      anchorAcId: 'AC-37101-1',
      verdict: 'fail',
      detail: `provisioner facade lifecycle threw: ${err.message} (probable cause: mocked hcloud stdout is not JSON; check for a SIMULATE_JSON_PARSE_STRIP mutation).`,
    });
  }
  return {
    results,
    extra: {
      eventCount: events.length,
      events: events.map((e) => ({ event: e.event, keys: Object.keys(e).sort() })),
      mutations: {
        jsonParseStrip: process.env.SIMULATE_JSON_PARSE_STRIP === 'true',
        eventSecrecyLeak: process.env.SIMULATE_EVENT_SECRECY_LEAK === 'true',
      },
    },
  };
}
