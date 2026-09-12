// deploy-hetzner-server v1.0.0 provisioner facade (fixture proto).
//
// createProvisionerFacade({ token, tool, apiHost, eventSink, invoke })
// returns { ready, createServer, applyFirewall, takeSnapshot, listSnapshots,
// destroyServer, eventLog }. The factory captures the token; consumers
// call the returned methods but never see the token again.
//
// - tool 'hcloud' shells to `hcloud` via the injected `invoke` (default:
//   invokeHcloudMock from src/hcloud-mock.mjs), reads --output json,
//   projects the documented fields.
// - tool 'raw-api' would fetch the Hetzner Cloud REST API; a stub raises
//   'raw-api mode is not exercised in the mocked fixture' so the
//   dry-run mock probe covers the hcloud path only (real accounts
//   exercise raw-api separately per ADR-3803).
//
// eventLog is a shared array the injected eventSink writes to. Payloads
// are metadata-only per REQ-006; SIMULATE_EVENT_SECRECY_LEAK=true injects
// the token into hetznerServerProvisioned so the event-secrecy check
// inside the dry-run-mock probe FAILS.

import { invokeHcloudMock } from './hcloud-mock.mjs';

const SUPPORTED_TOOLS = ['hcloud', 'raw-api'];

// The default token source is the operator variable HETZNER_ACCOUNT_API_KEY,
// so this module is the sole reader of that variable name across the
// fixture .mjs/.js source. Callers may still inject a different token
// explicitly (the mock probe injects a synthetic literal); explicit
// injection wins over the default env read.
export function createProvisionerFacade(options) {
  const {
    token = process.env.HETZNER_ACCOUNT_API_KEY,
    tool = 'hcloud',
    apiHost = 'https://api.hetzner.cloud/v1',
    eventSink,
    invoke,
  } = options;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('provisioner-facade: token is required');
  }
  if (!SUPPORTED_TOOLS.includes(tool)) {
    throw new Error(`provisioner-facade: tool must be one of ${SUPPORTED_TOOLS.join(', ')}`);
  }
  if (typeof eventSink !== 'function') {
    throw new Error('provisioner-facade: eventSink function is required');
  }
  const capturedInvoke = invoke ?? invokeHcloudMock;
  let ready = false;

  function emit(event, payload) {
    const body = { event, ...payload };
    if (event === 'hetznerServerProvisioned' && process.env.SIMULATE_EVENT_SECRECY_LEAK === 'true') {
      body.leakedToken = token;
    }
    eventSink(body);
  }

  function requireReady() {
    if (!ready) throw new Error('provisioner-facade: facade is not ready; call ready() first');
  }

  async function readyFn() {
    if (ready) return;
    ready = true;
    emit('provisionerReady', { tool, apiHost });
  }

  function shellArgs(argv) {
    if (tool !== 'hcloud') {
      throw new Error('provisioner-facade: raw-api mode is not exercised in the mocked fixture');
    }
    const res = capturedInvoke(argv);
    if (res.code !== 0) {
      throw new Error(`hcloud non-zero: ${res.stderr || res.stdout}`);
    }
    return JSON.parse(res.stdout);
  }

  async function createServer(manifest) {
    requireReady();
    const labelArgs = Object.entries(manifest.labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]);
    const argv = [
      'server', 'create',
      '--name', manifest.name,
      '--type', manifest.serverType,
      '--location', manifest.location,
      '--image', manifest.image,
      ...labelArgs,
      '--output', 'json',
    ];
    const parsed = shellArgs(argv);
    const server = parsed.server;
    const record = {
      id: server.id,
      primaryIpv4: server.publicNet.ipv4.ip,
      location: server.datacenter.location.name,
      serverType: server.serverType.name,
      labels: server.labels,
    };
    emit('hetznerServerProvisioned', record);
    return record;
  }

  async function applyFirewall(manifest) {
    requireReady();
    const argv = [
      'firewall', 'create',
      '--name', `${manifest.name}-fw`,
      '--output', 'json',
    ];
    return shellArgs(argv);
  }

  async function takeSnapshot(server, description) {
    requireReady();
    const argv = [
      'image', 'create-image',
      '--server', String(server.id),
      '--description', description ?? `${server.name ?? 'server'}-${new Date().toISOString()}`,
      '--label', `role=snapshot`,
      '--label', `serverName=${server.name ?? String(server.id)}`,
      '--output', 'json',
    ];
    const parsed = shellArgs(argv);
    const record = {
      serverId: server.id,
      snapshotId: parsed.image.id,
      wallClockTime: parsed.image.created,
    };
    emit('hetznerSnapshotTaken', record);
    return record;
  }

  async function listSnapshots(server) {
    requireReady();
    const argv = ['image', 'list', '--type=snapshot', '--output', 'json'];
    const parsed = shellArgs(argv);
    return Array.isArray(parsed) ? parsed : parsed.images ?? [];
  }

  async function destroyServer(server) {
    requireReady();
    const argv = ['server', 'delete', String(server.id), '--output', 'json'];
    shellArgs(argv);
    emit('hetznerServerDestroyed', { id: server.id, wallClockTime: new Date().toISOString() });
  }

  return {
    ready: readyFn,
    createServer,
    applyFirewall,
    takeSnapshot,
    listSnapshots,
    destroyServer,
  };
}

export function createEventLog() {
  const events = [];
  function eventSink(body) {
    events.push(body);
  }
  return { events, eventSink };
}
