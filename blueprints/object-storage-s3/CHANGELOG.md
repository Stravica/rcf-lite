# object-storage-s3 changelog

## 1.0.0 - 2026-09-06

Initial release. Contract for S3-shape object storage on any S3-compatible endpoint (Cloudflare R2 first, MinIO for local dev, AWS S3, Backblaze B2, Wasabi, self-hosted). Accessed through a store facade that is the sole reader of the S3 client (`@aws-sdk/client-s3` on Node targets or `aws4fetch` on Workers targets). Landed via the infra round 5 spec (ratified 2026-09-06) as track T-2.

- 21 contributions: 6 REQs on facade sole-reader / put-get-delete-list / presigned URL / multipart / lifecycle events / credential-pair discipline; 8 USs at 28101-28108; 3 TACs (2901 facade, 2902 multipart uploader, 2903 event sink); 4 ADRs (2901 adapter elicited between AWS SDK and aws4fetch, 2902 presigned TTL default 15 minutes floor 1 minute, 2903 multipart threshold default 8 MiB, 2904 objectStorageContract with scope global).
- Six Node-only probes under `contributions/probes/` proven against a live MinIO container: `facade-round-trip`, `put-get-round-trip`, `presigned-url`, `multipart-upload`, `event-secrecy`, and the accountBound `r2-real-account-smoke`. The R2 smoke records `accountBoundSkipped: true` when `CI_HAS_CLOUDFLARE_ACCOUNT` is unset per spec section 3.5.
- T-2 slice of the shared sample-app fixture at `packages/rcf-lite/test/fixtures/infra-s3-and-queue/` boots MinIO via docker compose, exposes the facade over `@aws-sdk/client-s3`, ships a security-secrets-management shim realising the `secretRef` opaque-string contract, and hosts six induced-failure switches for the negative-run paths.
- Declares `capabilities: ["objectStorage"]`, `suggestedCompanions: [{role: "logging"}, {role: "errorHandling"}]`, `providesRoles` absent, `requiresAppliedCapabilities` absent.
- Contributes ADR-2904 as `scope: global` on new topic `objectStorageContract`. Future non-S3-shape siblings (`object-storage-native-gcs`, `object-storage-native-azure`, reserved slugs) conflict here by design.
- Refuses composition when `security-secrets-management` is not applied with exit 3 and stable message id `object-storage-s3-no-secrets` on stderr per REQ-006 and Baz decision 6. The `--allow-no-secrets-yet` override records a note on `source.notes` for later reconciliation.
- Every ADR contribution entry on `blueprint.json` carries a `standardsTraceClause` per section 8a.2 (per HQ mid-flight ruling after PR #154 gate).
