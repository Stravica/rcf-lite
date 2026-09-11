// Probe: hcloud dry-run mock (v1.1.5).
//
// accountBound: false. Anchors each result row to the AC whose
// observable property THIS MOCK actually observes:
//   - AC-37101-1 (provisioner facade sole reader + provisionerReady):
//     BOTH clauses observed — (a) a source-tree grep across the
//     fixture confirms only the provisioner facade module reads
//     HETZNER_ACCOUNT_API_KEY (any other reader in the fixture tree
//     FAILS the row); (b) provisionerReady fires with a
//     metadata-only {tool, apiHost} payload.
//   - AC-37109-1 (event-secrecy across the lifecycle):
//     no event body carries the token bytes, the ssh private-key
//     marker, or the rendered user-data bytes; AND every event
//     payload's keys are a subset of the named metadata fields
//     REQ-006 permits (no unexpected keys reach the observability
//     sink).
// Rows that observe the MOCK-PATH shape of hetznerServerProvisioned,
// hetznerSnapshotTaken and hetznerServerDestroyed carry
// anchorAcId: null with conformanceOnly: true, a limitation naming
// the mock scope, and notObservableHere: { ac: 'AC-3710x-1' }
// pointing at the live AC the row cannot observe. The live
// inventory rows live on the real-account-* probes. The
// rendered-file agreement check (mock consumes the same rendered
// artefact as the real path) is left to `cloud-init-render-lint`
// (AC-37104-1) and `real-account-cloud-init-hardened` (AC-37105-1).
//
// The probe body reads NO process.env.SIMULATE_ switch. Fixture-side
// mutations live in src/cloud-init-renderer.mjs, src/hcloud-mock.mjs
// and src/provisioner-facade.mjs and alter INPUT only.
//
// Every result row carries an `evidence` object with an identity
// key AND an observation key or a body excerpt.

import { readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { FIXTURE_DIR, PROJECT_ROOT } from './probe-utils.mjs';

export const anchorAcId = 'AC-37101-1';
export const accountBound = false;

const TOKEN = 'test-fixture-token-000000000000000000000000000000000000000000';
const USER_DATA_MARKER = 'unattended-upgrades on for security updates';
const PRIVATE_KEY_MARKER = 'BEGIN OPENSSH PRIVATE KEY';

// REQ-006 permits exactly these event names in the fixture lifecycle.
// Payload key allow-list per event: any key not in the set is a
// leak the substring scan would miss (unexpected metadata reaching
// the observability sink).
const ALLOWED_EVENT_KEYS = {
  provisionerReady: new Set(['event', 'tool', 'apiHost']),
  hetznerServerProvisioned: new Set(['event', 'id', 'primaryIpv4', 'location', 'serverType', 'labels']),
  hetznerSnapshotTaken: new Set(['event', 'serverId', 'snapshotId', 'wallClockTime']),
  hetznerServerDestroyed: new Set(['event', 'id', 'wallClockTime']),
};

// Recursively list every .mjs and .js file under a root directory,
// skipping node_modules and dot-dirs.
async function walkSource(root) {
  const out = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(root, e.name);
    if (e.isDirectory()) out.push(...await walkSource(full));
    else if (e.isFile() && /\.(mjs|js)$/.test(e.name)) out.push(full);
  }
  return out;
}

async function findSoleTokenReader(fixtureRoot, expectedReaderRelPath) {
  const files = await walkSource(fixtureRoot);
  const readers = [];
  for (const f of files) {
    let text;
    try { text = await readFile(f, 'utf8'); } catch (_) { continue; }
    // A "reader" is any line that names the variable and is not a
    // comment or a documentation-only mention. Match any non-comment
    // occurrence of HETZNER_ACCOUNT_API_KEY.
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('HETZNER_ACCOUNT_API_KEY')) continue;
      const stripped = line.trim();
      if (stripped.startsWith('//') || stripped.startsWith('*')) continue;
      readers.push({ file: relative(fixtureRoot, f), line: i + 1, snippet: line.trim().slice(0, 200) });
    }
  }
  const unexpected = readers.filter((r) => r.file !== expectedReaderRelPath);
  return { readers, unexpected, expectedReaderRelPath };
}

export default async function runProbe() {
  const facadePath = resolve(FIXTURE_DIR, 'src/provisioner-facade.mjs');
  const rendererPath = resolve(FIXTURE_DIR, 'src/cloud-init-renderer.mjs');
  const manifestPath = resolve(FIXTURE_DIR, 'hetzner/servers/ci-throwaway.json');
  const { createProvisionerFacade, createEventLog } = await import(facadePath);
  const { renderCloudInitToFile } = await import(rendererPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const results = [];
  let events = [];

  // AC-37101-1 clause (a): sole-reader source-tree scan. The
  // provisioner facade module is the only file in the fixture source
  // tree that may name HETZNER_ACCOUNT_API_KEY on a non-comment line.
  const soleReader = await findSoleTokenReader(FIXTURE_DIR, 'src/provisioner-facade.mjs');
  if (soleReader.unexpected.length > 0) {
    results.push({
      anchorAcId: 'AC-37101-1', verdict: 'fail',
      detail: `sole-reader source scan: HETZNER_ACCOUNT_API_KEY named outside src/provisioner-facade.mjs: ${soleReader.unexpected.map((r) => `${r.file}:${r.line}`).join(', ')}`,
      evidence: {
        expectedReader: soleReader.expectedReaderRelPath,
        unexpectedReaders: soleReader.unexpected,
        allReaders: soleReader.readers.map((r) => `${r.file}:${r.line}`),
        source: 'fixture source-tree grep',
      },
    });
  } else {
    results.push({
      anchorAcId: 'AC-37101-1', verdict: 'pass',
      detail: `sole-reader source scan: ${soleReader.readers.length} occurrence(s) of HETZNER_ACCOUNT_API_KEY across the fixture, all inside ${soleReader.expectedReaderRelPath}`,
      evidence: {
        expectedReader: soleReader.expectedReaderRelPath,
        readerCount: soleReader.readers.length,
        readers: soleReader.readers.map((r) => `${r.file}:${r.line}`),
        source: 'fixture source-tree grep',
      },
    });
  }

  // Render the cloud-init to disk (both mock and real paths consume
  // the same file; the assertion that the file carries the deploy
  // ssh-key and NOPASSWD lines is the sole responsibility of
  // cloud-init-render-lint (AC-37104-1) and the real cloud-init
  // baseline probe (AC-37105-1)).
  const publicKeys = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePubKeyForMockedRunHardeningH1 rcf-lite-ci-mock'];
  const { renderedPath, rendered } = await renderCloudInitToFile(manifest, { publicKeys });

  const eventLog = createEventLog();
  events = eventLog.events;
  const eventSink = eventLog.eventSink;
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

    // AC-37101-1 clause (b): provisionerReady fires with metadata-only
    // {tool, apiHost} payload.
    if (!provisionerReady) {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: 'provisionerReady event did not fire on ready().',
        evidence: { eventName: 'provisionerReady', eventFound: false, events: events.map((e) => e.event) },
      });
    } else if (provisionerReady.tool !== 'hcloud' || provisionerReady.apiHost !== 'https://api.hetzner.cloud/v1') {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: `provisionerReady payload shape wrong: ${JSON.stringify(provisionerReady)}`,
        evidence: { eventName: 'provisionerReady', event: provisionerReady, expected: { tool: 'hcloud', apiHost: 'https://api.hetzner.cloud/v1' } },
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

    // AC-37103-1 is a LIVE-only AC (its acceptance text requires the
    // real-account apply plus a live `hcloud server list`). The mocked
    // createServer path here can only observe the facade emitted the
    // event with the shape the mock was asked to return; the row is
    // de-claimed.
    if (!provisioned || !provisioned.id || !provisioned.primaryIpv4 || provisioned.location !== 'fsn1' || provisioned.serverType !== 'cx23') {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'mock-path fixture-shape check only; AC-37103-1 requires the real-account inventory diff carried by real-account-throwaway-server-provision.',
        notObservableHere: { ac: 'AC-37103-1' },
        verdict: 'fail',
        detail: `mock-path fixture-shape check: hetznerServerProvisioned event body is missing or malformed: ${JSON.stringify(provisioned)}`,
        evidence: { eventName: 'hetznerServerProvisioned', event: provisioned || null, expectedKeys: ['id', 'primaryIpv4', 'location', 'serverType'] },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'mock-path fixture-shape check only; AC-37103-1 requires the real-account inventory diff carried by real-account-throwaway-server-provision.',
        notObservableHere: { ac: 'AC-37103-1' },
        verdict: 'pass',
        detail: `mock-path fixture-shape check: facade emitted hetznerServerProvisioned with the expected key shape (id, primaryIpv4, location, serverType).`,
        evidence: {
          eventName: 'hetznerServerProvisioned',
          id: provisioned.id,
          primaryIpv4: provisioned.primaryIpv4,
          location: provisioned.location,
          serverType: provisioned.serverType,
          source: 'mock-facade',
          expectedKeys: ['id', 'primaryIpv4', 'location', 'serverType'],
        },
      });
    }

    if (!snapped || !snapped.snapshotId || !snapped.wallClockTime) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'mock-path fixture-shape check only; AC-37108-1 requires the real-account snapshot inventory carried by real-account-snapshot-on-demand.',
        notObservableHere: { ac: 'AC-37108-1' },
        verdict: 'fail',
        detail: `mock-path fixture-shape check: hetznerSnapshotTaken event body is missing or malformed: ${JSON.stringify(snapped)}`,
        evidence: { eventName: 'hetznerSnapshotTaken', event: snapped || null, expectedKeys: ['snapshotId', 'wallClockTime'] },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'mock-path fixture-shape check only; AC-37108-1 requires the real-account snapshot inventory carried by real-account-snapshot-on-demand.',
        notObservableHere: { ac: 'AC-37108-1' },
        verdict: 'pass',
        detail: `mock-path fixture-shape check: facade emitted hetznerSnapshotTaken with the expected key shape (snapshotId, wallClockTime).`,
        evidence: {
          eventName: 'hetznerSnapshotTaken',
          snapshotId: snapped.snapshotId,
          wallClockTime: snapped.wallClockTime,
          source: 'mock-facade',
          expectedKeys: ['snapshotId', 'wallClockTime'],
        },
      });
    }

    if (!destroyed || !destroyed.id) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'mock-path fixture-shape check only; AC-37109-3 requires the repeat-run once-per-lifecycle observation.',
        notObservableHere: { ac: 'AC-37109-3' },
        verdict: 'fail',
        detail: `mock-path fixture-shape check: hetznerServerDestroyed event body is missing or malformed: ${JSON.stringify(destroyed)}`,
        evidence: { eventName: 'hetznerServerDestroyed', event: destroyed || null, expectedKeys: ['id'] },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'mock-path fixture-shape check only; AC-37109-3 requires the repeat-run once-per-lifecycle observation.',
        notObservableHere: { ac: 'AC-37109-3' },
        verdict: 'pass',
        detail: `mock-path fixture-shape check: facade emitted hetznerServerDestroyed with the destroyed id in the payload.`,
        evidence: {
          eventName: 'hetznerServerDestroyed',
          id: destroyed.id,
          source: 'mock-facade',
          expectedKeys: ['id'],
        },
      });
    }

    // AC-37109-1: event-secrecy scan across every event body PLUS
    // payload-key allow-list: every event's keys must be a subset of
    // the metadata fields REQ-006 permits. Unexpected keys FAIL the
    // row (a leaked field the substring scan would miss).
    const leaks = [];
    const unexpectedKeys = [];
    for (const e of events) {
      const body = JSON.stringify(e);
      if (body.includes(TOKEN)) leaks.push({ event: e.event, marker: 'HETZNER_ACCOUNT_API_KEY value' });
      if (body.includes(PRIVATE_KEY_MARKER)) leaks.push({ event: e.event, marker: 'ssh private key' });
      if (body.includes(USER_DATA_MARKER)) leaks.push({ event: e.event, marker: 'rendered user-data bytes' });
      const allowed = ALLOWED_EVENT_KEYS[e.event];
      if (!allowed) {
        unexpectedKeys.push({ event: e.event, reason: 'unknown event name (not in the REQ-006 named lifecycle set)' });
        continue;
      }
      const extra = Object.keys(e).filter((k) => !allowed.has(k));
      if (extra.length > 0) {
        unexpectedKeys.push({ event: e.event, extraKeys: extra, allowedKeys: [...allowed].sort() });
      }
    }
    if (leaks.length > 0 || unexpectedKeys.length > 0) {
      const bits = [];
      if (leaks.length > 0) bits.push(`substring leak: ${leaks.map((l) => `${l.event} carries ${l.marker}`).join('; ')}`);
      if (unexpectedKeys.length > 0) bits.push(`payload-key allow-list violated: ${unexpectedKeys.map((u) => u.extraKeys ? `${u.event}: extraKeys=${u.extraKeys.join(',')}` : `${u.event}: ${u.reason}`).join('; ')}`);
      results.push({
        anchorAcId: 'AC-37109-1', verdict: 'fail',
        detail: `event-secrecy fail: ${bits.join(' | ')}.`,
        evidence: { eventName: 'lifecycle-scan', leaks, unexpectedKeys, eventCount: events.length },
      });
    } else {
      results.push({
        anchorAcId: 'AC-37109-1', verdict: 'pass',
        detail: `event-secrecy scan across ${events.length} event bodies found no leak of the token, ssh private key, or user-data content; every event payload's keys are a subset of the REQ-006 named metadata set.`,
        evidence: {
          eventName: 'lifecycle-scan',
          eventCount: events.length,
          scannedMarkers: ['token value', 'ssh private key', 'user-data marker'],
          allowedKeysByEvent: Object.fromEntries(Object.entries(ALLOWED_EVENT_KEYS).map(([k, v]) => [k, [...v].sort()])),
          leaks: [],
          unexpectedKeys: [],
        },
      });
    }
  } catch (err) {
    results.push({
      anchorAcId: 'AC-37101-1', verdict: 'fail',
      detail: `provisioner facade lifecycle threw: ${err.message}`,
      evidence: { eventName: 'lifecycle-error', error: err.message, errorStack: (err.stack || '').slice(0, 400) },
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
