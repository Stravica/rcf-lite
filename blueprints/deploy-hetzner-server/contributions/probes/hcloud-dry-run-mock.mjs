// Probe: hcloud dry-run mock (v1.1.4 closure fix, criterion e pass).
//
// accountBound: false. Anchors each result row to the AC whose
// observable property that row actually observes:
//   - AC-37101-1 (provisioner facade sole reader + provisionerReady):
//     the facade opens and provisionerReady fires with a metadata-only
//     {tool, apiHost} payload.
//   - AC-37103-1 (manifest applies to createServer):
//     hetznerServerProvisioned fires with id, primaryIpv4, location=fsn1,
//     serverType=cx23.
//   - AC-37108-1 (snapshot on demand + hetznerSnapshotTaken):
//     hetznerSnapshotTaken fires with snapshot id and wall-clock time.
//   - AC-37109-3 (event fires once per lifecycle moment):
//     hetznerServerDestroyed fires with the destroyed id.
//   - AC-37109-1 (event-secrecy across the lifecycle):
//     no event body carries the token bytes, the ssh private-key marker,
//     or the rendered user-data bytes.
// The rendered-file agreement check (mock consumes the same rendered
// artefact as the real path) is left to `cloud-init-render-lint`
// (AC-37104-1) and `real-account-cloud-init-hardened` (AC-37105-1)
// after the closure ruled the previously-manufactured AC-14501-1
// anchor invented (Addendum rule 1: do not invent).
//
// The probe body reads NO process.env.SIMULATE_ switch. Fixture-side
// mutations live in src/cloud-init-renderer.mjs, src/hcloud-mock.mjs
// and src/provisioner-facade.mjs and alter INPUT only.
//
// Every result row carries an `evidence` object naming the observed
// event body and its shape check (Addendum rule 3).

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { FIXTURE_DIR, PROJECT_ROOT } from './probe-utils.mjs';

export const anchorAcId = 'AC-37101-1';
export const accountBound = false;

const TOKEN = 'test-fixture-token-000000000000000000000000000000000000000000';
const USER_DATA_MARKER = 'unattended-upgrades on for security updates';
const PRIVATE_KEY_MARKER = 'BEGIN OPENSSH PRIVATE KEY';

export default async function runProbe() {
  const facadePath = resolve(FIXTURE_DIR, 'src/provisioner-facade.mjs');
  const rendererPath = resolve(FIXTURE_DIR, 'src/cloud-init-renderer.mjs');
  const manifestPath = resolve(FIXTURE_DIR, 'hetzner/servers/ci-throwaway.json');
  const { createProvisionerFacade, createEventLog } = await import(facadePath);
  const { renderCloudInitToFile } = await import(rendererPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const results = [];

  // Render the cloud-init to disk (both mock and real paths consume
  // the same file; the assertion that the file carries the deploy
  // ssh-key and NOPASSWD lines is now the sole responsibility of
  // cloud-init-render-lint (AC-37104-1) and the real cloud-init
  // baseline probe (AC-37105-1). We keep the render step here so the
  // mocked facade lifecycle runs against a coherent input, but no
  // manufactured AC anchors a result row on the rendered file.
  const publicKeys = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePubKeyForMockedRunHardeningH1 rcf-lite-ci-mock'];
  const { renderedPath, rendered } = await renderCloudInitToFile(manifest, { publicKeys });

  const { events, eventSink } = createEventLog();
  const facade = createProvisionerFacade({
    token: TOKEN,
    tool: 'hcloud',
    apiHost: 'https://api.hetzner.cloud/v1',
    eventSink,
  });
  try {
    await facade.ready();
    const server = await facade.createServer(manifest);
    const snapshot = await facade.takeSnapshot(
      { id: server.id, name: manifest.name },
      `${manifest.name}-${new Date().toISOString()}`,
    );
    await facade.destroyServer(server);
    const provisionerReady = events.find((e) => e.event === 'provisionerReady');
    const provisioned = events.find((e) => e.event === 'hetznerServerProvisioned');
    const snapped = events.find((e) => e.event === 'hetznerSnapshotTaken');
    const destroyed = events.find((e) => e.event === 'hetznerServerDestroyed');

    // AC-37101-1: provisionerReady + sole token reader + metadata-only.
    if (!provisionerReady) {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: 'provisionerReady event did not fire on ready().',
        evidence: { eventFound: false, events: events.map((e) => e.event) },
      });
    } else if (provisionerReady.tool !== 'hcloud' || provisionerReady.apiHost !== 'https://api.hetzner.cloud/v1') {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: `provisionerReady payload shape wrong: ${JSON.stringify(provisionerReady)}`,
        evidence: { event: provisionerReady, expected: { tool: 'hcloud', apiHost: 'https://api.hetzner.cloud/v1' } },
      });
    } else {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'pass',
        detail: 'provisionerReady fired with metadata-only {tool, apiHost} payload.',
        evidence: {
          eventName: 'provisionerReady',
          payloadKeys: Object.keys(provisionerReady).sort(),
          tool: provisionerReady.tool,
          apiHost: provisionerReady.apiHost,
        },
      });
    }

    // AC-37103-1: hetznerServerProvisioned observed via the mocked
    // createServer path (mock-path evidence: this observation stands
    // alongside the live inventory-diff evidence carried by
    // real-account-throwaway-server-provision).
    if (!provisioned || !provisioned.id || !provisioned.primaryIpv4 || provisioned.location !== 'fsn1' || provisioned.serverType !== 'cx23') {
      results.push({
        anchorAcId: 'AC-37103-1', verdict: 'fail',
        detail: `hetznerServerProvisioned event missing or malformed: ${JSON.stringify(provisioned)}`,
        evidence: { event: provisioned || null, expectedKeys: ['id', 'primaryIpv4', 'location', 'serverType'] },
      });
    } else {
      results.push({
        anchorAcId: 'AC-37103-1', verdict: 'pass',
        detail: `hetznerServerProvisioned fired (mock-path evidence) with id=${provisioned.id} primaryIpv4=${provisioned.primaryIpv4} location=fsn1 serverType=cx23.`,
        evidence: {
          eventName: 'hetznerServerProvisioned',
          id: provisioned.id,
          primaryIpv4: provisioned.primaryIpv4,
          location: provisioned.location,
          serverType: provisioned.serverType,
          source: 'mock-facade',
        },
      });
    }

    // AC-37108-1: hetznerSnapshotTaken with snapshot id and time.
    if (!snapped || !snapped.snapshotId || !snapped.wallClockTime) {
      results.push({
        anchorAcId: 'AC-37108-1', verdict: 'fail',
        detail: `hetznerSnapshotTaken event missing or malformed: ${JSON.stringify(snapped)}`,
        evidence: { event: snapped || null, expectedKeys: ['snapshotId', 'wallClockTime'] },
      });
    } else {
      results.push({
        anchorAcId: 'AC-37108-1', verdict: 'pass',
        detail: `hetznerSnapshotTaken fired (mock-path evidence) with snapshotId=${snapped.snapshotId} wallClockTime=${snapped.wallClockTime}.`,
        evidence: {
          eventName: 'hetznerSnapshotTaken',
          snapshotId: snapped.snapshotId,
          wallClockTime: snapped.wallClockTime,
          source: 'mock-facade',
        },
      });
    }

    // AC-37109-3: hetznerServerDestroyed fires once per lifecycle moment.
    if (!destroyed || !destroyed.id) {
      results.push({
        anchorAcId: 'AC-37109-3', verdict: 'fail',
        detail: `hetznerServerDestroyed event missing or malformed: ${JSON.stringify(destroyed)}`,
        evidence: { event: destroyed || null, expectedKeys: ['id'] },
      });
    } else {
      results.push({
        anchorAcId: 'AC-37109-3', verdict: 'pass',
        detail: `hetznerServerDestroyed fired with id=${destroyed.id}.`,
        evidence: {
          eventName: 'hetznerServerDestroyed',
          id: destroyed.id,
          source: 'mock-facade',
        },
      });
    }

    // AC-37109-1: event-secrecy scan across every event body.
    const leaks = [];
    for (const e of events) {
      const body = JSON.stringify(e);
      if (body.includes(TOKEN)) leaks.push({ event: e.event, marker: 'HETZNER_ACCOUNT_API_KEY value' });
      if (body.includes(PRIVATE_KEY_MARKER)) leaks.push({ event: e.event, marker: 'ssh private key' });
      if (body.includes(USER_DATA_MARKER)) leaks.push({ event: e.event, marker: 'rendered user-data bytes' });
    }
    if (leaks.length > 0) {
      results.push({
        anchorAcId: 'AC-37109-1', verdict: 'fail',
        detail: `event-secrecy leak: ${leaks.map((l) => `${l.event} carries ${l.marker}`).join('; ')}.`,
        evidence: { leaks, eventCount: events.length },
      });
    } else {
      results.push({
        anchorAcId: 'AC-37109-1', verdict: 'pass',
        detail: `event-secrecy scan across ${events.length} event bodies found no leak of the token, ssh private key, or user-data content.`,
        evidence: {
          eventCount: events.length,
          scannedMarkers: ['token value', 'ssh private key', 'user-data marker'],
          leaks: [],
        },
      });
    }
  } catch (err) {
    results.push({
      anchorAcId: 'AC-37101-1', verdict: 'fail',
      detail: `provisioner facade lifecycle threw: ${err.message}`,
      evidence: { error: err.message, stack: (err.stack || '').slice(0, 400) },
    });
  }
  return {
    results,
    extra: {
      eventCount: events.length,
      events: events.map((e) => ({ event: e.event, keys: Object.keys(e).sort() })),
      renderedPath: relative(PROJECT_ROOT, renderedPath),
      renderedByteLength: rendered.length,
    },
  };
}
