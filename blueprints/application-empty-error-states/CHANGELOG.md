# application-empty-error-states CHANGELOG

## 1.2.4 - 2026-09-11

- Shared `aggregate()` no longer promotes warn rows to pass: any row with verdict warn (including honest de-claim rows) lifts the aggregate to warn; a probe whose rows are all warn aggregates to warn, not pass. Shared teardown propagates a SIGKILL failure through the returned kill() promise instead of swallowing it. Overclaiming rows across not-found (AC-22101-1), forbidden + server-error (AC-22102-1, AC-22103-1), permission-denied (AC-22104-1), offline buffer (AC-22105-1), empty-list + no-search (AC-22106-1, AC-22107-1) and error-boundary (AC-22108-1) are de-claimed to `conformanceOnly:true` with `verdict:'warn'` and a `limitation` field naming the anchored AC and the varied-input or browser-only clause that lives outside the Node HTTP probe. The server-observable halves (403/500 status, region roles, recovery controls, buffer lifecycle) still drive the row-observation and flip verdict to fail under the shipped fixture break switches. Anatomy test extended with a negative-variant assertion that the shipped break switches drive the affected probe aggregates to fail.

## 1.2.3 - 2026-09-11

- Buffer lifecycle for AC-22105-1 is now observed server-side. Fixture ships three new endpoints keyed by `x-principal-id` header (or `?principal-id=` query): `POST /probe/offline/state` flips online/offline, `POST /probe/offline/buffer` enqueues with an idempotency-per-token contract (duplicate token returns `deduped:true` and count stays), `POST /probe/offline/reconnect` drains the buffer and returns the flushed count; `GET` variants return current state. The `/probe/offline` HTML surface now renders `data-buffer-state`, `data-buffer-count`, `data-flushed-count` and a banner reflecting the current transport state. permission-denied-and-offline probe drives a fresh principalId through the full lifecycle (flip offline, enqueue distinct tokens, verify count grew, POST duplicate token and verify dedupe, reconnect and verify drain+delivered) instead of de-claiming as `notObservableHere`. Anatomy test extended to enumerate the shipped AC/REQ id set from `contributions/user-stories/*.json` and refuse any row whose anchor is not in it, and to accept the conformance-only row shape.

## 1.2.2 - 2026-09-11

- forbidden-and-server-error probes now compare positive state-copy tokens rendered in the response HTML against the AC-22102-1 (forbidden) and AC-22103-1 (server-error) contracts, replacing the fixture-specific data-leak marker key that did not observe the state copy. permission-denied-and-offline offline row de-claimed to notObservableHere for AC-22105-1 (buffer lifecycle intercepted-write, buffered, reconnect, flushed sequence is client-driven and only observable in a browser). error-boundary-alert reanchored to AC-22108-1 active crash state; the standby-absence row that lacked a positive anchor is removed. Positive-anchor-on-absence broken-variant rows removed. Rule 10 applied to every row detail. Anatomy test extended to accept notObservableHere row shape. Register cleanup.


## 1.2.1 - 2026-09-11

- Added a criterion-e probe pack (`contributions/probes/`) covering 5 properties the fixture engine at `packages/rcf-lite/test/fixtures/probe-pack-application-empty-error-states/server.js` answers: `not-found-and-recovery`, `forbidden-and-server-error`, `permission-denied-and-offline`, `empty-list-and-no-search`, `error-boundary-alert`. Every response now carries an `x-fixture-request-id` header; probes record the id, the HTTP status and a body excerpt as positive evidence per rule 7d. Fixture README declares every env var the pack reads. Anatomy test at `packages/rcf-lite/test/blueprint/application-empty-error-states-anatomy.test.js` pins the new pack files and asserts each result carries one of the four 7d evidence shapes.


## 1.2.0 (2026-09-10)

### Added

- Elicits `stack-trace-visible` (default `production-hide`) and `offline-strategy` (default `write-buffer`) declared on blueprint.json; REQ-006 binds the three `stack-trace-visible` options and REQ-007 binds the three `offline-strategy` options with a runtime clause per value.
- Vendor citations on AC-22101-1 (RFC 9110 404), AC-22102-1 (RFC 9110 403) and AC-22103-1 (RFC 9110 500).

### Changed

- REQ-002 widened to the seven-value recovery-shape enum owned by `TAC-2302.notes` (parent-surface, search, request-access, retry, create, clear-filters, no-recovery) via ownerRef.
- REQ-004.deliveredBy retargeted to `TAC-2301.responsibilities.redactSensitivePatterns` (new responsibility).
- REQ-005.deliveredBy retargeted to `TAC-2303.interfaces.bufferWrite`.
- Probe checks AC-22102-1, AC-22103-1, AC-22104-1 and AC-22108-1 reworked to positively assert `data-safe-response` / `data-safe-error` / `data-cause-class` / `data-error-class` markers plus `data-request-id` / `data-correlation-id`; fixture updated to emit the markers.

## 1.1.1 (register-sweep patch, 2026-09-10)

- Register: neutral wording in shipped prose (no capability change).

## 1.1.0 (2026-09-10, hardening pass)

### Added

- Failure-path acceptance criteria on US-22102 (failed request-access POST, no per-resource detail), US-22103 (retry failure, no stack trace leak), US-22105 (ordered flush with stable tokens, per-write failure with retry counter and banner, idempotency of retried operations), US-22106 (no-recovery notice for a state without configured recovery), US-22107 (query verbatim rendering, failed clear-filters reload), US-22108 (role=alert, hard-refresh recommendation after 3 recovery retries), US-22101 (gone vs never-existed distinction gated on the applied data provider), US-22104 (class-only naming, no per-resource detail). Closes review findings F-1, F-2 and F-3.
- Vendor citations on the WCAG status-messages criteria and the ARIA APG alert-pattern criteria (verified 2026-09-10).

### Changed

- Every REQ now carries a deliveredBy link into TAC-2301 (state-machine), TAC-2302 (recovery-router) or TAC-2303 (offline-buffer).
- Every AC on every user story now carries an explicit disposition (fixed or template).

## 1.0.0 (visual round, spec 2026-09-06)

- First ratified version of the shelf's empty-and-error-states blueprint. Five REQs (state catalogue with eight named states, recovery-action contract, announcement contract with role region and aria-live polite, least-privilege 5xx and 403 posture, offline state with write-buffer and reconnection semantics), eight USs 22101-22108 binding one runtime-observable AC per named state, three TACs 2301-2303 (state-machine, recovery-action router, offline write-buffer), three ADRs 2301-2303 (HTTP status contract per RFC 9110 as recommendedDefault, stack-trace visibility elicited with recommendedDefault true, offline strategy across write-buffer read-only-banner and refuse-writes elicited). No new global topics.
- Ships `probe-packs/application-empty-error-states.pack.mjs`: eight surface-observable browser-verify checks anchored one per named state (`AC-22101-1` not-found, `AC-22102-1` forbidden, `AC-22103-1` server-error, `AC-22104-1` permission-denied, `AC-22105-1` offline, `AC-22106-1` empty-list, `AC-22107-1` no-search-results, `AC-22108-1` error-boundary). Every URL is composed by the `withUrl(runtimeUrl, path)` helper per the round 3 fix train; no bare string concatenation. The pack-level `appliesTo` predicate references BOTH `tacIds` (TAC-2301) AND `route` (the operator-configured error-shell path glob).
- Ships a dependency-free sample-app fixture at `packages/rcf-lite/test/fixtures/probe-pack-application-empty-error-states/` with a Node HTTP server realising all eight states honestly under `/probe/<name>` and break switches (`?break=stack-trace`, `?break=leak-id`, `?break=no-recovery`, `?break=no-live-region`) driving the negative runs from a single boot. The fixture ships its own README naming PORT, every `?state=`, every `?break=`, the manual boot line and the two-line gate-reviewer boot.
- Declares `suggestedCompanions` `logging` (every rendered error state writes one request-scoped log line with the correlation identifier) and `errorHandling` (the error-boundary state constructs an internal error record from the caught exception). Does NOT declare `providesRoles` (leaf blueprint per spec; loader refuses an empty `providesRoles` array when set, so the leaf-blueprint intent is expressed by omitting the field). Does NOT declare `capabilities` and does NOT declare `requiresAppliedCapabilities` (no auth required).
- Sixth shipped consumer of the earlier release probe-pack runner extension. `application-forms-wizard` consumes this blueprint for its "no in-progress forms" empty state; `application-account-settings` consumes this blueprint for its access-denied and empty-history states.
