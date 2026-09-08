// destroy.mjs (v1.0.1)
//
// Real-account teardown for the shared throwaway-server fixture. Reads
// the last-throwaway.json id (or the record passed in) and shells to
// `hcloud server delete <id>` (no --output json; the delete verbs reject
// the flag, H-1 defect (4)) plus `hcloud image list --type=snapshot
// --output json` to find every snapshot labelled with the server name,
// then `hcloud image delete <id>` for each match. Idempotent: a missing
// scratch file logs a throwawayServerLeaked warning and returns; the
// nightly sweep-orphans job collects the leak.
//
// The tolerant JSON parser accepts arrays, objects and empty stdout so
// the delete verbs' informational text output ('Server 165... deleted')
// does not crash the caller.

import { readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
  await hcloud(['server', 'delete', String(target.id)]);
  const snapshots = await hcloud(['image', 'list', '--type=snapshot', '--output', 'json']).catch(() => []);
  const list = Array.isArray(snapshots) ? snapshots : (snapshots && Array.isArray(snapshots.images) ? snapshots.images : []);
  for (const img of list) {
    const labels = img.labels || {};
    if (labels.serverName === target.name) {
      await hcloud(['image', 'delete', String(img.id)]).catch((err) => {
        process.stderr.write(`snapshot delete ${img.id} failed: ${err.message}\n`);
      });
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
      const trimmed = stdout.trim();
      if (trimmed.length === 0) return resolvePromise(null);
      // Tolerant parser: only JSON.parse if the stdout looks like JSON;
      // hcloud's delete verbs emit an informational text line instead.
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

if (import.meta.url === `file://${process.argv[1]}`) {
  destroyThrowawayServer().then((r) => {
    process.stdout.write(JSON.stringify(r ?? { destroyed: null }, null, 2) + '\n');
  }).catch((err) => {
    process.stderr.write(`destroy failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
