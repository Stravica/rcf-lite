// destroy.mjs
//
// Real-account teardown for the shared throwaway-server fixture. Reads
// the last-throwaway.json id (or the record passed in) and shells to
// hcloud server delete + hcloud image list + hcloud image delete for
// every snapshot labelled with the server name. Idempotent: a missing
// scratch file logs a throwawayServerLeaked warning and returns; the
// nightly sweep-orphans job collects the leak.

import { readFile, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_PATH = resolve(HERE, 'scratch/last-throwaway.json');

export async function destroyThrowawayServer(record) {
  let target = record;
  if (!target) {
    try {
      target = JSON.parse(await readFile(SCRATCH_PATH, 'utf8'));
    } catch (err) {
      process.stderr.write(`throwawayServerLeaked: scratch file missing (${err.message}); rely on the nightly sweep-orphans job.\n`);
      return null;
    }
  }
  if (!target || !target.id) {
    process.stderr.write('throwawayServerLeaked: no server id available; rely on sweep-orphans.\n');
    return null;
  }
  await hcloud(['server', 'delete', String(target.id), '--output', 'json']);
  const snapshots = await hcloud(['image', 'list', '--type=snapshot', '--output', 'json']).catch(() => []);
  if (Array.isArray(snapshots)) {
    for (const img of snapshots) {
      const labels = img.labels || {};
      if (labels.serverName === target.name) {
        await hcloud(['image', 'delete', String(img.id), '--output', 'json']).catch((err) => {
          process.stderr.write(`snapshot delete ${img.id} failed: ${err.message}\n`);
        });
      }
    }
  }
  try { await unlink(SCRATCH_PATH); } catch (_) { /* fine */ }
  return { destroyed: target.id };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  destroyThrowawayServer().then((r) => {
    process.stdout.write(JSON.stringify(r ?? { destroyed: null }, null, 2) + '\n');
  }).catch((err) => {
    process.stderr.write(`destroy failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
