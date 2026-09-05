# probe-pack-application-notifications-in-app sample-app fixture

Dependency-free Node HTTP server exercising every surface the `application-notifications-in-app` probe pack asserts on. Used at the shelf gate to drive the pack against a golden and against four broken variants (one break switch per pack check plus one for the acknowledge round-trip).

## Boot

Two-line manual boot for the gate reviewer:

```
cd packages/rcf-lite/test/fixtures/probe-pack-application-notifications-in-app
PORT=3000 node server.js
```

Once bound, the server prints one line to stdout:

```
LISTENING 3000
```

`PORT` is an env var (default `3000`). Any free port is fine; the pack drives whatever URL the reviewer passes to `rcf verify browser --url`.

Stop the server with Ctrl+C or `kill <pid>` (SIGTERM is honoured).

## Routes

- `GET /` (also `GET /index.html`): renders the main application shell with two toast triggers (an info-priority button that fires a `role="status"` toast into the polite live-region wrapper, an error-priority button that fires a `role="alert"` toast into the assertive wrapper). Both wrappers are preseeded at page load.
- `GET /notifications-centre`: renders the notification centre inbox with a seeded backlog of three notifications inside the ADR-2103 retention window (thirty days). Each item carries a `data-notification-id` attribute, a Tab-reachable acknowledge control (`[data-action="acknowledge"]`), a mark-read control (`[data-action="mark-read"]`), and the surface exposes one mark-all-read control (`[data-action="mark-all-read"]`). Both live-region wrappers are preseeded at page load and remain empty until an acknowledge failure surfaces an error toast.
- `GET /notifications-preferences`: renders the preferences UI with one section per category (`security`, `payment`, `product`) carrying a labelled silence toggle, and one section per sibling channel (`email`, `push`, `webhook`) rendered disabled because no sibling channel blueprint is applied on the fixture. Both live-region wrappers preseeded.
- `POST /__emit`: emits a toast through the client script by echoing the request (the pack activates a toast trigger through the button click OR calls `POST /__emit` and then activates a trigger). Body is `{ priority: "info" | "error", category: string }`. Recorded on the server request log.
- `GET /__requests`: returns the append-only request log as JSON. Each entry is `{ kind, notificationId, category, priority, at }`. Used by the pack to reconcile toast fires, dismissals, acknowledge round-trips and mark-read events with `window.__notificationFetches`.
- `GET /__record`: internal recording endpoint the client script calls on every fetch record so the server-side log mirrors `window.__notificationFetches`.
- `GET /api/delivery-log`: returns `{ rows: [...] }` with the seeded delivery-attempt rows plus any live entries.
- `POST /api/notifications/acknowledge`: the acknowledge round-trip endpoint. Body `{ notificationId }`. Marks the row's `acknowledgedAt` on the delivery log and returns `{ ok: true, notificationId }`.
- `POST /api/preferences/category`: category-silence preference update. Body `{ category, silenced }`. Echoes `{ ok: true }`.
- `GET /healthz`: returns `200 ok`.

## Query switches

Every HTML route accepts `?break=<mode>` and `?timeoutMs=<n>` (an override for the toast dismissal timer, used by the fixture unit tests to drive a short timeout without waiting six seconds; the pack always drives the shipped six-second default so the check measures the ratified floor honestly).

| Switch | What it does | Pack check that must fail | Severity |
|---|---|---|---|
| `?break=preseed` | The two live-region wrappers are NOT rendered at page load; the client script injects them lazily on the first toast fire. | `AC-20101-1` live-region preseeding | block |
| `?break=role` | An error toast renders inside the polite wrapper with `role="status"` (and an info toast renders inside the assertive wrapper with `role="alert"`), inverting the ADR-2101 mapping. | `AC-20102-1` toast contract role mapping | block |
| `?break=timeout` | Toasts dismiss after two seconds instead of six; the shell root's `data-toast-timeout-floor-seconds` reads `2` so the assertion sees the WCAG 2.2.1 floor is not met. | `AC-20102-1` toast contract timeout floor | block |
| `?break=ack` | The acknowledge click handler is a no-op: no POST, no DOM update. | `AC-20103-1` centre acknowledge round-trip | block |

## Shape asserted

- The shell root on every route exposes `data-region="shell-root"`, `data-route="<route>"` and `data-toast-timeout-floor-seconds="6"` (or `"2"` under `?break=timeout`).
- Both live-region wrappers carry `data-live-region="polite"` and `data-live-region="assertive"` (the pack enumerates them by that per-element attribute, never by `aria-live` or `role` alone).
- Every toast wraps into `[data-toast-id]` inside one of the two wrappers with `data-toast-priority="info" | "error"`, `data-shown-at="<ISO-8601>"`, `data-dismissed-at="<ISO-8601>"` (once dismissed), and a `[data-action="dismiss"]` control.
- Every centre item wraps into `[data-notification-id]` with `data-category`, `data-priority`, `data-delivered-at`, `data-acknowledged` and the `[data-action="acknowledge"]` and `[data-action="mark-read"]` controls.
- `window.__notificationFetches` is an append-only array of every client-side fetch record; `/__requests` mirrors the same content server-side.

## What this fixture is not

- Not a notifications framework. It is one dependency-free Node HTTP server that emits the exact DOM shape the pack asserts on. A real applying project mounts through TAC-2101, TAC-2102 and TAC-2103 and drives the shape from its own data source.
- Not the shipped blueprint. The blueprint lives at `blueprints/application-notifications-in-app/`; this fixture is the golden the pack probes at the shelf gate.

## Related

- Probe pack: `blueprints/application-notifications-in-app/probe-packs/application-notifications-in-app.pack.mjs`
- Blueprint README: `blueprints/application-notifications-in-app/README.md`
- Ratified spec: `projects/blueprint-library/specs/visual-round-spec-2026-09-04.md` section 5.4 (in the operator repo).
