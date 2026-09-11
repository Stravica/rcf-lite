// provision.mjs (v1.0.1)
//
// Real-account provisioner entry point for the shared throwaway-Hetzner-
// server fixture. Requires HCLOUD_TOKEN on env and hcloud on PATH.
//
// v1.0.1 behaviour:
//   - Reads hetzner/servers/ci-throwaway.json for the manifest shape;
//   - Applies the RCF_LITE_CI_SSH_KEY_NAME env override on manifest
//     sshKeyIds (per-key comma-separated); the manifest value stays
//     the default when the override is unset (H-1 defect (9));
//   - Renders the shipped cloud-init template to
//     hetzner/servers/rendered/<name>.cloud-init.yaml via
//     src/cloud-init-renderer.mjs; the renderer resolves each ssh key
//     name to its public-key material via hcloud ssh-key describe so
//     the deploy user has a working authorized_keys entry (H-1
//     defects (2), (3));
//   - Shells hcloud server create --user-data-from-file <rendered>
//     --output json and reads snake_case fields off the response
//     (public_net.ipv4.ip, datacenter.location.name, server_type.name;
//     H-1 defect (1));
//   - Writes the created server id to scratch/last-throwaway.json for
//     destroy.mjs to pick up in its always-block teardown.
//
// The scratch file and the rendered file both sit under git-ignored
// directories (see .gitignore) so the fixture stays clean between
// runs. Callers set { runId } to distinguish CI runs from local
// invocations.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { renderCloudInitToFile } from './src/cloud-init-renderer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, 'hetzner/servers/ci-throwaway.json');
const SCRATCH_DIR = resolve(HERE, 'scratch');
const SCRATCH_PATH = join(SCRATCH_DIR, 'last-throwaway.json');
const RENDERED_DIR = resolve(HERE, 'hetzner/servers/rendered');

export async function provisionThrowawayServer({ runId, eventSink } = {}) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  applySshKeyOverride(manifest);
  const { renderedPath } = await renderCloudInitToFile(manifest);
  const labelArgs = [
    ...Object.entries({ ...manifest.labels, run: String(runId) }).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
  ];
  const uniqueName = `${manifest.name}-${Date.now()}`;
  const args = [
    'server', 'create',
    '--name', uniqueName,
    '--type', manifest.serverType,
    '--location', manifest.location,
    '--image', manifest.image,
    ...manifest.sshKeyIds.flatMap((k) => ['--ssh-key', k]),
    ...labelArgs,
    '--user-data-from-file', renderedPath,
    '--output', 'json',
  ];
  const parsed = await hcloud(args);
  const s = parsed.server ?? parsed;
  const record = {
    id: s.id,
    name: s.name ?? uniqueName,
    primaryIpv4: s.public_net?.ipv4?.ip,
    location: s.location?.name ?? s.datacenter?.location?.name,
    serverType: s.server_type?.name,
    labels: s.labels,
    renderedCloudInitPath: relToFixture(renderedPath),
  };
  await mkdir(SCRATCH_DIR, { recursive: true });
  await writeFile(SCRATCH_PATH, JSON.stringify(record, null, 2) + '\n', 'utf8');
  // Emit hetznerServerProvisioned on the injected sink (reclosure Item
  // 6) so the caller OBSERVES the event rather than constructing it
  // from the return value. Payload is metadata-only per REQ-006.
  if (typeof eventSink === 'function') {
    eventSink({
      event: 'hetznerServerProvisioned',
      id: record.id,
      name: record.name,
      primaryIpv4: record.primaryIpv4,
      location: record.location,
      serverType: record.serverType,
      ts: Date.now(),
    });
  }
  return record;
}

// Apply the RCF_LITE_CI_SSH_KEY_NAME override on manifest sshKeyIds.
// The env var may hold one name or a comma-separated list; the manifest
// value stays the default when the override is unset or empty. Exported
// for the mock and test consumers.
export function applySshKeyOverride(manifest) {
  const override = process.env.RCF_LITE_CI_SSH_KEY_NAME;
  if (typeof override === 'string' && override.trim().length > 0) {
    const names = override.split(',').map((s) => s.trim()).filter(Boolean);
    manifest.sshKeyIds = names;
  }
  return manifest;
}

function relToFixture(absPath) {
  const rel = absPath.startsWith(HERE) ? absPath.slice(HERE.length + 1) : absPath;
  return rel;
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

// Keep RENDERED_DIR export for tests / consumers that inspect the
// rendered artefact location without running provision.
export { RENDERED_DIR };

if (import.meta.url === `file://${process.argv[1]}`) {
  const runId = process.env.GITHUB_RUN_ID ?? 'local';
  provisionThrowawayServer({ runId }).then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  }).catch((err) => {
    process.stderr.write(`provision failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
