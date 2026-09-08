// sweep-orphans.mjs (v1.0.1)
//
// Nightly orphan sweep for the shared throwaway-server fixture. Lists
// every Hetzner Cloud server labelled role=rcf-lite-ci-throwaway that
// was created more than 60 minutes ago and deletes it; deletes every
// snapshot labelled role=snapshot with the matching serverName. Emits
// a throwawayServerSweptCount metric on stdout so the delivery-ci-
// workflows layer surfaces a leak run.
//
// v1.0.1: never pass --output json to a hcloud <resource> delete verb
// (H-1 defect (4)); the tolerant JSON parser accepts arrays, objects
// and short informational text output from the delete verbs.

import { spawn } from 'node:child_process';

const CUTOFF_MINUTES = 60;

export async function sweepOrphans({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - CUTOFF_MINUTES * 60_000);
  const servers = await hcloud(['server', 'list', '--selector', 'role=rcf-lite-ci-throwaway', '--output', 'json']).catch(() => []);
  const list = Array.isArray(servers) ? servers : [];
  const targets = list.filter((s) => new Date(s.created) < cutoff);
  let sweptServers = 0;
  let sweptSnapshots = 0;
  for (const s of targets) {
    await hcloud(['server', 'delete', String(s.id)]).catch((err) => {
      process.stderr.write(`sweep server ${s.id} failed: ${err.message}\n`);
    });
    sweptServers += 1;
    const snaps = await hcloud(['image', 'list', '--type=snapshot', '--selector', `serverName=${s.name}`, '--output', 'json']).catch(() => []);
    const snapList = Array.isArray(snaps) ? snaps : (snaps && Array.isArray(snaps.images) ? snaps.images : []);
    for (const img of snapList) {
      await hcloud(['image', 'delete', String(img.id)]).catch(() => { /* count only */ });
      sweptSnapshots += 1;
    }
  }
  const record = {
    metric: 'throwawayServerSweptCount',
    sweptServers,
    sweptSnapshots,
    cutoff: cutoff.toISOString(),
    runAt: now.toISOString(),
  };
  process.stdout.write(JSON.stringify(record, null, 2) + '\n');
  return record;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  sweepOrphans().catch((err) => {
    process.stderr.write(`sweep failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
