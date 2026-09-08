// provision.mjs
//
// Real-account provisioner entry point for the shared throwaway-Hetzner-
// server fixture. Requires HCLOUD_TOKEN on env and hcloud on PATH.
// Reads hetzner/servers/ci-throwaway.json, adds run-scoped labels
// (run=<runId>, blueprint=<slug>), shells to hcloud server create, writes
// the created server id to a scratch file scratch/last-throwaway.json for
// destroy.mjs, and returns the projected record.
//
// The scratch file is git-ignored (see .gitignore) so the fixture stays
// clean between runs. Callers set { runId } to distinguish CI runs from
// local invocations.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, 'hetzner/servers/ci-throwaway.json');
const SCRATCH_DIR = resolve(HERE, 'scratch');
const SCRATCH_PATH = join(SCRATCH_DIR, 'last-throwaway.json');

export async function provisionThrowawayServer({ runId }) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const labelArgs = [
    ...Object.entries({ ...manifest.labels, run: String(runId) }).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
  ];
  const args = [
    'server', 'create',
    '--name', `${manifest.name}-${Date.now()}`,
    '--type', manifest.serverType,
    '--location', manifest.location,
    '--image', manifest.image,
    ...manifest.sshKeyIds.flatMap((k) => ['--ssh-key', k]),
    ...labelArgs,
    '--user-data-from-file', manifest.cloudInitPath,
    '--output', 'json',
  ];
  const parsed = await hcloud(args);
  const s = parsed.server;
  const record = {
    id: s.id,
    name: s.name,
    primaryIpv4: s.publicNet.ipv4.ip,
    location: s.datacenter.location.name,
    serverType: s.serverType.name,
    labels: s.labels,
  };
  await mkdir(SCRATCH_DIR, { recursive: true });
  await writeFile(SCRATCH_PATH, JSON.stringify(record, null, 2) + '\n', 'utf8');
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
      try {
        resolvePromise(stdout.trim().length > 0 ? JSON.parse(stdout) : null);
      } catch (err) {
        reject(new Error(`hcloud stdout is not JSON: ${err.message}`));
      }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runId = process.env.GITHUB_RUN_ID ?? 'local';
  provisionThrowawayServer({ runId }).then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  }).catch((err) => {
    process.stderr.write(`provision failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
