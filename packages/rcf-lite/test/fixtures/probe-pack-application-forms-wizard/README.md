# probe-pack-application-forms-wizard fixture

Dependency-free sample app the `application-forms-wizard` probe pack drives on the shelf gate. Node HTTP server plus static HTML per surface, no framework. Serves the four wizard surfaces honestly on the default branch (task-list, step, summary review, in-progress list) and exposes break switches so the pack's negative runs can be driven from a single boot.

## Boot

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard
node server.js
```

Prints `LISTENING <port>` once bound.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port the server binds to. `4200` is refused (reserved for the operator workspace). | `3000` |
| `FORMS_WIZARD_BREAK` | Force a default break across every request. Values: `task-list-vocab`, `no-summary`, `no-retain`, `no-draft`. Per-request `?break=` still wins when both are set. Useful for driving the pack's negative runs on plain paths without appending a per-request query. | unset |

## Query switches

| Query | Purpose |
|---|---|
| `?step=<n>` | Selects step 1, 2 or 3 (`/step/<n>` route). |
| `?draft-store=<server\|local\|none>` | Picks the save-and-return transport. `server` is the shipped default; `local` writes to `window.localStorage`; `none` proves the refused branch. |
| `?nav=<linear\|free>` | Task-list navigation posture. `linear` disables rows whose prerequisites are unfinished; `free` renders every row as an anchor. Default `linear`. |
| `?seed=<partial\|complete>` | Seeds the task-list or summary review with pre-filled answers. `partial` fills step 1; `complete` fills every step. |
| `?refused=1` | On the step route, pre-renders the error-summary shape as if a submit had refused. Used by `AC-24103-1`. |
| `?preseed=1` | On the step route, writes one field into the draft store on load (server branch mutates the in-memory table; local branch runs a client-side write into `localStorage`). Used by `AC-24105-1`. |
| `?edit=<field-slug>&value=<x>` | On the summary route (with `?seed=complete`), replaces the named field's value and preserves the rest. Used by `AC-24104-1`. |
| `?caps=<list>` | n/a for this blueprint. application-forms-wizard declares no capabilities and no requiresAppliedCapabilities, so there is nothing to gate; the fixture ignores this switch. |
| `?theme=<name>` | n/a for this blueprint. This blueprint has no theme-gated surface or resize seam, so the fixture does not vary its render on theme; the switch is ignored. |

## Break switches

| Query | Purpose |
|---|---|
| `?break=task-list-vocab` | Swaps a step-state string away from the closed GOV.UK vocabulary. Pack check `AC-24101-1` refuses. |
| `?break=no-summary` | Drops the `[data-surface="error-summary"]` region on the refused step. Pack check `AC-24103-1` refuses. |
| `?break=no-retain` | Wipes every unedited answer on the edit-and-save round-trip. Pack check `AC-24104-1` refuses. |
| `?break=no-draft` | Drops the draft-store write path (no `POST /drafts`, no `localStorage` write, no `[data-sync-tick]`). Pack check `AC-24105-1` refuses. |

## Routes

- `/` and `/task-list` render the task-list surface with the ARIA progressbar wrapper and one row per step.
- `/step/<n>` renders step `n` (1, 2 or 3). `POST /step/<n>` records a synthetic advance into the server-side draft table.
- `/summary` renders the summary-review surface when `?seed=complete` is set; otherwise renders the fallback.
- `/in-progress` lists every wizard the operator has started but not submitted; the zero-drafts case renders the `[data-surface="empty-list"]` delegated to `application-empty-error-states`.
- `GET /drafts` returns the in-memory server-draft-table JSON body for the synthetic operator.
- `POST /drafts` accepts `{ step, field, value }` and writes into the in-memory draft table.

## Manual boot

```
PORT=4321 node server.js
curl -s http://127.0.0.1:4321/task-list | head -20
```

Two-line boot: start the server, hit `/task-list` to confirm the surface renders.

## Declared env vars

| Name         | Read by      | Purpose                                                       |
|--------------|--------------|---------------------------------------------------------------|
| `PORT`       | `server.js`  | Bind port for manual runs (default `3000`).                   |
| `PROBE_PORT` | `probe-utils.mjs` in `blueprints/application-forms-wizard/contributions/probes/` | Bind port used by the probe pack (default `47306`, reserved range 47300-47399). |

No account-bound branch: the engine is a local fixture, so no `CI_HAS_*` gate applies.
