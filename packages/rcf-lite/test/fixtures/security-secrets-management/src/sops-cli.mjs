// Thin wrapper around sops(1) for probes. Composes the shell-safe
// argv and returns { status, stdout, stderr }. Never prints
// secret bytes; probes always call this and record only the
// metadata slice they extract from the output.

import { spawnSync } from 'node:child_process';

export function runSops(args, { env = process.env, input } = {}) {
  const res = spawnSync('sops', args, { env, encoding: 'utf8', input });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function readSopsMetadata(cipherText) {
  const doc = JSON.parse(cipherText);
  const sops = doc.sops || {};
  return {
    lastmodified: sops.lastmodified,
    mac: sops.mac,
    unencryptedSuffix: sops.unencrypted_suffix,
    recipients: (sops.age || []).map((a) => a.recipient),
  };
}
