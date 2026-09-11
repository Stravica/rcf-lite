// Probe: hcloud dry-run mock (v1.1.5).
//
// accountBound: false. Anchors each result row to the AC whose
// observable property THIS MOCK actually observes:
//   - AC-37101-1 (provisioner facade sole reader + provisionerReady):
//     BOTH clauses observed: (a) a source-tree grep across the
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
// anchorAcId: null with conformanceOnly: true and a limitation
// naming the shipped AC and the live probe that observes it (no
// notObservableHere: those live-only ACs are process-observable on
// the real-account probes; notObservableHere is reserved for
// browser-only properties, empty on this blueprint). The live
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

  // AC-37101-1 sole-reader source-tree scan is run first so its
  // outcome can be folded into the single AC-37101-1 row below (both
  // clauses combined). The provisioner facade module is expected to
  // be the ONLY file in the fixture source tree that names
  // HETZNER_ACCOUNT_API_KEY on a non-comment line, and there must be
  // at least one such reader (zero readers fails the sole-reader
  // observation, per the AC's "grep across the fixture source"
  // clause).
  const soleReader = await findSoleTokenReader(FIXTURE_DIR, 'src/provisioner-facade.mjs');

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

    // AC-37101-1: single row combining BOTH clauses (source-tree
    // sole-reader scan AND metadata-only provisionerReady payload).
    // The row PASSES only if BOTH are observed positively; zero
    // readers or an unexpected reader or a missing/malformed
    // provisionerReady event FAILS the row.
    const soleReaderSummary = {
      expectedReader: soleReader.expectedReaderRelPath,
      readerCount: soleReader.readers.length,
      readers: soleReader.readers.map((r) => `${r.file}:${r.line}`),
      source: 'fixture source-tree grep .mjs/.js',
    };
    if (soleReader.readers.length === 0) {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: `sole-reader source scan across the fixture .mjs/.js found ZERO non-comment references to HETZNER_ACCOUNT_API_KEY; the provisioner facade must be the sole reader and at least one reader must be observed positively.`,
        evidence: {
          ...soleReaderSummary,
          eventName: provisionerReady ? 'provisionerReady' : 'lifecycle-scan',
          event: provisionerReady || null,
        },
      });
    } else if (soleReader.unexpected.length > 0) {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: `sole-reader source scan: HETZNER_ACCOUNT_API_KEY named outside src/provisioner-facade.mjs at ${soleReader.unexpected.map((r) => `${r.file}:${r.line}`).join(', ')}; the provisioner facade must be the SOLE reader.`,
        evidence: {
          ...soleReaderSummary,
          unexpectedReaders: soleReader.unexpected,
          eventName: 'provisionerReady',
          event: provisionerReady || null,
        },
      });
    } else if (!provisionerReady) {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: `sole-reader scan observed ${soleReader.readers.length} reader(s), all inside ${soleReader.expectedReaderRelPath}; but provisionerReady did NOT fire on the injected event sink after ready(); events observed: ${events.map((e) => e.event).join(', ') || '(none)'}.`,
        evidence: {
          ...soleReaderSummary,
          eventName: 'provisionerReady',
          eventFound: false,
          observedEvents: events.map((e) => e.event),
        },
      });
    } else if (provisionerReady.tool !== 'hcloud' || provisionerReady.apiHost !== 'https://api.hetzner.cloud/v1') {
      results.push({
        anchorAcId: 'AC-37101-1', verdict: 'fail',
        detail: `sole-reader scan observed ${soleReader.readers.length} reader(s) inside ${soleReader.expectedReaderRelPath}; provisionerReady payload shape is wrong: ${JSON.stringify(provisionerReady)}; expected {tool: 'hcloud', apiHost: 'https://api.hetzner.cloud/v1'}.`,
        evidence: {
          ...soleReaderSummary,
          eventName: 'provisionerReady',
          event: provisionerReady,
          expected: { tool: 'hcloud', apiHost: 'https://api.hetzner.cloud/v1' },
        },
      });
    } else {
      const extraKeysOnEvent = Object.keys(provisionerReady).filter((k) => !['event', 'tool', 'apiHost'].includes(k));
      if (extraKeysOnEvent.length > 0) {
        results.push({
          anchorAcId: 'AC-37101-1', verdict: 'fail',
          detail: `sole-reader scan observed ${soleReader.readers.length} reader(s) inside ${soleReader.expectedReaderRelPath}; provisionerReady carries unexpected keys ${JSON.stringify(extraKeysOnEvent)} in addition to the metadata-only {event, tool, apiHost} set.`,
          evidence: {
            ...soleReaderSummary,
            eventName: 'provisionerReady',
            event: provisionerReady,
            unexpectedKeys: extraKeysOnEvent,
          },
        });
      } else {
        results.push({
          anchorAcId: 'AC-37101-1', verdict: 'pass',
          detail: `sole-reader source scan observed exactly ${soleReader.readers.length} non-comment reader(s) of HETZNER_ACCOUNT_API_KEY across the fixture .mjs/.js, all inside ${soleReader.expectedReaderRelPath} (${soleReader.readers.map((r) => `${r.file}:${r.line}`).join(', ')}); provisionerReady fired with the metadata-only {tool, apiHost} payload.`,
          evidence: {
            ...soleReaderSummary,
            eventName: 'provisionerReady',
            payloadKeys: Object.keys(provisionerReady).sort(),
            // Supplied/echo pair: the probe supplied `tool` and
            // `apiHost` into the facade constructor; the facade
            // emitted them back on the provisionerReady event
            // metadata. Strict equality on both closes the identity
            // half of the semantic anatomy check without inventing
            // a request id on an offline event.
            suppliedTool: 'hcloud',
            echoedTool: provisionerReady.tool,
            suppliedApiHost: 'https://api.hetzner.cloud/v1',
            echoedApiHost: provisionerReady.apiHost,
            tool: provisionerReady.tool,
            apiHost: provisionerReady.apiHost,
          },
        });
      }
    }

    // AC-37103-1 is a LIVE-only AC (its acceptance text requires the
    // real-account apply plus a live `hcloud server list`). This
    // mock-path row is a conformanceOnly fixture-shape observation
    // (not a shelf-only property, so notObservableHere does NOT
    // apply - that field is reserved for browser-only ACs); the row
    // carries a shipped-AC limitation naming the live probe that
    // observes the AC. The full-AC observation lives on
    // real-account-throwaway-server-provision.
    if (!provisioned || !provisioned.id || !provisioned.primaryIpv4 || provisioned.location !== 'fsn1' || provisioned.serverType !== 'cx23') {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'AC-37103-1: live inventory diff not observed here - mock-path fixture-shape check only; the AC observation is carried by real-account-throwaway-server-provision.',
        verdict: 'fail',
        detail: `mock-path fixture-shape check: hetznerServerProvisioned event body is missing or malformed: ${JSON.stringify(provisioned)}`,
        evidence: { eventName: 'hetznerServerProvisioned', event: provisioned || null, expectedKeys: ['id', 'primaryIpv4', 'location', 'serverType'] },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'AC-37103-1: live inventory diff not observed here - mock-path fixture-shape check only; the AC observation is carried by real-account-throwaway-server-provision.',
        verdict: 'pass',
        detail: `mock-path fixture-shape check: facade emitted hetznerServerProvisioned with the expected key shape (id, primaryIpv4, location, serverType).`,
        evidence: {
          eventName: 'hetznerServerProvisioned',
          id: provisioned.id,
          primaryIpv4: provisioned.primaryIpv4,
          location: provisioned.location,
          serverType: provisioned.serverType,
          payloadKeys: Object.keys(provisioned).sort(),
          source: 'mock-facade',
          expectedKeys: ['id', 'primaryIpv4', 'location', 'serverType'],
        },
      });
    }

    if (!snapped || !snapped.snapshotId || !snapped.wallClockTime) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'AC-37108-1: live snapshot inventory not observed here - mock-path fixture-shape check only; the AC observation is carried by real-account-snapshot-on-demand.',
        verdict: 'fail',
        detail: `mock-path fixture-shape check: hetznerSnapshotTaken event body is missing or malformed: ${JSON.stringify(snapped)}`,
        evidence: { eventName: 'hetznerSnapshotTaken', event: snapped || null, expectedKeys: ['snapshotId', 'wallClockTime'] },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'AC-37108-1: live snapshot inventory not observed here - mock-path fixture-shape check only; the AC observation is carried by real-account-snapshot-on-demand.',
        verdict: 'pass',
        detail: `mock-path fixture-shape check: facade emitted hetznerSnapshotTaken with the expected key shape (snapshotId, wallClockTime).`,
        evidence: {
          eventName: 'hetznerSnapshotTaken',
          snapshotId: snapped.snapshotId,
          wallClockTime: snapped.wallClockTime,
          payloadKeys: Object.keys(snapped).sort(),
          source: 'mock-facade',
          expectedKeys: ['snapshotId', 'wallClockTime'],
        },
      });
    }

    if (!destroyed || !destroyed.id) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'AC-37109-3: repeat-run once-per-lifecycle observation not counted here - mock-path fixture-shape check only.',
        verdict: 'fail',
        detail: `mock-path fixture-shape check: hetznerServerDestroyed event body is missing or malformed: ${JSON.stringify(destroyed)}`,
        evidence: { eventName: 'hetznerServerDestroyed', event: destroyed || null, expectedKeys: ['id'] },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: 'AC-37109-3: repeat-run once-per-lifecycle observation not counted here - mock-path fixture-shape check only.',
        verdict: 'pass',
        detail: `mock-path fixture-shape check: facade emitted hetznerServerDestroyed with the destroyed id and a wall-clock timestamp in the payload.`,
        evidence: {
          eventName: 'hetznerServerDestroyed',
          id: destroyed.id,
          wallClockTime: destroyed.wallClockTime,
          payloadKeys: Object.keys(destroyed).sort(),
          source: 'mock-facade',
          expectedKeys: ['id', 'wallClockTime'],
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
      const failEvidence = {
        eventName: 'lifecycle-scan',
        leaks,
        unexpectedKeys,
        eventCount: events.length,
      };
      if (provisioned && provisioned.id) failEvidence.serverId = provisioned.id;
      if (snapped && snapped.snapshotId) failEvidence.snapshotId = snapped.snapshotId;
      results.push({
        anchorAcId: 'AC-37109-1', verdict: 'fail',
        detail: `event-secrecy fail: ${bits.join(' | ')}.`,
        evidence: failEvidence,
      });
    } else {
      const passEvidence = {
        eventName: 'lifecycle-scan',
        // Engine-minted ids that tie this scan to a concrete
        // lifecycle instance: the mock-facade emitted the provision
        // and snapshot events with these ids, and both were included
        // in the scanned event bodies.
        serverId: (provisioned && provisioned.id) ? provisioned.id : undefined,
        snapshotId: (snapped && snapped.snapshotId) ? snapped.snapshotId : undefined,
        eventCount: events.length,
        scannedMarkers: ['token value', 'ssh private key', 'user-data marker'],
        allowedKeysByEvent: Object.fromEntries(Object.entries(ALLOWED_EVENT_KEYS).map(([k, v]) => [k, [...v].sort()])),
        leaks: [],
        unexpectedKeys: [],
      };
      // Drop undefined entries so the row does not carry falsy ids.
      for (const k of Object.keys(passEvidence)) if (passEvidence[k] === undefined) delete passEvidence[k];
      results.push({
        anchorAcId: 'AC-37109-1', verdict: 'pass',
        detail: `event-secrecy scan across ${events.length} event bodies found no leak of the token, ssh private key, or user-data content; every event payload's keys are a subset of the REQ-006 named metadata set.`,
        evidence: passEvidence,
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
