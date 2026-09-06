# security-secrets-management changelog

## 1.0.1 - 2026-09-06

Additive minor: declares `capabilities: ["secretsProvider"]` on `blueprint.json` so consumer blueprints can gate composition on an applied secrets-management surface via the T-5 capability mechanism. No REQ / US / TAC / ADR contribution changes; the `secretRef` opaque-string contract, the elicited-parameters shape, and the shipped secretsSource semantics are unchanged. First consumer at v1.0.1: `object-storage-s3` v1.0.0 declares `requiresAppliedCapabilities: {capabilities: ["secretsProvider"], allowSkipFlag: "allow-no-secrets-yet", refusalMessageId: "object-storage-s3-no-secrets"}` so `rcf define blueprint add object-storage-s3` on a project that has not applied security-secrets-management exits 3 with the stable message id on stderr; the override records a note on `source.notes` for later reconciliation.

Landed via infra round 5 T-2 (spec section 5.2, Baz decision 6) folded into PR #157 per HQ ruling on the runner-gap find; same-PR minor pattern as round-4 T-4 auth minors.

## 1.0.0 - 2026-08-31

Initial release. `secretRef` opaque-string contract, elicited-parameters (secretsSource, environment mapping), scope-global ADR on `secretsSource`.
