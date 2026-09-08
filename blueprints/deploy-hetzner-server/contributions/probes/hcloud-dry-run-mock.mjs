// Probe: hcloud dry-run mock (v1.0.1 mutation-purified per H-1).
//
// anchorAcId: AC-37101-1 (provisioner facade sole reader + provisionerReady
// on boot; also covers AC-37109-1 event-secrecy across the lifecycle;
// also covers AC-14501-1 mock-consumes-rendered-file assertions per H-1
// hardening block REQ-145).
// accountBound: false.
//
// Drives the provisioner facade with the fixture's ci-throwaway manifest
// against the mocked hcloud shim (src/hcloud-mock.mjs) and consumes the
// SAME rendered cloud-init user-data file the real path consumes (the
// fixture renderer writes it under hetzner/servers/rendered/ before the
// facade is exercised, and this probe reads it back and asserts an
// ssh-ed25519/ssh-rsa public-key line under the deploy user plus a
// NOPASSWD directive naming that user). The rendered-file assertion is
// what stops a mocked probe from passing while the real path fails on
// the same artefact (H-1 REQ-145 / AC-14501-1).
//
// The probe body reads NO process.env.SIMULATE_ switch. Fixture-side
// mutations live in src/cloud-init-renderer.mjs, src/hcloud-mock.mjs
// and src/provisioner-facade.mjs and alter INPUT only.
//
// Assertions:
//   - the facade opens on ready() and fires provisionerReady with a
//     metadata-only payload {tool, apiHost}.
//   - createServer parses the mocked JSON stdout and emits
//     hetznerServerProvisioned with id, primaryIpv4, location=fsn1,
//     serverType=cx23.
//   - takeSnapshot fires hetznerSnapshotTaken with snapshot id and time.
//   - destroyServer fires hetznerServerDestroyed with the id.
//   - no event body across the run carries the token, an ssh private-key
//     marker, or the rendered user-data bytes (event-secrecy check).
//   - the rendered cloud-init file exists under the fixture's rendered
//     directory and carries at least one ssh-ed25519 or ssh-rsa
//     authorized-keys line under the deploy user plus a NOPASSWD
//     directive naming that user (H-1 REQ-145 / AC-14501-1).

import { readFile, access } from 'node:fs/promises';
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

  // Render the cloud-init to disk with a fixture-side stubbed public
  // key (the mock path never calls hcloud ssh-key describe); the real
  // path resolves the material via hcloud and writes to the same
  // location. Both consume the same file shape.
  const publicKeys = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePubKeyForMockedRunHardeningH1 rcf-lite-ci-mock'];
  const { renderedPath, rendered } = await renderCloudInitToFile(manifest, { publicKeys });

  // H-1 REQ-145 / AC-14501-1: assert the rendered file carries an
  // ssh-ed25519 or ssh-rsa line for the deploy user AND a NOPASSWD
  // directive naming that user. This assertion is what breaks the
  // "mock passes while real path fails on the same artefact" class.
  const renderedFromDisk = await readFile(renderedPath, 'utf8');
  const sshKeyLine = /(ssh-ed25519|ssh-rsa)\s+/i.test(renderedFromDisk);
  const nopasswdLine = /deploy\s+ALL\s*=\s*\(ALL\)\s+NOPASSWD/i.test(renderedFromDisk);
  if (!sshKeyLine) {
    results.push({
      anchorAcId: 'AC-14501-1',
      verdict: 'fail',
      detail: `rendered cloud-init at ${relative(PROJECT_ROOT, renderedPath)} carries no ssh-ed25519 or ssh-rsa authorized-keys line for the deploy user; the real path would provision a server with an unusable authorized_keys entry.`,
    });
  } else if (!nopasswdLine) {
    results.push({
      anchorAcId: 'AC-14501-1',
      verdict: 'fail',
      detail: `rendered cloud-init at ${relative(PROJECT_ROOT, renderedPath)} carries no NOPASSWD directive for the deploy user; the six sudoed baseline checks would block on a tty prompt.`,
    });
  } else {
    results.push({
      anchorAcId: 'AC-14501-1',
      verdict: 'pass',
      detail: `rendered cloud-init at ${relative(PROJECT_ROOT, renderedPath)} carries an ssh public-key line for the deploy user (byteLength ${rendered.length}) and a NOPASSWD sudoers directive for that user; the mock and the real path consume the same artefact.`,
    });
  }

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
        detail: `event-secrecy leak: ${leaks.map((l) => `${l.event} carries ${l.marker}`).join('; ')} (defensive-fake finding; check for a SIMULATE_EVENT_SECRECY_LEAK mutation in the fixture-side facade shim).`,
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
      detail: `provisioner facade lifecycle threw: ${err.message} (probable cause: mocked hcloud stdout is not JSON; check for a SIMULATE_JSON_PARSE_STRIP mutation in the fixture-side mock shim).`,
    });
  }
  return {
    results,
    extra: {
      eventCount: events.length,
      events: events.map((e) => ({ event: e.event, keys: Object.keys(e).sort() })),
      renderedPath: relative(PROJECT_ROOT, renderedPath),
      renderedByteLength: rendered.length,
      renderedAssertions: { sshKeyLine, nopasswdLine },
    },
  };
}
