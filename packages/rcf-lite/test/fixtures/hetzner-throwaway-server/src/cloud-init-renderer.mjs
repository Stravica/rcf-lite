// deploy-hetzner-server v1.0.0 cloud-init renderer.
//
// Reads the shipped template at
// blueprints/deploy-hetzner-server/contributions/templates/cloud-init.yaml.tmpl
// and substitutes the {{token}} placeholders against a manifest.
// Two placeholders: {{name}} (the hostname), {{sshAuthorizedKeysBlock}}
// (a YAML sequence of ssh-authorized_keys entries, one per manifest
// sshKeyIds entry, indented six spaces to sit under
// `users -> ssh_authorized_keys:`).
//
// SIMULATE_HARDENING_DRIFT=true removes the unattended-upgrades write-file
// block (the /etc/apt/apt.conf.d/50unattended-upgrades block) from the
// rendered YAML. The render-lint probe FAILS naming the missing line per
// section 3.4 lesson 4.
//
// Runtime posture: pure Node, zero third-party dependencies. Runs on
// Node 24 without pnpm install in the fixture directory.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(HERE, '..');
const PACKAGE_ROOT = resolve(FIXTURE_ROOT, '..', '..', '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..');
export const TEMPLATE_PATH = resolve(
  REPO_ROOT,
  'blueprints/deploy-hetzner-server/contributions/templates/cloud-init.yaml.tmpl',
);

export async function renderCloudInit(manifest) {
  const raw = await readFile(TEMPLATE_PATH, 'utf8');
  const sshKeysBlock = manifest.sshKeyIds
    .map((k) => `      - ${k}`)
    .join('\n');
  let rendered = raw
    .replace(/\{\{name\}\}/g, manifest.name)
    .replace(/\{\{sshAuthorizedKeysBlock\}\}/g, sshKeysBlock);
  if (process.env.SIMULATE_HARDENING_DRIFT === 'true') {
    rendered = removeUnattendedUpgradesBlock(rendered);
  }
  return rendered;
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
