// Snapshot verb (v1.0.1): real-account path called by
// real-account-snapshot-on-demand. Shells `hcloud server create-image
// --type snapshot --description <label> <id>` (the actual hcloud verb;
// v1.0.0 called a non-existent `hcloud image create-image`, H-1 defect
// (5)) and recovers the created snapshot id via `hcloud image list
// --type=snapshot --output json` by matching the serverName label.
// Depends on hcloud being on PATH and the HCLOUD_TOKEN env var being
// set (the operator supplies both via the applying project's
// security-secrets-management binding).

import { spawn } from 'node:child_process';

export async function takeAndVerifySnapshot(server) {
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
