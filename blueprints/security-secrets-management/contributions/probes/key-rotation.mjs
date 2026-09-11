// Key-rotation probe. Encrypts a scratch scope with age recipient
// A; runs sops --rotate --in-place with the same recipient list;
// asserts the payload mac changed (new data key => new MAC) while
// the recipient list is unchanged. Proves the sops rotation verb
// re-keys the payload without touching the recipient set.
//
// capability: secretsProvider.
// anchorAcId: security-secrets-management-REQ-002.
// Anchor (per closure): REQ-002 (Secrets are read through one
// vendor-agnostic manager client interface). No AC covers SOPS
// engine ops directly; anchoring the REQ per closure rule 1.
// accountBound: false.

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratchAgeScope, DECLARED_ENV } from './probe-utils.mjs';
import { runSops, readSopsMetadata } from '../../../../packages/rcf-lite/test/fixtures/security-secrets-management/src/sops-cli.mjs';


// Rule (closure section 1 / addendum rule 10): probes pass an
// explicit minimal env to sops children, never a spread of the
// entire ambient process.env. Only SOPS_AGE_KEY_FILE, PATH and
// HOME are forwarded; the fixture README's env-var table is the
// declared surface.
function sopsEnv(keyPath) {
  return {
    SOPS_AGE_KEY_FILE: keyPath,
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
  };
}
export const anchorAcId = 'security-secrets-management-REQ-002';
export const capability = 'secretsProvider';
export const accountBound = false;

export default async function runProbe() {
  const scope = await createScratchAgeScope({ prefix: 'qa-e-secrets-rot-' });
  const evidence = { envDeclared: [...DECLARED_ENV], recipient: scope.recipient };
  const results = [];
  try {
    const cipherPath = join(scope.dir, 'scope.enc.json');
    const plaintext = JSON.stringify({ v: 'rotate-only' }, null, 2) + '\n';
    await writeFile(join(scope.dir, 'scope.json'), plaintext, 'utf8');
    const enc = runSops(['--age', scope.recipient, '--encrypt', '--output', cipherPath, join(scope.dir, 'scope.json')],
      { env: sopsEnv(scope.keyPath) });
    if (enc.status !== 0) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `initial encrypt failed status=${enc.status} stderr=${enc.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const before = readSopsMetadata(await readFile(cipherPath, 'utf8'));
    const rot = runSops(['--rotate', '--in-place', cipherPath], { env: sopsEnv(scope.keyPath) });
    if (rot.status !== 0) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `sops rotate failed status=${rot.status} stderr=${rot.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const after = readSopsMetadata(await readFile(cipherPath, 'utf8'));
    evidence.metaBefore = before; evidence.metaAfter = after;

    // Recipient list unchanged.
    const sameRecipients = JSON.stringify(before.recipients) === JSON.stringify(after.recipients);
    results.push({
      anchorAcId,
      capability,
      verdict: sameRecipients ? 'pass' : 'fail',
      detail: `recipients unchanged across --rotate: before=${JSON.stringify(before.recipients)} after=${JSON.stringify(after.recipients)}`,
      evidence: { sameRecipients },
    });

    // MAC changed (new data key).
    results.push({
      anchorAcId: 'security-secrets-management-REQ-002',
      capability,
      verdict: after.mac !== before.mac ? 'pass' : 'fail',
      detail: `mac diverged after --rotate: before=${before.mac.slice(0, 64)} after=${after.mac.slice(0, 64)}...`,
      evidence: { macBefore: before.mac, macAfter: after.mac },
    });

    // Decryption still works with the same key.
    const dec = runSops(['--decrypt', cipherPath], { env: sopsEnv(scope.keyPath) });
    results.push({
      anchorAcId: 'security-secrets-management-REQ-002',
      capability,
      verdict: dec.status === 0 && JSON.stringify(JSON.parse(dec.stdout)) === JSON.stringify(JSON.parse(plaintext)) ? 'pass' : 'fail',
      detail: `post-rotation decrypt: status=${dec.status} matchesPlaintext=${JSON.stringify(JSON.parse(dec.stdout)) === JSON.stringify(JSON.parse(plaintext))}`,
      evidence: { status: dec.status, matched: JSON.stringify(JSON.parse(dec.stdout)) === JSON.stringify(JSON.parse(plaintext)) },
    });
  } finally {
    await scope.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}
