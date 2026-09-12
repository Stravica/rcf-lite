// Snapshot verb (v1.0.2): real-account path called by
// real-account-snapshot-on-demand. Shells `hcloud server create-image
// --type snapshot --description <label> <id>` (the actual hcloud verb;
// v1.0.0 called a non-existent `hcloud image create-image`, defect
// (5)) and recovers the created snapshot id via `hcloud image list
// --type=snapshot --output json` by matching the serverName label.
// Depends on hcloud being on PATH and the HCLOUD_TOKEN env var being
// set (the operator supplies both via the applying project's
// security-secrets-management binding).

// v1.0.2 (v1.1.5, defect): the verb now emits
// `hetznerSnapshotTaken` on an optional injected eventSink, so the
// snapshot probe can OBSERVE the emitted event rather than constructing
// it from the return value. The emit fires only after the vendor list
// call carries the created id (i.e. the snapshot really landed).

import { spawn } from 'node:child_process';

export async function takeAndVerifySnapshot(server, opts = {}) {
  const eventSink = typeof opts.eventSink === 'function' ? opts.eventSink : null;
  const wallClockTime = new Date().toISOString();
  const description = `${server.name ?? server.id}-${wallClockTime}`;
  const createArgs = [
    'server', 'create-image',
    '--type', 'snapshot',
    '--description', description,
    '--label', `role=snapshot`,
    '--label', `serverName=${server.name ?? server.id}`,
    String(server.id),
  ];
  // hcloud server create-image emits a short informational line, not
  // JSON; the tolerant parser accepts the text form and we recover the
  // id via the list call.
  await hcloud(createArgs);
  const listArgs = ['image', 'list', '--type=snapshot', '--output', 'json'];
  const list = await hcloud(listArgs);
  const listArray = Array.isArray(list) ? list : (list && Array.isArray(list.images) ? list.images : []);
  const match = listArray.find((i) => (i.labels || {}).serverName === (server.name ?? String(server.id)));
  const snapshotId = match ? match.id : null;
  // Emit hetznerSnapshotTaken ONLY after the list confirmed the id
  // landed. The event body is metadata-only per REQ-006.
  if (eventSink && snapshotId) {
    eventSink({
      event: 'hetznerSnapshotTaken',
      serverName: server.name ?? String(server.id),
      serverId: server.id,
      snapshotId,
      ts: Date.parse(wallClockTime),
      wallClockTime,
    });
  }
  return { snapshotId, wallClockTime, match, listCount: listArray.length };
}

function hcloud(argv) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn('hcloud', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`hcloud ${argv.join(' ')} exited ${code}: ${stderr}`));
      const trimmed = stdout.trim();
      if (trimmed.length === 0) return resolvePromise(null);
      const first = trimmed[0];
      if (first !== '{' && first !== '[') return resolvePromise({ text: trimmed });
      try {
        resolvePromise(JSON.parse(trimmed));
      } catch (err) {
        reject(new Error(`hcloud stdout is not JSON: ${err.message}`));
      }
    });
  });
}
