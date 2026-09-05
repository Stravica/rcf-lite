# application-dashboard: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. The dashboard-shell contract is a composed application shape; every ADR (primary-KPI kinds, timeframe presets, export formats) is non-global.

## Deliberately unclaimed topics

- `dashboardShell` (the shell composition itself). Not a global topic; a second dashboard-shaped blueprint would either share TAC-2001 or supersede this blueprint.
- `kpiKind` (the primary-KPI kind enum). Reserved for the applying project as an elicited choice, not a global topic; a second dashboard-shaped blueprint that composes with a different enum would either supersede this blueprint or share the ADR.
- `refreshCadence` (the timeframe fan-out contract). The application-charts blueprint's ADR-1903 owns the reduced-motion posture; the dashboard's ADR-2002 owns the auto-refresh default. Neither is a global topic; a future observability-adjacent blueprint that composes on refresh cadence would claim its own.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Probe pack

`probe-packs/application-dashboard.pack.mjs` ships three checks anchored to blueprint AC ids:

- `AC-19102-1` primary-KPI position by DOM order and CSS Grid position at 1440, 1024 and 360
- `AC-19104-1` timeframe refetch fan-out with matching boundary and as-of stamp
- `AC-19103-1` per-tile four-state contract with role region, aria-live polite and non-colour distinction

Every check carries a `description` field per spec section 9. `appliesTo` binds `TAC-2001-application-dashboard-tile-grid` OR any FBS route matching an operator-configured dashboard-route glob. See `probe-packs/application-dashboard.pack.mjs` for the source; see `packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/README.md` for the sample-app fixture and the negative-run break switches.

## Packaged design guidance

`assets/guidance/dashboard-design.md` is a shipped operator-and-agent-readable asset covering eight sections (primary KPI placement; tile density and count limits; timeframe and filter chrome; loading, empty and error states; colour and contrast; when a table beats a chart, delegating to application-datatable; refresh cadence and staleness; anti-patterns) with five https-cited sources (NN/g dashboard design, Few, Tufte, GOV.UK Design System patterns, WCAG 2.2 Understanding docs). Each section names whether the rule hardens into an AC on this blueprint or stays operator guidance.

## Consumers and dependencies

- Consumes `application-charts` (visual round T-2): the chart region on every dashboard surface mounts through the application-charts render shell (TAC-1901). The dashboard pack does not duplicate the chart-accessibility ACs; the charts pack fires on the dashboard's chart route through its own applicability predicate.
- References `application-datatable` (visual round T-1) in the packaged design guidance's section 6 ("when a table beats a chart"). A dashboard whose data really wants a records table applies the datatable blueprint instead of overloading the tile row.
- Extends the T-0 pack-browser seam with a `resize(width, height)` method; every blueprint after this one that ships a breakpoint-scoped visual AC reuses the seam.
