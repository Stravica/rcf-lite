# security-secrets-management changelog

## 1.1.4 - 2026-09-11

- Third closure remediation (2026-09-11): every SOPS-native result row is now marked `conformanceOnly: true` with a limitation naming REQ-002 (the manager-client boundary REQ-002 states, which the SOPS-native encrypt/decrypt/rotation/mismatched-key operations do not observe). Anchors stay `null` as before. Anatomy helper rewritten to enforce field combinations per shape , bare diagnostic evidence like `{macDiverged}`, `{sameRecipients}` or `{status,matched}` now passes only under the conformanceOnly+limitation shape. This pack is criterion-e conformance evidence pending the manager-client probe (the integration harness follow-up).

## 1.1.3 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering the secretsProvider capability across four probes running against real `sops(1)` + `age(1)` engines with throwaway keypairs the probes self-provision and self-clean under `RCF_SECRETS_SCRATCH_DIR`: `encrypt-decrypt-round-trip` (scratch scope encrypt then decrypt; sops metadata captured as evidence excerpts), `add-recipient-rotation` (`--rotate --add-age` extends recipient list, regenerates mac, and lets the new recipient decrypt), `key-rotation` (`--rotate` re-keys the payload without changing recipients), and `mismatched-key-refusal` (foreign-key decrypt returns non-zero with no plaintext). The estate vault at `.vault/scopes/` is never touched. Fixture at `packages/rcf-lite/test/fixtures/security-secrets-management/` declares every env var the pack reads; anatomy test pins pack shape, fixture manifest and per-probe aggregate pass on the real engine.
- Closure fix pass (second closure DO-NOT-MERGE addressed): the SOPS probes no longer claim REQ-002 as their anchor. REQ-002 is the manager-client boundary; the SOPS-native encrypt/decrypt/rotation/mismatched-key operations do not observe that boundary. Each probe now records `anchorAcId: null` with a `detail` line stating that no AC or REQ covers the SOPS-native property this probe observes, that this is vendor-conformance evidence for ADR-902's default vendor (sops+age), and that the slug's criterion-e reading is AMBER at every row until a manager-client probe that observes REQ-002 is added. Probes remain labelled `engine: sops+age` on the run record. Byte-equality remains a real byte-buffer compare on `--input-type binary --output-type binary` streams; the SHA-256 witnesses stay in `evidence.byteCompare` alongside the byte-length + `Buffer.compare === 0` assertion. `aggregate([])` and null-result normalisation report `detail: 'no checks ran'` exactly. Anatomy `assertEvidenceOrSkip` tightened to require one of the four 7d shapes or an honest skip. Slug reads AMBER on criterion e.

## 1.1.2

- Rewrites `REQ-002.description` to reference `TAC-901-security-secrets-management-manager-client` `responsibilities.get` and the sibling responsibilities on the same TAC rather than restate the `get(name)` signature verbatim; the literal remains owned by the delivering TAC.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (hardening pass, spec 2026-09-09 section 5.4.2)

- Adds `elicits[]` for `environmentSet` (string; the ordered environment list) and `uiOutcome` (enum: `integrate`, `admin-spa`, `none`) already described in prose on `REQ-007` and `REQ-010`. Promotes `REQ-010` to `must` priority (an apply-time choice is not a should) and names each option value explicitly on its description. Narrows `REQ-003` to code-side enforcement of the least-privilege slice, naming SOPS's inability to issue vendor-side per-process credentials and the supersede-via-ADR path for vendors that carry the property. Adds an explicit exception clause to `REQ-005` for the ephemeral `.env` reflection under `REQ-006`, constraining its location, `.gitignore` requirement, and file mode. Adds `deliveredBy` on every `must` requirement and `disposition: fixed` on every existing acceptance criterion. Names the `secretsProvider` capability on `REQ-002`, which already carries the vendor-agnostic-manager runtime clause. hardening pass (criteria a, b, c on the 2026-09-09 programme).

## 1.0.1 - 2026-09-06

Additive minor: declares `capabilities: ["secretsProvider"]` on `blueprint.json` so consumer blueprints can gate composition on an applied secrets-management surface via the capability mechanism. No REQ / US / TAC / ADR contribution changes; the `secretRef` opaque-string contract, the elicited-parameters shape, and the shipped secretsSource semantics are unchanged. First consumer at v1.0.1: `object-storage-s3` v1.0.0 declares `requiresAppliedCapabilities: {capabilities: ["secretsProvider"], allowSkipFlag: "allow-no-secrets-yet", refusalMessageId: "object-storage-s3-no-secrets"}` so `rcf define blueprint add object-storage-s3` on a project that has not applied security-secrets-management exits 3 with the stable message id on stderr; the override records a note on `source.notes` for later reconciliation.

Landed via infra round 5 (spec section 5.2, platform decision 6) folded into PR #157 per shelf ruling on the runner-gap find; same-PR minor pattern as round-4 auth minors.

## 1.0.0 - 2026-08-31

Initial release. `secretRef` opaque-string contract, elicited-parameters (secretsSource, environment mapping), scope-global ADR on `secretsSource`.
