# Forms wizard blueprint (v1.0.0)

Vendor-neutral multi-step forms wizard contract for an rcf-lite application. Ships the GOV.UK Design System task-list pattern with a per-step completion state from the closed vocabulary (Cannot start yet, Not started, In progress, Completed), an ARIA progressbar wrapper on the task-list surface, the per-step validation timing rule (on-blur before first submit, on-change after first failure, full pass on submit), the top-of-page error-summary contract with skip links plus aria-invalid plus focus-to-heading on submit failure, the summary-review pattern with change-per-row and answer retention across an edit-and-save round-trip, and the save-and-return contract with a server-side draft table or a client-side local buffer with a sync tick. Ships a Playwright probe pack under `probe-packs/application-forms-wizard.pack.mjs` whose four checks each anchor one core contract, refuse on the corresponding break switch, and fire against the sample-app fixture on the shelf gate.

## Apply

```
rcf define blueprint add <path-to>/blueprints/application-forms-wizard
```

Applies 19 contributions (5 REQs, 8 USs, 3 TACs, 3 ADRs) cleanly on any fresh init project. No `requiresAppliedCapabilities`, no auth prerequisite. The three elicits (ADR-2501 navigation posture with recommendedDefault linear, ADR-2502 save-and-return transport with no recommendedDefault, ADR-2503 step-indicator shape with recommendedDefault task-list) either ship recommended defaults so the apply proceeds silently, or (ADR-2502 alone) require a project answer at apply time because the abandoned-draft loss class is genuinely per-project.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version 1.0.0, category `application`, `suggestedCompanions: [logging, errorHandling]`, 19 contributions in the 24xxx / 25xx band |
| Doc set | `contributions/` | 5 REQs, 8 USs (each carrying one runtime-observable AC), 3 TACs, 3 ADRs |
| Probe pack | `probe-packs/application-forms-wizard.pack.mjs` | Four surface-observable browser-verify checks, one per core contract |
| Guide | `guide/application-forms-wizard.md` | Operator-facing: when to reach, when not, mechanism-reach gaps |
| Coordination vocabulary | `docs/topics.md` | Shelf id band registry update; no new global topics claimed; cross-reference to `application-empty-error-states` for the no-in-progress empty case |
| Sample-app fixture | `packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/` | Dependency-free Node HTTP server the pack is probed against on the shelf gate |

## The task-list vocabulary

The four state strings are a closed enum at v1.0.0. Every task-list row exposes one. A fifth state (Skipped, Locked, or another word) is a v1.1.0 minor bump. Every README, guide, pack `checks[]` and `docs/topics.md` row names the same four strings.

| State | Meaning |
|---|---|
| `Cannot start yet` | A prerequisite step is unfinished. On linear navigation the row renders as a non-anchor span. |
| `Not started` | The step is reachable and has no answers. |
| `In progress` | The step has partial answers. |
| `Completed` | The step is fully valid. |

## The validation timing rule

REQ-002 commits to the three-mode timing rule from the GOV.UK Design System error-message pattern. The rule delegates every validation to the SPA blueprint's forms-engine TAC-205 so a project applying `application-spa` does not compose two overlapping engines; a project without `application-spa` supplies an engine of its own choice against TAC-2502's interfaces.

- On blur before the first submit on a step, each field validates on leaving focus.
- After the first submit failure on a field, subsequent input events on that field update the message on every change (so the operator sees the message clear as they correct it).
- On the next submit the engine rebuilds the error set from scratch.

## The error-summary contract

On submit refusal the step renders `[data-surface="error-summary"]` at the top of the page with a heading and one skip link per failed field; the skip link's `href` targets the field id. Every failed field carries `aria-invalid="true"` and `aria-describedby` pointing at its per-field error message. On failure focus moves to the summary heading. Per WCAG 2.2 SC 3.3.1 Error Identification and SC 3.3.3 Error Suggestion.

## The summary-review pattern

After every step is Completed the wizard renders `[data-surface="summary-review"]` with one `[data-summary-list-section]` per step. Each section carries a `<dl>` summary list; each row is a `[data-summary-row]` with a `<dt>` label, a `<dd>` value and a `[data-recovery="change"]` link back to the step. Editing on the target step and saving returns to the summary review with every other answer preserved verbatim. Per GOV.UK Design System summary-list pattern; per WCAG 2.2 SC 3.3.4 Error Prevention.

## The save-and-return contract

ADR-2502 commits to two transports without recommendedDefault. The server-side draft table (`POST /drafts` on advance, `GET /drafts` on entry) keys drafts by operator identifier; the client-side local buffer writes into `window.localStorage` under `draft:<wizard-slug>:<step-slug>` and renders `[data-sync-tick]` carrying an ISO-8601 timestamp on every write. A wizard applied without either transport is refused at build gate; ADR-2502 is a required elicit. Per WCAG 2.2 SC 3.3.7 Redundant Entry.

## The no-in-progress empty case

The in-progress-list surface delegates the zero-drafts case to the `application-empty-error-states` empty-list state (`[data-surface="empty-list"]` with a `[data-recovery="create"]` control). The wizard blueprint does not ship its own empty component; a project applying both blueprints reads the same surface from either blueprint.

## Elicited parameters

- **Step manifest.** The ordered list of steps, one entry per step with a slug, a title and a prerequisites array. Required at apply time; the shipped example manifest is three steps.
- **Save-and-return transport.** Default: none; ADR-2502 elicits `server-draft-table` or `client-local-buffer`. Required at apply time.
- **Which steps are optional.** A per-step flag defaulting to `required: true`. Optional steps do not gate the summary review.
- **Linear or free step navigation.** Default: linear. ADR-2501 elicits `free`.
- **Step indicator shape.** Default: task-list. ADR-2503 elicits `aria-progressbar-only` or `breadcrumb`.

## The one runtime gate

`probe-packs/application-forms-wizard.pack.mjs` ships four checks the `rcf verify browser` runner invokes on any FBS whose surface binds `TAC-2501-application-forms-wizard-task-list` or whose nav model routes name an operator-configured wizard path. Each check drives the real Playwright browser the runner provisions, reads the DOM and the accessibility tree, and returns a verdict. URLs are composed by the `withUrl(runtimeUrl, path)` helper; no bare string concatenation.

## Quality bar

WCAG 2.2 AA across every surface: 2.4.6 Headings and Labels (task-list state per row, summary heading on submit failure), 3.3.1 Error Identification (error-summary names every failed field), 3.3.3 Error Suggestion (per-field message names the correction, not just the fault), 3.3.4 Error Prevention (summary-review is reversible before submit), 3.3.7 Redundant Entry (drafts persist across sessions). GOV.UK Design System task-list pattern, summary-list pattern, complete-multiple-tasks pattern. `standardsTrace` on the blueprint is empty (this is a general-enterprise-practice blueprint); each ADR contribution carries `standardsTraceClause` naming the pattern or SC identifier it implements.

## Known mechanism-reach gaps

Runtime-observable ACs the pack does NOT bind directly (checklist section 6.g), listed individually per AC id:

- **AC-24102-1 validation timing.** The pack asserts the field-level message element and the aria-describedby binding via the fixture's refused branch; it does NOT additionally drive a real focus-and-blur sequence through the browser transport nor probe the transition from on-blur-only to on-change-after-failure. A v1.1.0 minor bump can drive keyboard events and diff the message text across events.
- **AC-24101-1 focus-move-to-task-list.** The pack asserts the task-list rows and the progressbar values; it does NOT additionally probe that focus lands on the task-list on route entry. A v1.1.0 minor bump can drive the accessibility tree and diff.
- **AC-24103-1 tab-order sweep.** The pack asserts focus lands on the summary heading; it does NOT additionally probe the full tab order across the failed fields. A v1.1.0 minor bump can walk the tab order.
- **AC-24106-1 linear-vs-free anchor rendering.** The pack does not have a dedicated check; the fixture's `?nav=free` and `?nav=linear` branches render honestly and consumers can probe the shape by inspection. A v1.1.0 minor bump can add a fifth check anchoring AC-24106-1 directly.
- **AC-24107-1 in-progress list enumeration.** The pack does not have a dedicated check; the `/in-progress` surface is inspected by the anatomy tests. A v1.1.0 minor bump can add a fifth check anchoring AC-24107-1 directly.
- **AC-24108-1 empty-state delegation.** The pack does not re-probe the empty-list wrapper here; the sibling `application-empty-error-states` pack already asserts it. Consumers apply both blueprints and the empty case is covered by the sibling pack. A v1.1.0 minor bump can add a cross-check that reads the empty wrapper on the `/in-progress` route.
- **AC-24105-1 cross-tab hydration.** The pack asserts the localStorage write and the sync tick on the local branch; it does NOT additionally probe cross-tab hydration or server-side dedupe on the server branch. Both are v1.1.0 minor-bump candidates.
- **AC-24104-1 keyboard-focus-on-change-link.** The pack asserts the change link and the answer retention; it does NOT additionally probe that following the change link places keyboard focus on the target field. A v1.1.0 minor bump can drive the click and read the active element on the target step.

## Companions

`suggestedCompanions` declares `logging` (every step transition, validation failure and save-and-return event writes one request-scoped log line with the correlation identifier and the step slug through the applied logger factory) and `errorHandling` (the error-summary contract constructs an internal error record per failed field through the applied error-handling factory). Neither is required to apply the blueprint; a project without a logging companion still renders every state, it just does not emit a per-step log line.

## Consumers

- `application-account-settings` (of this round) consumes the wizard task-list pattern for its multi-part account setup flow and the summary-review pattern for its confirm-before-save gate.

## Composition with application-spa

`application-spa` REQ-006 ships the forms-engine (TAC-205) that this blueprint's TAC-2502 delegates validation to. This blueprint composes with SPA; the topic-ownership boundary lives in `docs/topics.md`. SPA holds the forms-engine and the field-component library; this sibling holds the wizard shell, the task-list, the error-summary contract, the summary review and the save-and-return draft store.

## Composition with application-empty-error-states

The in-progress list's zero-drafts case delegates to the sibling's empty-list surface. This blueprint's TAC-2503 does not ship an empty component; the consumer applies both blueprints and the empty case reads consistently across the application. The topic-ownership boundary line lives in `docs/topics.md`, cross-referenced from the sibling's `docs/topics.md`.
