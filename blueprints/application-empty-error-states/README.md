# Empty and error states blueprint (v1.0.0)

Vendor-neutral empty-and-error-states contract for an rcf-lite application. Ships eight named states, one contract per state: `not-found` (404), `forbidden` (403), `server-error` (500), `offline`, `permission-denied` (403 with a per-resource cause), `empty-list`, `no-search-results`, `error-boundary` (client-side render failure). Each state carries a machine-readable status, a distinct visual, a `role="region"` accessible name, one recovery-action shape from a closed enum, and a polite live-region wrapper for progress and reconnection announcements. Ships a Playwright probe pack under `probe-packs/application-empty-error-states.pack.mjs` whose eight checks each anchor one named state, refuse on the corresponding break switch, and fire against the sample-app fixture on the shelf gate.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-empty-error-states
```

Applies 19 contributions (5 REQs, 8 USs, 3 TACs, 3 ADRs) cleanly on any fresh init project. No `requiresAppliedCapabilities`, no auth prerequisite, no elicited-only parameters that block the apply; the two elicits (`ADR-2302` stack-trace visibility and `ADR-2303` offline strategy) carry recommended defaults so the apply proceeds silently and the project can revisit the elicited answers later.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `suggestedCompanions: [logging, errorHandling]`, 19 contributions in the 23xx / 22xxx band |
| Doc set | `contributions/` | 5 REQs, 8 USs (8 runtime-observable ACs), 3 TACs, 3 ADRs |
| Probe pack | `probe-packs/application-empty-error-states.pack.mjs` | Eight surface-observable browser-verify checks, one per named state |
| Guide | `guide/application-empty-error-states.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed |
| Sample-app fixture | `packages/rcf-lite/test/fixtures/probe-pack-application-empty-error-states/` | Dependency-free Node HTTP server the pack is probed against on the shelf gate |

## The eight named states

| State | HTTP status | Recovery shape(s) | Announcement | Region wrapper |
|---|---|---|---|---|
| `not-found` | 404 | `parent-surface` + `search` | polite live-region | `[data-surface="not-found"]` |
| `forbidden` | 403 (no per-resource cause) | `request-access` | polite live-region | `[data-surface="forbidden"]` |
| `server-error` | 5xx | `retry` | polite live-region | `[data-surface="server-error"]` |
| `permission-denied` | 403 (class-level cause) | `request-access` | polite live-region | `[data-surface="permission-denied"]` |
| `offline` | (no HTTP; `navigator.onLine` false) | `retry` (implicit on reconnection) | polite live-region for reconnection | `[data-surface="offline"]` |
| `empty-list` | 200 (empty array on a listing endpoint) | `create` | polite live-region | `[data-surface="empty-list"]` |
| `no-search-results` | 200 (empty array on a search endpoint) | `clear-filters` | polite live-region | `[data-surface="no-search-results"]` |
| `error-boundary` | (no HTTP; caught client-side render exception) | `retry` | `role="alert"` (assertive) | `[data-surface="error-boundary"]` |

The eight-state enum is closed at v1.0.0. A ninth state is a v1.1.0 minor bump; a state removed or renamed is a v2.0.0 major.

## Recovery-action router

The closed set of recovery shapes: `parent-surface`, `search`, `request-access`, `retry`, `create`, `clear-filters`, `no-recovery`. Every rendered state carries at least one. The router refuses to render a state without a legitimate shape; a bare state region without any recovery is a build defect the pack catches.

## Offline strategy

`ADR-2303` commits to `write-buffer` as the default (IndexedDB, idempotency token per write, monotonic sequence, flush in sequence on reconnection with server-side dedupe). Elicited alternatives: `read-only-banner` and `refuse-writes`. All three shapes render the offline region and the polite reconnection announcement per REQ-005; the difference is only whether writes queue, disable or refuse.

## Elicited parameters

- **States in scope for v1.** Default: all eight. A project that has not yet shipped offline mode can elicit a reduced set; the pack skips checks whose state is out of scope on that project.
- **Recovery-action targets per state.** Default: the router's built-ins (parent-surface, search, request-access, retry, create, clear-filters). Projects override the endpoint paths and callbacks per FBS.
- **Stack-trace visibility in production.** Default: true (hidden). `ADR-2302` elicits an override for staging.
- **Offline strategy.** Default: `write-buffer`. `ADR-2303` elicits `read-only-banner` or `refuse-writes`.

## The one runtime gate

`probe-packs/application-empty-error-states.pack.mjs` ships eight checks the `rcf verify browser` runner invokes on any FBS whose surface binds `TAC-2301-application-empty-error-states-state-machine` or whose nav model routes name an operator-configured error-shell path. Each check drives the real Playwright browser the runner provisions, reads the accessibility tree and the DOM, and returns a verdict. URLs are composed by the `withUrl(runtimeUrl, path)` helper per the round 3 T-3 fix train; no bare string concatenation.

## Quality bar

WCAG 2.2 AA on every state region: 3.3.1 Error Identification (every error state names the error class in the heading), 2.4.6 Headings and Labels (every region carries a heading and an accessible name), 3.2.4 Consistent Identification (every recovery control carries the same `data-recovery` attribute across states), 4.1.3 Status Messages (every progress and reconnection announcement fires through the polite live-region wrapper), 3.3.3 Error Suggestion (the recovery-action prose names the next action, not just the error). HTTP semantics per RFC 9110 for the status-code contract (ADR-2301). ARIA APG alert pattern on `error-boundary`. `standardsTrace` on the blueprint is empty (this is a general-enterprise-practice blueprint); each ADR contribution carries `standardsTraceClause` naming the clause it implements.

The 500 surface is a CSP-shape enforcement. `AC-22103-1` reads the rendered surface, tokenises against a bundled sensitive-pattern list (backtrace-frame prefix, source-path shape, environment-variable key shape, framework-internal frame prefix, `process.env.NAME` reference), and refuses when any pattern matches.

## Known mechanism-reach gaps

Runtime-observable ACs the pack does NOT bind directly (checklist section 6.g), listed individually per AC id:

- **AC-22101-1 keyboard-focus-on-recovery.** The pack asserts the parent-surface link and the search entry exist and carry the correct `data-recovery` attribute; it does NOT additionally probe that keyboard focus lands on the recovery control on state entry. A v1.1.0 minor bump can drive the browser's accessibility tree and assert focus placement.
- **AC-22102-1 request-access transport round-trip.** The pack asserts the `[data-action="request-access"]` control exists; it does NOT additionally exercise the POST round-trip and assert the applied notification centre receives the submission. A v1.1.0 minor bump can invoke the click path and inspect the network request log.
- **AC-22103-1 non-production staging branch.** The pack drives the production branch (`?break=stack-trace` is the negative run for the production posture); the elicited staging-visible branch (`ADR-2302`) is present on the fixture through the same break switch but the pack does not additionally probe the staging-legitimate render.
- **AC-22104-1 cause-string vocabulary registry.** The pack asserts the class-level cause is present and refuses when a resource-id shape appears; it does NOT additionally cross-check the cause string against a project-side vocabulary registry. A v1.1.0 minor bump can read a project-declared vocabulary file and diff.
- **AC-22105-1 write-buffer flush order.** The pack asserts a synthetic buffered write is enumerable on `window.__offlineBuffer` and that the polite reconnection announcement fires; it does NOT additionally probe that a multi-entry buffer flushes in sequence with per-entry retry counters. A v1.1.0 minor bump can seed a multi-entry buffer and drive the flush loop.
- **AC-22106-1 empty-list distinction from loading.** The pack asserts the `[data-visual="empty-list"]` wrapper is present; it does NOT additionally probe that the wrapper is distinct from `[data-visual="loading"]` and `[data-visual="loaded"]` on the same route. A v1.1.0 minor bump can drive the loading branch and diff the wrapper attributes.
- **AC-22107-1 clear-filters callback shape.** The pack asserts the `[data-recovery="clear-filters"]` control exists and echoes the query; it does NOT additionally exercise the callback and assert the search parameters are removed from the URL. A v1.1.0 minor bump can drive the click path and inspect the resulting URL.
- **AC-22108-1 boundary retry re-mounts the component.** The pack asserts the `role="alert"` region and the retry control exist; it does NOT additionally probe that the retry re-mounts the crashed component subtree. A v1.1.0 minor bump can drive the click path and inspect the DOM diff.

## Companions

`suggestedCompanions` declares `logging` (every rendered error state writes one request-scoped log line with the correlation identifier the applied logger factory returns) and `errorHandling` (the error-boundary state constructs an internal error record from the caught exception through the applied error-handling factory). Neither is required to apply the blueprint; a project without a logging companion still ships every state region, it just does not emit a per-state log line.

## Consumers

- `application-forms-wizard` (T-3 of this round) consumes the empty-list state as its "no in-progress forms" surface; the wizard's empty branch delegates to this blueprint's TAC-2301 state machine.
- `application-account-settings` (T-4 of this round) consumes the access-denied path (forbidden and permission-denied) for its scope-gated settings sections and the empty-list state for its empty-history surfaces.

## Composition with application-spa

`application-spa` REQ-006 ships empty, loading, error, banner and alert components as part of its component library. This blueprint composes with SPA; the topic-ownership boundary lives in `docs/topics.md`. SPA owns the tab-title convention and the state-visual tokens; this sibling owns the state list, the recovery-action router and the runtime enforcement pack.
