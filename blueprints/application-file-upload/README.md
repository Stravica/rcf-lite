# File upload blueprint (v1.0.0)

Vendor-neutral file-upload contract for an rcf-lite application. Ships one upload surface with three input affordances (a labelled `<input type="file">`, a `[data-drop-zone]` region and a keyboard-focusable `[data-open-picker]` button per WCAG 2.5.7), a chunked-and-resumable transport with a multipart POST default and a tus.io elicited alternative, a refusal contract (MIME, size cap, virus-scan) that binds errors via `aria-describedby` and refuses to send refused bytes to the server, a progress announcer that emits a polite live-region tick in the closed format `"<uploaded> of <total> files, <PP> percent"` and an assertive-slot completion announcement per WCAG 4.1.3, and per-file remove and retry controls. Ships a Playwright probe pack under `probe-packs/application-file-upload.pack.mjs` whose four checks each anchor one contract and refuse on the corresponding break switch on the shipped sample-app fixture.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-file-upload
```

Applies 18 contributions (5 REQs, 7 USs, 3 TACs, 3 ADRs) cleanly on any fresh init project. No `requiresAppliedCapabilities`, no auth prerequisite. The three ADR elicits (`ADR-2401` transport branch, `ADR-2402` accepted MIME set and per-file size cap, `ADR-2403` virus-scan verifier) carry the multipart default with `recommendedDefault: true` on the transport branch; the other two elicits (accepted set and virus-scan) have no shelf default (see the elicits below).

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `suggestedCompanions: [logging, errorHandling]`, 18 contributions in the 24xx / 23xxx band |
| Doc set | `contributions/` | 5 REQs, 7 USs (7 runtime-observable ACs), 3 TACs, 3 ADRs |
| Probe pack | `probe-packs/application-file-upload.pack.mjs` | Four surface-observable browser-verify checks, one per contract |
| Guide | `guide/application-file-upload.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed |
| Sample-app fixture | `packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/` | Dependency-free Node HTTP server the pack is probed against on the shelf gate |

## The four contracts

| Contract | REQ | AC on the pack | Region wrapper | Announcement |
|---|---|---|---|---|
| Input surface | REQ-001 | `AC-23101-1` | `[data-surface="file-upload"]` | (n/a; keyboard reach + accessible name) |
| Progress announcer | REQ-002 | `AC-23102-1` | `[data-live-region="polite"]` inside the region | polite `aria-live="polite"` |
| Refusal contract | REQ-003 | `AC-23103-1` | `[data-file-row][data-refused="true"]` | `aria-describedby` error binding |
| Chunked transport | REQ-004 | `AC-23104-1` | `[data-transport]` on the region; `[data-chunks-uploaded]` on each row | (n/a; observed on the wire) |
| Completion | REQ-005 | asserted by AC-23105-1 (see below) | `[data-assertive-slot]` | `aria-live="assertive"` |

The pack ships four checks (`AC-23101-1`, `AC-23102-1`, `AC-23103-1`, `AC-23104-1`) which is the minimum honest set per spec section 5.2; the completion contract (`AC-23105-1`) and the cross-cutting cases (`AC-23106-1` network interruption resumption, `AC-23107-1` background-tab progress) are runtime-observable ACs bound only through the fixture and the anatomy test. Every gap is enumerated below and is a candidate for a v1.1.0 minor bump extending the pack.

## The four fixture states

Every file row on the fixture cycles through the closed state set `idle` -> `uploading` -> `complete` (honest branch) or `idle` -> `refused` (refusal branch). The state slug rides `[data-file-state]` on the row. The four slugs appear identically across the fixture README, this README, the guide, the pack `checks[]` descriptions and `docs/topics.md`.

## The two transport slugs

`multipart` is the recommended default per ADR-2401; `tus` is the elicited alternative (tus.io 1.0.0). The two slugs appear identically across the fixture README, this README, the guide, the pack `checks[]` descriptions and `docs/topics.md`. The third elicited alternative (`vendor-sdk` for S3, R2, Cloudinary) is documented in ADR-2401 but is not exercised by the shipped fixture; a project on a vendor SDK adapts the pack to run against a fixture that mocks the vendor's completion callback.

## Elicited parameters

- **Transport branch (ADR-2401).** Default: `multipart` (recommendedDefault true). Elicited alternatives: `tus`, `vendor-sdk`.
- **Accepted MIME set (ADR-2402).** No default. Every project elicits its own list of IANA media types. The input TAC refuses every file until this is elicited (the safe floor).
- **Per-file size cap in bytes (ADR-2402).** No default. Every project elicits its own cap. The input TAC refuses every file until this is elicited.
- **Concurrency cap** for the transport worker pool. Recommended default: 3. Projects with a slow-link posture elicit a lower cap.
- **Announcer polling interval in milliseconds.** Recommended default: 250. Backgrounded tabs continue to tick at the same interval per REQ-002 and AC-23107-1.
- **Virus-scan verifier (ADR-2403).** Capability-plus-elicit. Every project elicits the verifier or the explicit noop; there is no shelf default.

## The one runtime gate

`probe-packs/application-file-upload.pack.mjs` ships four checks the `rcf verify browser` runner invokes on any FBS whose surface binds `TAC-2401-application-file-upload-input` or whose nav model routes name an operator-configured upload path. Each check drives the real Playwright browser the runner provisions, reads the accessibility tree and the DOM (and the request log for the refusal check and the tus branch), and returns a verdict. URLs are composed by the `withUrl(runtimeUrl, path)` helper; no bare string concatenation.

## Quality bar

WCAG 2.2 AA on every upload surface: 2.5.7 Dragging Movements (the drop-zone is never the only input path; the keyboard opener satisfies the alternative), 4.1.3 Status Messages (the polite live-region tick and the assertive-slot completion announcement fire through preseeded wrappers), 3.3.1 Error Identification (every refusal names the closed reason from `mime-refused`, `size-refused`, `virus-refused`), 1.3.1 Info and Relationships (every refusal binds the error message to its file row via `aria-describedby`), 3.3.3 Error Suggestion (every refused row exposes a keyboard-reachable retry control and the guide names the correction). ARIA APG button pattern on the retry control; ARIA APG status pattern on the polite tick. `standardsTrace` on the blueprint is empty (this is a general-enterprise-practice blueprint); each ADR contribution carries `standardsTraceClause` naming the clause or vendor spec it implements.

The refusal contract is a real refusal: the pack asserts the refused filename never appears on `window.__uploadRequestLog`, and the `?break=send-refused` fixture switch is the only path that lets refused bytes reach the server.

## Known mechanism-reach gaps

Runtime-observable ACs the pack does NOT bind directly (checklist section 6.g), listed individually per AC id:

- **AC-23101-1 drop-zone drop event round-trip.** The pack asserts the `[data-drop-zone]` region exists and that the keyboard opener focuses the file input on Enter; it does NOT additionally synthesise a drag event and drop a File onto the drop-zone (Playwright's DataTransfer synthesis is fragile across browsers). A v1.1.0 minor bump can drive a drop via `page.evaluate` and read that the file-list picked up the drop.
- **AC-23102-1 screen-reader adoption of the polite region.** The pack asserts the polite wrapper's textContent matches the closed format and advances monotonically; it does NOT additionally probe screen-reader adoption (that requires a real assistive tech in the loop). A v1.1.0 minor bump can attach an accessibility-tree observer via the browser's a11y snapshot.
- **AC-23103-1 aria-describedby resolves to a non-empty error message.** The pack asserts `aria-describedby` resolves and that the refused row exposes the closed `data-refusal-reason`; the error-text content check is a substring assertion (present and non-empty), not a full-message copy check. A v1.1.0 minor bump can pin the error message content per refusal reason.
- **AC-23104-1 network-interruption resume on the multipart branch.** The pack asserts `[data-chunks-uploaded]` exceeds one on both branches and that the tus branch records numeric `Upload-Offset` values on `window.__tusPatchOffsets`; it does NOT additionally probe a mid-upload interruption on the multipart branch (that requires a request-blocking driver). A v1.1.0 minor bump can drive the `?interrupt=1` + `?resume=1` seams the fixture already exposes via AC-23106-1.
- **AC-23105-1 assertive-slot exclusive fire.** The pack does NOT bind this AC directly; the anatomy test drives the fixture and reads the assertive slot's textContent. A v1.1.0 minor bump can promote the check into the pack, driving an upload set to completion and reading the assertive wrapper.
- **AC-23106-1 network interruption resumption.** The pack does NOT bind this AC directly. The fixture exposes `?interrupt=1` and `?resume=1` and the anatomy test walks the resume path; a v1.1.0 minor bump promotes the check.
- **AC-23107-1 background-tab tick continuity.** The pack does NOT bind this AC directly. The fixture exposes `?background=1` and the anatomy test synthesises a `visibilitychange` event; a v1.1.0 minor bump promotes the check.

## Companions

`suggestedCompanions` declares `logging` (every refused upload writes one request-scoped log line with the closed refusal reason and the correlation identifier the applied logger factory returns) and `errorHandling` (refusals and transport-layer failures construct an internal error record through the applied error-handling factory so the aria-describedby error message renders a consistent internal representation). Neither is required to apply the blueprint; a project without a logging companion still ships the refusal contract, it just does not emit a per-refusal log line.

## Consumers

The round-4 spec's CSV-import candidate would consume this blueprint's transport and refusal contracts; that candidate is not in this round. A downstream `application-forms-wizard` may wire a per-step file-upload field to this blueprint's input TAC.

## Composition with application-spa

`application-spa` REQ-006 ships upload, progress and error components as part of its component library. This blueprint composes with SPA; the topic-ownership boundary lives in `docs/topics.md`. SPA owns the visual tokens for the upload region; this sibling owns the input affordances, the transport contract, the refusal contract and the runtime enforcement pack.
