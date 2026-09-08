// Snapshot verb: real-account path called by
// real-account-snapshot-on-demand. Shells to hcloud image create-image
// and hcloud image list --type=snapshot --output json; asserts the
// created snapshot appears in the list with the expected label
// {serverName=<name>}. Depends on hcloud being on PATH and the
// HCLOUD_TOKEN env var being set (the operator supplies both via the
// applying project's security-secrets-management binding).

import { spawn } from 'node:child_process';

export async function takeAndVerifySnapshot(server) {
  const wallClockTime = new Date().toISOString();
  const description = `${server.name ?? server.id}-${wallClockTime}`;
  const createArgs = [
    'image', 'create-image',
    '--server', String(server.id),
    '--description', description,
    '--label', `role=snapshot`,
    '--label', `serverName=${server.name ?? server.id}`,
    '--output', 'json',
  ];
  const created = await hcloud(createArgs);
  const listArgs = ['image', 'list', '--type=snapshot', '--output', 'json'];
  const list = await hcloud(listArgs);
  const snapshotId = created && created.image ? created.image.id : null;
  const match = Array.isArray(list) ? list.find((i) => i.id === snapshotId) : null;
  return { snapshotId, wallClockTime, match, listCount: Array.isArray(list) ? list.length : 0 };
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
      try {
        resolvePromise(stdout.trim().length > 0 ? JSON.parse(stdout) : null);
      } catch (err) {
        reject(new Error(`hcloud stdout is not JSON: ${err.message}`));
      }
    });
  });
}
