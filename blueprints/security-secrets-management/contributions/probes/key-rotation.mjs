// Key-rotation probe. Encrypts a scratch scope with age recipient
// A; runs sops --rotate --in-place with the same recipient list;
// asserts the payload mac changed (new data key => new MAC) while
// the recipient list is unchanged. Proves the sops rotation verb
// re-keys the payload without touching the recipient set.
//
// capability: secretsProvider.
// Anchor honesty. No AC or REQ observes the SOPS-native --rotate
// property. Row reads AMBER on criterion e (unanchored
// vendor-conformance evidence for ADR-902's default vendor sops+age)
// until a manager-client probe is added that observes REQ-002 at
// its own boundary.
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
export const anchorAcId = null; // No AC/REQ observes SOPS-native rotation; see probe file header.
export const capability = 'secretsProvider';
export const accountBound = false;

export default async function runProbe() {
  const scope = await createScratchAgeScope({ prefix: 'pxe-secrets-rot-' });
  const evidence = { envDeclared: [...DECLARED_ENV], recipient: scope.recipient };
  const results = [];
  try {
    const cipherPath = join(scope.dir, 'scope.enc.json');
    const plaintext = JSON.stringify({ v: 'rotate-only' }, null, 2) + '\n';
    await writeFile(join(scope.dir, 'scope.json'), plaintext, 'utf8');
    const enc = runSops(['--age', scope.recipient, '--encrypt', '--output', cipherPath, join(scope.dir, 'scope.json')],
      { env: sopsEnv(scope.keyPath) });
    if (enc.status !== 0) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `SOPS-native initial encrypt failed (no AC/REQ anchor) status=${enc.status} stderr=${enc.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const before = readSopsMetadata(await readFile(cipherPath, 'utf8'));
    const rot = runSops(['--rotate', '--in-place', cipherPath], { env: sopsEnv(scope.keyPath) });
    if (rot.status !== 0) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `SOPS-native --rotate failed (no AC/REQ anchor) status=${rot.status} stderr=${rot.stderr.slice(0, 200)}` });
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
      detail: `SOPS-native --rotate observation (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). recipients unchanged across --rotate: before=${JSON.stringify(before.recipients)} after=${JSON.stringify(after.recipients)}`,
      evidence: { sameRecipients },
    });

    // MAC changed (new data key).
    results.push({
      anchorAcId: null,
      capability,
      verdict: after.mac !== before.mac ? 'pass' : 'fail',
      detail: `SOPS-native --rotate MAC divergence observation (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). mac diverged after --rotate: before=${before.mac.slice(0, 64)} after=${after.mac.slice(0, 64)}...`,
      evidence: { macBefore: before.mac, macAfter: after.mac },
    });

    // Decryption still works with the same key.
    const dec = runSops(['--decrypt', cipherPath], { env: sopsEnv(scope.keyPath) });
    results.push({
      anchorAcId: null,
      capability,
      verdict: dec.status === 0 && JSON.stringify(JSON.parse(dec.stdout)) === JSON.stringify(JSON.parse(plaintext)) ? 'pass' : 'fail',
      detail: `SOPS-native post-rotation decrypt observation (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). post-rotation decrypt: status=${dec.status} matchesPlaintext=${JSON.stringify(JSON.parse(dec.stdout)) === JSON.stringify(JSON.parse(plaintext))}`,
      evidence: { status: dec.status, matched: JSON.stringify(JSON.parse(dec.stdout)) === JSON.stringify(JSON.parse(plaintext)) },
    });
  } finally {
    await scope.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}
