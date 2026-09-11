# security-secrets-management fixture

Shared fixture for the security-secrets-management blueprint's
probe pack (criterion e hardening, 2026-09-11). All four probes
in the pack run against real `sops(1)` + `age(1)` engines on the
developer machine; each probe self-provisions a throwaway age
keypair in the operator's scratchpad, encrypts a scratch scope
file, and cleans up on completion. The estate's canonical vault
at `.vault/scopes/` is NEVER touched by any probe in this pack.

## Layout

- `src/sops-cli.mjs` - a thin wrapper around `spawnSync('sops',
  ...)` that never prints secret bytes and a `readSopsMetadata`
  helper that extracts the ciphertext's `sops.lastmodified`,
  `sops.mac`, `sops.unencrypted_suffix` and `sops.age[].recipient`
  fields as evidence excerpts.

## Probes composed against this fixture

- `encrypt-decrypt-round-trip` (capability `secretsProvider`;
  scratch encrypt then decrypt round-trip; sops mac and recipient
  list captured as evidence).
- `add-recipient-rotation` (capability `secretsProvider`;
  `sops --rotate --in-place --add-age <B>` extends recipient
  list, regenerates the mac, and lets recipient B decrypt with
  their own key alone).
- `key-rotation` (capability `secretsProvider`;
  `sops --rotate --in-place` keeps the recipient list but changes
  the mac; decryption still round-trips against the same key).
- `mismatched-key-refusal` (capability `secretsProvider`; a decrypt
  attempt with a foreign age key returns a non-zero exit and no
  plaintext on stdout; correct-key sanity check follows).

## Declared env vars

| Env var | Tier | Purpose | Consumed by |
|---|---|---|---|
| `SOPS_AGE_KEY_FILE` | required-at-call | Path to the age key file `sops(1)` reads for encrypt / decrypt / rotate verbs. Every probe SETS this per-call to point at the throwaway keypair it just generated; the ambient value is preserved but not read. Never logged, never written to a file. | every probe in this pack |
| `RCF_SECRETS_SCRATCH_DIR` | optional | Override for the scratch directory where throwaway age keys and scratch scope files land. Defaults to the OS tmpdir. When unset the probes still succeed; declared for completeness so orchestrators can pin scratch state under a known root. | every probe in this pack (via `createScratchAgeScope`) |
| `PATH` | required-at-call | Forwarded verbatim from the ambient process to sops(1) so it can resolve its binary and its plugins (age(1), gpg(1), etc.). No other value is read. | every probe (forwarded into the sops child env) |
| `HOME` | required-at-call | Forwarded verbatim from the ambient process to sops(1) so it can resolve the caller's HOME-scoped config paths that some sops setups depend on. No other value is read. | every probe (forwarded into the sops child env) |

The pack reads EXACTLY the four env vars in the table above.
The sops child processes receive a minimal env constructed by the
probes' `sopsEnv(keyPath)` helper - `SOPS_AGE_KEY_FILE`, `PATH`,
`HOME` and nothing else; the entire ambient `process.env` is NEVER
spread into the sops child. The pack
does NOT read `CLERK_SECRET_KEY`, `RESEND_API_KEY`, `CI_HAS_*`, or
any external secret; everything runs against scratch keypairs the
probes generate and destroy in the same run.

## Vendor citations

- sops(1) rotation and recipient management:
  https://github.com/getsops/sops#rotating-data-keys, verifiedOn 2026-09-11.
- age(1) recipient format:
  https://github.com/FiloSottile/age#age, verifiedOn 2026-09-11.
