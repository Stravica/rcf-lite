// Encrypt / decrypt round-trip probe for security-secrets-management.
// Generates a throwaway age keypair in the operator's scratchpad,
// encrypts a scratch scope file with sops (binary mode so bytes are
// preserved verbatim), records the sops.mac + sops.lastmodified
// metadata, decrypts back to the original bytes, and asserts BYTE
// equality (not JSON equality) between the original file and the
// decrypted stream. Positive evidence per rule 7d shape 2: the sops
// metadata excerpt (mac, lastmodified, recipient list) captured
// from the ciphertext.
//
// capability: secretsProvider.
// Anchor honesty. No AC or REQ observes the SOPS-native
//   byte-equality property this probe evidences. Per closure
//   addendum rule 1 the honest posture here is to leave the
//   probe unanchored (anchorAcId=null) and record the evidence
//   as vendor-conformance for ADR-902's default vendor (sops+age).
//   The slug reads AMBER on criterion e until a manager-client
//   probe is added that observes REQ-002 at its own boundary.
// accountBound: false (real sops+age engine on this machine).

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createScratchAgeScope, DECLARED_ENV } from './probe-utils.mjs';
import { runSops, readSopsMetadata } from '../../../../packages/rcf-lite/test/fixtures/security-secrets-management/src/sops-cli.mjs';

const CONFORMANCE_LIM = "security-secrets-management-REQ-002: SOPS-native encrypt/decrypt/rotation/mismatched-key operations do not observe the vendor-agnostic manager-client boundary REQ-002 states; the manager-client probe is the follow-up that would anchor REQ-002 (integration harness w-2026-09-11-dave-015).";
export const anchorAcId = null; // No AC or REQ observes the SOPS-native encrypt/decrypt/rotation/mismatched-key property; see probe file comment.
export const capability = 'secretsProvider';
export const accountBound = false;

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

export default async function runProbe() {
  const scope = await createScratchAgeScope();
  const evidence = { envDeclared: [...DECLARED_ENV], scopeDir: scope.dir, recipient: scope.recipient };
  const results = [];
  try {
    const plainPath = join(scope.dir, 'scope.bin');
    const cipherPath = join(scope.dir, 'scope.enc.json');
    // Use raw random bytes plus a marker so a real byte compare is
    // meaningful (JSON round-tripping reformats and defeats byte
    // equality; --input-type binary preserves the exact stream).
    const plaintextBytes = Buffer.concat([Buffer.from('pxe-secrets:'), randomBytes(256)]);
    await writeFile(plainPath, plaintextBytes);

    // Encrypt with sops --input-type binary --output-type binary
    // against the throwaway age recipient.
    const encRes = runSops(
      ['--age', scope.recipient, '--input-type', 'binary', '--output-type', 'json', '--encrypt', '--output', cipherPath, plainPath],
      { env: sopsEnv(scope.keyPath) },
    );
    if (encRes.status !== 0) {
      results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
        anchorAcId, capability, verdict: 'fail',
        detail: `SOPS-native encrypt failed (vendor-conformance evidence for ADR-902 sops+age; no AC/REQ anchor) status=${encRes.status} stderr=${encRes.stderr.slice(0, 200)}`,
        evidence: { encStatus: encRes.status, encStderr: encRes.stderr.slice(0, 200) },
      });
      return { results, extra: evidence };
    }
    const cipherText = await readFile(cipherPath, 'utf8');
    const cipherMeta = readSopsMetadata(cipherText);
    evidence.cipherMeta = cipherMeta;
    results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
      anchorAcId,
      capability,
      verdict: cipherMeta.mac && cipherMeta.lastmodified && cipherMeta.recipients.includes(scope.recipient) ? 'pass' : 'fail',
      detail: `SOPS-native ciphertext-metadata observation (vendor-conformance evidence for ADR-902's default vendor sops+age; NO AC or REQ states the SOPS-native property this probe observes; slug reads AMBER on criterion e until a manager-client probe is added that observes REQ-002 at its own boundary). mac=${cipherMeta.mac ? cipherMeta.mac.slice(0, 40) : null} lastmodified=${cipherMeta.lastmodified} recipients=${JSON.stringify(cipherMeta.recipients)}`,
      evidence: { sopsMetadata: cipherMeta, notObservableACsOrREQs: 'SOPS-native crypto layer; slug is AMBER on criterion-e until a manager-client probe is added that observes REQ-002 at its boundary.' },
    });

    // Decrypt with sops --output <file> so binary bytes survive the
    // spawnSync string-encoded stdout channel (utf8 replacement would
    // otherwise corrupt any non-utf8 byte before the compare).
    const decryptedPath = join(scope.dir, 'scope.dec.bin');
    const decRes = runSops(
      ['--decrypt', '--input-type', 'json', '--output-type', 'binary', '--output', decryptedPath, cipherPath],
      { env: sopsEnv(scope.keyPath) },
    );
    if (decRes.status !== 0) {
      results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
        anchorAcId, capability, verdict: 'fail',
        detail: `SOPS-native decrypt failed (vendor-conformance evidence for ADR-902 sops+age; no AC/REQ anchor) status=${decRes.status} stderr=${decRes.stderr.slice(0, 200)}`,
        evidence: { decStatus: decRes.status, decStderr: decRes.stderr.slice(0, 200) },
      });
      return { results, extra: evidence };
    }
    const decryptedBytes = await readFile(decryptedPath);
    const originalBytes = plaintextBytes;
    const originalHash = createHash('sha256').update(originalBytes).digest('hex');
    const decryptedHash = createHash('sha256').update(decryptedBytes).digest('hex');
    const bytesEqual = originalBytes.length === decryptedBytes.length && Buffer.compare(originalBytes, decryptedBytes) === 0;
    evidence.byteCompare = {
      originalLength: originalBytes.length,
      decryptedLength: decryptedBytes.length,
      originalSha256: originalHash,
      decryptedSha256: decryptedHash,
      bytesEqual,
    };
    results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
      anchorAcId,
      capability,
      verdict: bytesEqual ? 'pass' : 'fail',
      detail: `SOPS-native byte-equality on the encrypt/decrypt round-trip (Buffer.compare === 0 on the raw bytes; vendor-conformance evidence for ADR-902 sops+age; no AC or REQ anchors this property; row reads AMBER). originalLength=${originalBytes.length} decryptedLength=${decryptedBytes.length} sha256(original)=${originalHash.slice(0, 16)} sha256(decrypted)=${decryptedHash.slice(0, 16)} bufferCompareZero=${bytesEqual}`,
      evidence: { ...evidence.byteCompare, notObservableACsOrREQs: 'SOPS-native crypto layer; slug is AMBER on criterion-e until a manager-client probe is added.' },
    });
  } finally {
    await scope.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}
