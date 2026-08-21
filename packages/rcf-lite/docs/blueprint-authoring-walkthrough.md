# Blueprint authoring walkthrough

## 1. Read this if

You have read the [authoring standard](blueprint-authoring.md) and want to see a minimal blueprint built end to end. The blueprint here is deliberately small: one REQ, one US with three ACs, one TAC, one `scope: "global"` ADR. It composes cleanly with the shipped SPA and REST blueprints because its global topic is unclaimed.

Follow along by copying the files under `blueprints/hello-panel/` in your working tree and running the commands from a scratch project directory.

## 2. The example

**Blueprint name:** `hello-panel`. **Purpose:** every project surfaces a persistent operator status panel that says whether background work is healthy. **Global topic contributed:** `operatorPanel` (unclaimed by SPA and REST). **AC id band:** `4101-4899` (next reservable band after REST at `2101-2899` and the placeholder `3101-3899`).

## 3. Directory layout

```
blueprints/hello-panel/
  blueprint.json
  README.md
  guide/hello-panel.md
  docs/topics.md
  contributions/
    requirements/
      hello-panel-req-001.json
    user-stories/
      hello-panel-us-4101.json
    tacs/
      tac-401-hello-panel.json
    adrs/
      adr-401-hello-panel-operator-panel.json
```

## 4. `blueprint.json`

```json
{
  "slug": "hello-panel",
  "version": "1.0.0",
  "contributions": [
    { "id": "hello-panel-REQ-001", "kind": "req",
      "path": "requirements/hello-panel-req-001.json" },
    { "id": "hello-panel-US-4101", "kind": "us",
      "path": "user-stories/hello-panel-us-4101.json" },
    { "id": "TAC-401-hello-panel", "kind": "tac",
      "path": "tacs/tac-401-hello-panel.json" },
    { "id": "ADR-401-hello-panel-operator-panel", "kind": "adr",
      "path": "adrs/adr-401-hello-panel-operator-panel.json",
      "scope": "global",
      "topic": "operatorPanel" }
  ]
}
```

Note the two namespacing families in action: REQ and US take the slug as PREFIX (`hello-panel-REQ-001`, `hello-panel-US-4101`); TAC and ADR take it as SUFFIX (`TAC-401-hello-panel`, `ADR-401-hello-panel-operator-panel`). The ADR's suffix carries a semantic tail (`operator-panel`) after the slug; that is accepted verbatim (see [namespace.js](../src/blueprint/namespace.js)).

## 5. The REQ contribution

`contributions/requirements/hello-panel-req-001.json`:

```json
{
  "reqId": "hello-panel-REQ-001",
  "prdId": "PRD-001",
  "title": "Operator status panel visible on every authenticated surface",
  "description": "The application renders a persistent operator status panel on every authenticated surface, reporting the current health of background work (queue depth, last-run outcome, next-run time). Anonymous surfaces do not render the panel.",
  "category": "functional",
  "domain": "operator-observability",
  "priority": "must",
  "rationale": "Background work drifts silently without a visible surface. A persistent panel gives the operator a first-order signal without opening logs.",
  "tags": ["blueprint:hello-panel"],
  "version": "1.0.0",
  "status": "approved",
  "createdAt": "2026-08-21T00:00:00Z",
  "updatedAt": "2026-08-21T00:00:00Z"
}
```

`prdId` names the project's PRD, not one this blueprint ships (blueprints never own a PRD). Every host project's PRD is `PRD-001` by init convention; if a project uses a different PRD id, the contribution's `prdId` reference will fail at `rcf validate` on that project. That is a known Phase 1 constraint of the mechanism.

## 6. The US contribution with ACs

`contributions/user-stories/hello-panel-us-4101.json`:

```json
{
  "usId": "hello-panel-US-4101",
  "prdId": "PRD-001",
  "reqId": "hello-panel-REQ-001",
  "version": "1.0.0",
  "status": "approved",
  "title": "Operator sees background work health without opening logs",
  "asA": "operator running the deployed application",
  "iWant": "to see the health of background work on every authenticated screen I visit",
  "soThat": "I catch drift before it becomes an incident",
  "acceptanceCriteria": [
    {
      "id": "AC-4101-1",
      "description": "Every authenticated surface renders the operator status panel in a landmark-safe region above the main content.",
      "given": "the operator is authenticated and any authenticated route is loaded",
      "when": "the route renders",
      "then": "an element with role='status' named 'operator status' is present in the accessibility tree",
      "testable": true,
      "scope": "runtime"
    },
    {
      "id": "AC-4101-2",
      "description": "The panel reports queue depth, last-run outcome, and next-run time; values refresh at least once every 30 seconds without a page reload.",
      "given": "the panel is visible",
      "when": "30 seconds elapse",
      "then": "the reported values reflect data no older than 30 seconds, without a document navigation",
      "testable": true,
      "scope": "runtime"
    },
    {
      "id": "AC-4101-3",
      "description": "Anonymous surfaces (login, error pages, public status pages) do not render the panel.",
      "given": "the operator is not authenticated",
      "when": "an anonymous route renders",
      "then": "no element with role='status' named 'operator status' is present",
      "testable": true,
      "scope": "runtime"
    }
  ],
  "tacIds": ["TAC-401-hello-panel"],
  "createdAt": "2026-08-21T00:00:00Z",
  "updatedAt": "2026-08-21T00:00:00Z"
}
```

`tacIds` cross-links the story to the component the blueprint ships. This is the mechanism-reach hook from the standard, section 7: the AC binds a class ("the panel renders"), the TAC names the component the project must realise, and `rcf validate`/`rcf coverage` refuse a project that leaves `TAC-401-hello-panel` unrealised.

## 7. The TAC contribution

`contributions/tacs/tac-401-hello-panel.json`:

```json
{
  "tacId": "TAC-401-hello-panel",
  "prdId": "PRD-001",
  "tadId": "TAD-001",
  "version": "1.0.0",
  "status": "approved",
  "name": "Operator status panel",
  "purpose": "Owns the persistent status panel rendered on every authenticated surface: queue-depth read, last-run outcome read, next-run time read, refresh cadence, and the landmark-safe region the panel occupies.",
  "responsibilities": [
    "Render a status region above main content on every authenticated route (AC-4101-1).",
    "Read queue depth, last-run outcome, next-run time from the project's background-work store (AC-4101-2).",
    "Refresh reported values at least once every 30 seconds without a document navigation (AC-4101-2).",
    "Refuse to render on anonymous routes (AC-4101-3)."
  ],
  "internalStructure": "A panel component wrapping a status region and a poll loop; poll cadence defaults to 30 seconds, tunable by the project.",
  "interfaces": [
    { "name": "background-work store", "kind": "read-api",
      "description": "Project-supplied read interface returning { queueDepth, lastRunOutcome, nextRunTime }." }
  ],
  "dependencies": [],
  "tradeoffs": "A persistent panel trades initial-render bundle weight for zero-navigation drift visibility. The 30-second cadence is the ceiling; projects with tighter freshness needs override the cadence.",
  "createdAt": "2026-08-21T00:00:00Z",
  "updatedAt": "2026-08-21T00:00:00Z"
}
```

## 8. The ADR contribution

`contributions/adrs/adr-401-hello-panel-operator-panel.json`:

```json
{
  "adrId": "ADR-401-hello-panel-operator-panel",
  "prdId": "PRD-001",
  "tadId": "TAD-001",
  "version": "1.0.0",
  "status": "accepted",
  "title": "A persistent operator status panel as the project's background-work visibility surface",
  "context": "Background work drifts silently. A per-route inline status readout duplicates the render surface and drifts out of sync across routes. A one-off admin page hides the signal behind an extra navigation the operator will not make routinely.",
  "decision": "The project renders one persistent operator status panel on every authenticated surface, sourced from the project's background-work store on a 30-second poll cadence. This is the operator's primary drift-detection surface.",
  "consequences": "The project owes the read-api on background work. Anonymous surfaces omit the panel; login, error and public status pages render as usual. Composing blueprints that offer their own operator-visibility surface conflict on topic 'operatorPanel' for operator resolution.",
  "createdAt": "2026-08-21T00:00:00Z",
  "updatedAt": "2026-08-21T00:00:00Z"
}
```

## 9. `docs/topics.md`

```
# hello-panel blueprint coordination vocabulary

## Global ADR topics (exact strings)

| Topic string | hello-panel contribution | Meaning | Composition note |
|---|---|---|---|
| operatorPanel | ADR-401-hello-panel-operator-panel | The project's primary operator drift-detection surface | Unclaimed by SPA and REST at v1.0.0. A composing blueprint that offers its own operator-visibility surface should reuse this exact string and let composition surface the pairing. |

## Id number bands

| Band | Owner |
|---|---|
| 001-999 | Project-authored docs |
| 1101-1899 | SPA blueprint |
| 2101-2899 | REST blueprint |
| 3101-3899 | Reserved |
| 4101-4899 | hello-panel blueprint (this package) |
```

## 10. `README.md`

Short. One screen. See [`blueprints/spa/README.md`](../../../blueprints/spa/README.md) as the shape.

## 11. Apply it

From a scratch project directory:

```sh
mkdir hello-app && cd hello-app
rcf init
rcf blueprint add /path/to/blueprints/hello-panel
```

Expected output on a clean tree:

```
[blueprint] applied 'hello-panel' at 1.0.0 (4 contribution(s)).
```

Confirm:

```sh
rcf blueprint list
```

```
hello-panel	1.0.0	2026-08-21T00:00:00.000Z	4 contribution(s)
```

`rcf validate` should exit 0. `rcf coverage --strict` will report `hello-panel-REQ-001` as `covered-unresolved` until the project's build cycle binds a TC to each AC; that is the intended state after apply.

## 12. Compose with SPA

Add the SPA blueprint alongside:

```sh
rcf blueprint add /path/to/blueprints/spa
```

No conflict on any topic (`operatorPanel` is unclaimed by SPA), no id-band collision (SPA owns `1101-1899`, hello-panel owns `4101-4899`). Both blueprints co-reside; the project chain composes against both.

## 13. Trigger a conflict on purpose

Rename hello-panel's global topic to `theming` and re-apply. Result:

```
[rcf] blueprint add refused: 1 conflict(s) detected.

conflict on topic (theming):
  incoming  blueprint hello-panel: A persistent operator status panel ...
  existing  blueprint spa: The one theming mechanism for the project ...
  ...
    3. Author a project-level ADR that supersedes both. Run:
         rcf blueprint supersede theming --incoming /path/to/blueprints/hello-panel
```

That is the mechanism working. Roll the topic back to `operatorPanel` before shipping the blueprint; unrelated concepts sharing a topic string is the [Baz ruling](../../../docs/2026-08-06_packaging-consolidation-proposal.md)-adjacent authoring error the topic-name rules in the standard, section 6, exist to prevent.

## 14. Remove and re-apply

```sh
rcf blueprint remove hello-panel
```

Refused if any project-authored doc references `hello-panel-REQ-001`, `hello-panel-US-4101`, `TAC-401-hello-panel`, or `ADR-401-hello-panel-operator-panel`. Clean state:

```
[blueprint] removed 'hello-panel' (4 file(s) deleted).
```

Re-apply is idempotent at the same version; a version bump follows section 8 of the standard.

## 15. Where the mechanism reach lands

Walk each AC on the story and check what refuses the project's FBS if the AC is not realised:

- **AC-4101-1** (landmark region present): a project TC bound to the AC that queries the accessibility tree for `role='status'` with name 'operator status'.
- **AC-4101-2** (30-second refresh cadence): a project TC that observes the reported values across two poll intervals.
- **AC-4101-3** (anonymous surface omission): a project TC that walks anonymous routes and asserts absence.

The blueprint does not ship these TCs (adherence expressed as ACs, decision 5); the project's build cycle authors them against the AC ids the blueprint contributed. `rcf coverage --strict` refuses to declare an FBS done while any AC on the bound US is `covered-unresolved`, so the mechanism-reach gap that bit categories 5, 6, and 11 of the SPA blueprint in watchpost run4 does not open here: the AC IS the gate, provided the host project's build cycle honours strict coverage.
