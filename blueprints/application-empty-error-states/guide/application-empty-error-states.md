# application-empty-error-states: operator guide

## When to reach for it

Your project renders any surface whose input can be empty, whose network call can fail, whose user can lack scope, or whose client can crash mid-render. That covers every SPA that hits an API and every routed page that can dereference an id. You want one contract for the eight named states, one recovery-action router per state, one polite live-region for progress announcements, and a runtime pack that refuses ship on a stack-trace leak, a resource-id leak, a missing recovery affordance, or a dropped live-region wrapper.

## The eight named states

The blueprint enumerates the eight states in the ratified order below. Every README, guide, pack `checks[]` and `docs/topics.md` row across the family names the same eight slugs.

- `not-found`: routed page dereferences an id that has been removed or was never there.
- `forbidden`: caller is authenticated but the target resource refuses; the surface offers a request-access affordance.
- `server-error`: a 500-class failure the client cannot recover from without a retry.
- `offline`: the client has lost the network; the surface announces the transition and, on reconnection, replays it through the polite live-region wrapper.
- `permission-denied`: the caller lacks a scope the target resource requires; the surface names the missing scope in the cause without leaking the resource id.
- `empty-list`: a collection surface has zero rows and offers the recovery-action router entry (create, clear filters, or invite, per project wiring).
- `no-search-results`: a query returned an empty set; the surface echoes the query verbatim and suggests broadening it.
- `error-boundary`: a client-side render exception was caught; the surface renders under `role="alert"` and offers a route-level recovery.

## When NOT to reach for it

Your product is a marketing site or a static content surface with no dynamic state. The eight states model a live workspace; a static site has no offline mode, no per-resource forbidden state, no client-side render boundary, and forcing the model on a static site adds mechanism without payoff.

Your product has already committed to an opinionated single-vendor state library (Sentry with a bespoke boundary, a framework-specific error module) whose contract is materially different from the eight-state catalogue. Adopt this blueprint only when the vendor library composes with the state-machine TAC rather than replacing it.

## What stays your call

- The visual design of each state region. The blueprint contributes WHAT surfaces under WHAT condition; the palette, spacing and typography are your project's design system's call.
- Whether the 500 surface hides the stack trace in staging (ADR-2302 elicited toggle) or hides it everywhere (the recommended default).
- The offline strategy: write-buffer (the default), read-only-banner, or refuse-writes (ADR-2303 elicited enum).
- The request-access endpoint the forbidden and permission-denied surfaces POST to. The blueprint declares the shape (`POST /api/request-access` with a JSON body); the endpoint's server-side handling is your call.
- The parent-surface path and clear-filters callback the recovery-action router wires into the rendered controls.

## What a good outcome looks like

The pack fires on every FBS whose surface renders a routed page or a listing, and every check returns `pass` on the honest render and `fail` on the corresponding break switch. Your CI runs the fixture round-trip on every PR that touches a state region. Your operator sees eight distinct visuals in a screenshot review and can pick out which state a screenshot represents without reading the copy. Your accessibility audit's live-region check on the polite wrapper passes because the wrapper preseeded at page render, not on state entry. Your production 500 surface never leaks a source path, an environment variable, or a backtrace frame.

## Mechanism-reach gaps

The blueprint's README lists the runtime-observable ACs the pack does NOT bind directly. Every gap is a candidate for a v1.1.0 minor bump extending the pack. Combine with `application-notifications-in-app` to route request-access submissions through the shipped notification centre and with `application-spa` to inherit the tab-title convention and the state-visual tokens.

## Promotion signals

- Three or more consumer blueprints (forms-wizard, account-settings, dashboard, admin-console) start elicitizing the same sensitive-pattern extension for the 500 surface. Candidate: a `sensitivePatternsRegistry` global topic in a v1.1.0 minor.
- The offline-buffer TAC needs a shared engine across a persistence blueprint and this UI blueprint. Candidate: a dedicated `application-offline-sync` blueprint absorbing the write-buffer.
- The recovery-shape enum needs a request-access-inline shape (inline form rather than a POST). Candidate: a v1.1.0 minor bump extending TAC-2302's recovery-shape closed set.

## Costs to be honest about

Realising all eight states honestly in a client is a chunk of code even after adopting the TACs; project-side wiring per framework is at least an afternoon per state. The pack is Playwright-first, so a project without a running dev server at gate time cannot fire it. The offline TAC assumes IndexedDB by default; a WebView with a locked-down storage policy elicits an alternative per ADR-2303 and takes a small amount of adapter code.
