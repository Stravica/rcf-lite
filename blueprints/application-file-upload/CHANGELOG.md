# application-file-upload CHANGELOG

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-10, hardening pass)

### Added

- Failure-path acceptance criteria on US-23101 (MIME and size cap refusal), US-23102 (byte-weighted aggregate progress, tick-cadence cap), US-23103 (per-file failure with focus on retry), US-23104 (tus prerequisite apply refusal with TUS_PREREQUISITE_MISSING, Upload-Offset semantics on retry, malformed Upload-Offset handling), US-23105 (successful removal with polite announce, failed DELETE with data-remove-outcome=failed, completion-once idempotency), US-23106 (Upload-Offset regression abort with UPLOAD_OFFSET_REGRESSION), US-23107 (prefers-reduced-motion static-text fallback). Closes review findings F-1 and F-2.
- Vendor citations on the tus.io resumable-upload protocol AC and the WCAG animation-from-interactions AC (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2401 (input), TAC-2402 (transport) or TAC-2403 (progress-announcer).
- Every AC on every user story now carries an explicit disposition (fixed or template); ACs that observe removeFile carry ownerRef into TAC-2402.

## 1.0.0 (visual round, spec 2026-09-06)

- First ratified version of the shelf's file-upload blueprint. Five REQs (input contract with a labelled file input plus drop-zone plus keyboard alternative per WCAG 2.5.7, progress contract with per-file percent and aggregate percent and polite live-region tick, refusal contract with MIME and size and virus-scan gates and aria-describedby error binding and focus-to-retry, transport contract chunked-and-resumable with multipart POST default and tus.io elicited alternative, completion contract with assertive-slot success announcement per WCAG 4.1.3 and per-file remove and retry), seven USs 23101-23107 binding one runtime-observable AC per REQ plus two cross-cutting cases (network-interruption resumption AC-23106-1, background-tab progress AC-23107-1), three TACs 2401-2403 (upload input surface, upload transport contract, upload progress announcer), three ADRs 2401-2403 (transport branch with multipart recommendedDefault true and tus and vendor-sdk elicited, accepted MIME set and per-file size cap elicited, virus-scan integration via a capability-plus-elicit). No new global topics.
- Ships `probe-packs/application-file-upload.pack.mjs`: four surface-observable browser-verify checks anchored one per contract (`AC-23101-1` input surface, `AC-23102-1` progress announcer, `AC-23103-1` refusal contract, `AC-23104-1` chunked transport). Every URL is composed by the `withUrl(runtimeUrl, path)` helper per the round 3 fix train; no bare string concatenation. The pack-level `appliesTo` predicate references BOTH `tacIds` (TAC-2401) AND `route` (the operator-configured upload path glob).
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/` with a Node HTTP server realising both transport branches honestly (`?transport=multipart` default, `?transport=tus` elicited alternative) and break switches (`?break=no-input`, `?break=no-live-region`, `?break=send-refused`, `?break=no-chunks`) driving the negative runs from a single boot. The fixture ships its own README naming PORT, every `?transport=`, every `?seed=`, every `?break=`, the manual boot line and the two-line gate-reviewer boot.
- Declares `suggestedCompanions` `logging` (every refused upload writes one request-scoped log line with the closed refusal reason and the correlation identifier) and `errorHandling` (refusals and transport-layer failures construct an internal error record through the applied error-handling factory). Does NOT declare `providesRoles` (leaf blueprint per spec; loader refuses an empty `providesRoles` array when set, so the leaf-blueprint intent is expressed by omitting the field). Does NOT declare `capabilities` and does NOT declare `requiresAppliedCapabilities` (no auth required).
- Seventh shipped consumer of the earlier release probe-pack runner extension.
