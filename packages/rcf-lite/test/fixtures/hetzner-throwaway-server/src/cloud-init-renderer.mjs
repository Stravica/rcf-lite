// deploy-hetzner-server v1.0.1 cloud-init renderer.
//
// Reads the shipped template at
// blueprints/deploy-hetzner-server/contributions/templates/cloud-init.yaml.tmpl
// and substitutes the {{token}} placeholders against a manifest.
// Two placeholders: {{name}} (the hostname), {{sshAuthorizedKeysBlock}}
// (a YAML sequence of ssh-authorized_keys entries, one per resolved
// public-key line, indented six spaces to sit under
// `users -> ssh_authorized_keys:`).
//
// v1.0.1 behaviour change: resolveSshKeyMaterial() shells to hcloud
// ssh-key describe --output json for every manifest.sshKeyIds entry
// and inlines the .publicKey text into ssh_authorized_keys. In v1.0.0
// the renderer inlined the key NAME (the manifest reference) which
// left the deploy user with no working authorized_keys entry. The
// resolver is skipped when hcloud is not on PATH (mock or in-process
// runs) and the caller may pass explicit publicKeys via
// renderCloudInit(manifest, { publicKeys }) instead.
//
// The renderer also writes the rendered YAML to
// hetzner/servers/rendered/<name>.cloud-init.yaml so provision.mjs
// and hcloud-dry-run-mock.mjs both consume the SAME artefact per the
// H-1 fixture-fidelity requirement (REQ-145 / AC-14501-1).
//
// SIMULATE_HARDENING_DRIFT=true (fixture-side INPUT mutation, not a
// probe read) removes the unattended-upgrades write-file block, the
// unattended-upgrades package entry AND the systemctl enable line
// from the rendered YAML. The render-lint probe then FAILS naming
// the missing baseline block per hetzner-round-7-spec-2026-09-07.md
// section 3.4 lesson 4.
//
// Runtime posture: pure Node, zero third-party dependencies. Runs on
// Node 24 without pnpm install in the fixture directory.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(HERE, '..');
const PACKAGE_ROOT = resolve(FIXTURE_ROOT, '..', '..', '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..');
export const TEMPLATE_PATH = resolve(
  REPO_ROOT,
  'blueprints/deploy-hetzner-server/contributions/templates/cloud-init.yaml.tmpl',
);
export const RENDERED_DIR = resolve(FIXTURE_ROOT, 'hetzner/servers/rendered');

export async function renderCloudInit(manifest, options = {}) {
  const raw = await readFile(TEMPLATE_PATH, 'utf8');
  const publicKeys = options.publicKeys ?? await resolveSshKeyMaterial(manifest.sshKeyIds);
  const sshKeysBlock = publicKeys
    .map((line) => `      - ${line.trim()}`)
    .join('\n');
  let rendered = raw
    .replace(/\{\{name\}\}/g, manifest.name)
    .replace(/\{\{sshAuthorizedKeysBlock\}\}/g, sshKeysBlock);
  if (process.env.SIMULATE_HARDENING_DRIFT === 'true') {
    rendered = removeUnattendedUpgradesBlock(rendered);
  }
  return rendered;
}

export async function renderCloudInitToFile(manifest, options = {}) {
  const rendered = await renderCloudInit(manifest, options);
  await mkdir(RENDERED_DIR, { recursive: true });
  const target = join(RENDERED_DIR, `${manifest.name}.cloud-init.yaml`);
  await writeFile(target, rendered, 'utf8');
  return { renderedPath: target, rendered };
}

// Resolve every sshKey name in the manifest to its .publicKey via
// `hcloud ssh-key describe <name> --output json`. Requires HCLOUD_TOKEN
// on env (the caller supplies it). Returns an array of public-key
// lines (one entry per resolved key). When hcloud is not on PATH the
// function throws with a helpful message; callers that run without
// hcloud (in-process mock) pass options.publicKeys instead.
export async function resolveSshKeyMaterial(names) {
  const out = [];
  for (const name of names) {
    const parsed = await hcloud(['ssh-key', 'describe', String(name), '--output', 'json']);
    const line = parsed && parsed.public_key;
    if (typeof line !== 'string' || line.trim().length === 0) {
      throw new Error(`resolveSshKeyMaterial: hcloud ssh-key describe ${name} returned no publicKey field`);
    }
    out.push(line);
  }
  return out;
}

function hcloud(argv) {
  return new Promise((resolvePromise, reject) => {
    let p;
    try {
      p = spawn('hcloud', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`hcloud spawn failed: ${err.message}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (err) => reject(new Error(`hcloud spawn failed: ${err.message}`)));
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

function removeUnattendedUpgradesBlock(text) {
  // Drop the /etc/apt/apt.conf.d/50unattended-upgrades write-file block
  // AND the unattended-upgrades package entry AND the systemctl enable
  // line, so all three drift signals disappear from the rendered YAML.
  const lines = text.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.includes("path: /etc/apt/apt.conf.d/50unattended-upgrades")) {
      inBlock = true;
      out.pop();
      continue;
    }
    if (inBlock) {
      if (line.trim().startsWith('- path:') || line.trim().startsWith('packages:')) {
        inBlock = false;
      } else {
        continue;
      }
    }
    if (line.trim() === '- unattended-upgrades') continue;
    if (line.includes('systemctl enable --now unattended-upgrades')) continue;
    out.push(line);
  }
  return out.join('\n');
}

export const BASELINE_BLOCKS = Object.freeze([
  {
    id: 'sshKeyOnly',
    label: 'SSH key-only (PasswordAuthentication no)',
    markers: ['PasswordAuthentication no'],
  },
  {
    id: 'rootDisabled',
    label: 'root disabled (PermitRootLogin no)',
    markers: ['PermitRootLogin no'],
  },
  {
    id: 'ufwDefaultDeny',
    label: 'UFW default-deny incoming with 22 80 443 allowed',
    markers: ['ufw default deny incoming', 'ufw allow 22/tcp'],
  },
  {
    id: 'dockerUserChain',
    label: 'DOCKER-USER iptables chain drops non-conforming egress',
    markers: [':DOCKER-USER - [0:0]', 'DOCKER-USER -j DROP'],
  },
  {
    id: 'fail2banSshJail',
    label: 'fail2ban SSH jail on port 22',
    markers: ['/etc/fail2ban/jail.d/sshd.conf', '[sshd]'],
  },
  {
    id: 'unattendedUpgrades',
    label: 'unattended-upgrades on for security updates',
    markers: [
      '/etc/apt/apt.conf.d/50unattended-upgrades',
      'Unattended-Upgrade::Origins-Pattern',
    ],
  },
]);
