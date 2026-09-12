# application-file-upload CHANGELOG

## 1.2.7 - 2026-09-11

- per-file-progressbar now emits a notObservableHere row for AC-23102-2 alongside the existing conformanceOnly server row: the AC's when/then names the aggregate announcement text emitted through the polite live region, and that half is a browser DOM observation the server-side probe pack cannot make. The AC is now represented on the shelf as (i) a conformanceOnly counting row observing the byte-weighted aggregate from the server's uploaded-bytes accounting and (ii) a notObservableHere row carrying the AC id and the browser-observable-half reason.
- Anatomy test pin bumped to 1.2.7.

## 1.2.6 - 2026-09-11

- Corrects the stale chunked-transport-endpoints probe header: the AC-23104-1 row drives one declared 16 KiB file split into four sequential 4 KiB chunks against one sessionId, and the header now says so rather than "three real chunk POSTs with distinct byte payloads"; the code and evidence were already the four-equal-chunk shape.
- Anatomy test pin bumped to 1.2.6.


## 1.2.5 - 2026-09-11

- Adds a contributions/probes pack meeting rule 7d.
- Probes: upload-surface-shape, per-file-progressbar, chunked-transport-endpoints, assertive-completion-slot.
- Chunked-transport row for AC-23104-1 is conformanceOnly: the probe observes multipart chunk-count bytes server-side; the DOM half ([data-transport], [data-chunks-uploaded]) and the browser-network half (PATCH requests carrying Upload-Offset) are notObservableHere. AC-23104-3 remains a positive row on the tus branch (post-409 state read + resume PATCH from the acknowledged offset).
- Per-file aggregate row for AC-23102-2 is conformanceOnly with limitation naming that the polite live region's rendered aggregate announcement text is browser-only; the row drives three files of 1/2/5 MiB through /upload/chunk and shows byte-weighted percent differs materially from plain per-file average at the intermediate steps (12.5% vs 33.33% after file 1; 37.5% vs 66.67% after file 2) and converges to 100% at completion.
- Enter-press / focus surface (AC-23101-1) is conformanceOnly with limitation naming that the button-Enter-open-picker interaction is browser-only.
- Aggregate completion is derived from request-body bytes.
- Anatomy test pin bumped to 1.2.5.


## 1.2.0 (2026-09-10)

### Added

- Six elicits (`accepted-set`, `size-cap`, `tick-interval`, `concurrency`, `polling`, `chunked-transport`) declared on blueprint.json; REQ-006 binds one runtime clause per apply-time answer family.
- `virusScan` declared on `blueprint.json.capabilities` and REQ-007 binds the input TAC's refusal path to the applied verifier.
- Vendor citations on AC-23104-1, AC-23104-3 and AC-23104-4 (tus.io PATCH); AC-23104-4 names the response header (not body).

### Changed

- REQ-002 drops the "at least every 10 percent" clause and keeps the 2-second announcement cap owned by `TAC-2403.interfaces.announcementInterval` (user-observable); names `TAC-2403.interfaces.tickInterval` (250 ms internal poll, not user-observable); ADR-2402 references both via ownerRef.
- REQ-002.deliveredBy retargeted to `TAC-2403.interfaces.tick`.
- REQ-003.deliveredBy retargeted to `TAC-2401.interfaces.renderRefusal`.
- REQ-004.deliveredBy retargeted to `TAC-2402.interfaces.uploadFile`.
- `TAC-2402.interfaces.removeFile` declared with DELETE failure semantics; REQ-005 targets it.
- Probe check AC-23103-1 reworked to positively assert a per-file `[data-refusal-receipt]` keyed by file id; fixture updated to emit the marker alongside `data-file-id`.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-10)

### Added

- Failure-path acceptance criteria added on US-23101 (MIME and size cap refusal), US-23102 (byte-weighted aggregate progress, tick-cadence cap), US-23103 (per-file failure with focus on retry), US-23104 (tus prerequisite apply refusal with TUS_PREREQUISITE_MISSING, Upload-Offset semantics on retry, malformed Upload-Offset handling), US-23105 (successful removal with polite announce, failed DELETE with data-remove-outcome=failed, completion-once idempotency), US-23106 (Upload-Offset regression abort with UPLOAD_OFFSET_REGRESSION), US-23107 (prefers-reduced-motion static-text fallback), so applying projects have explicit failure-path acceptance criteria on each story.
- Vendor citations on the tus.io resumable-upload protocol AC and the WCAG animation-from-interactions AC (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2401 (input), TAC-2402 (transport) or TAC-2403 (progress-announcer).
- Every AC on every user story now carries an explicit disposition (fixed or template); ACs that observe removeFile carry ownerRef into TAC-2402.

## 1.0.0 (2026-09-06)

- Initial shipped version of the shelf's file-upload blueprint. Five REQs (input contract with a labelled file input plus drop-zone plus keyboard alternative per WCAG 2.5.7, progress contract with per-file percent and aggregate percent and polite live-region tick, refusal contract with MIME and size and virus-scan gates and aria-describedby error binding and focus-to-retry, transport contract chunked-and-resumable with multipart POST default and tus.io elicited alternative, completion contract with assertive-slot success announcement per WCAG 4.1.3 and per-file remove and retry), seven USs 23101-23107 binding one runtime-observable AC per REQ plus two cross-cutting cases (network-interruption resumption AC-23106-1, background-tab progress AC-23107-1), three TACs 2401-2403 (upload input surface, upload transport contract, upload progress announcer), three ADRs 2401-2403 (transport branch with multipart recommendedDefault true and tus and vendor-sdk elicited, accepted MIME set and per-file size cap elicited, virus-scan integration via a capability-plus-elicit). No new global topics.
- Ships `probe-packs/application-file-upload.pack.mjs`: four surface-observable browser-verify checks anchored one per contract (`AC-23101-1` input surface, `AC-23102-1` progress announcer, `AC-23103-1` refusal contract, `AC-23104-1` chunked transport). Every URL is composed by the `withUrl(runtimeUrl, path)` helper; no bare string concatenation. The pack-level `appliesTo` predicate references BOTH `tacIds` (TAC-2401) AND `route` (the operator-configured upload path glob).
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/` with a Node HTTP server realising both transport branches honestly (`?transport=multipart` default, `?transport=tus` elicited alternative) and break switches (`?break=no-input`, `?break=no-live-region`, `?break=send-refused`, `?break=no-chunks`) driving the negative runs from a single boot. The fixture ships its own README naming PORT, every `?transport=`, every `?seed=`, every `?break=`, the manual boot line and the two-line manual boot.
- Declares `suggestedCompanions` `logging` (every refused upload writes one request-scoped log line with the closed refusal reason and the correlation identifier) and `errorHandling` (refusals and transport-layer failures construct an internal error record through the applied error-handling factory). Does NOT declare `providesRoles` (leaf blueprint per spec; loader refuses an empty `providesRoles` array when set, so the leaf-blueprint intent is expressed by omitting the field). Does NOT declare `capabilities` and does NOT declare `requiresAppliedCapabilities` (no auth required).
- Seventh shipped consumer of the earlier release probe-pack runner extension.
