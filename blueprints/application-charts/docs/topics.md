# application-charts: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. The chart-component contract is a general accessibility-first practice; every ADR (engine choice, accessible palette, reduced motion) is non-global. When a second chart-shaped blueprint composes on the shelf (a Sankey blueprint, a mapping blueprint), THAT blueprint may claim a `chartEngine` topic; today, the single consumer (application-dashboard T-3) reads the shell contract directly.

## Deliberately unclaimed topics

- `chartEngine` (the chosen chart engine). Reserved for the applying project as an elicited choice, not a global topic; a second chart-shaped blueprint that composes with a specific engine would either supersede this blueprint or share the shell TAC.
- `categoricalPalette` (the shipped light and dark accessible-defaults). Not a global topic; the palette accessor is exposed through the shell factory input, not through a topic lookup.
- `chartMotionTokens` (the motion baseline the shell honours). The application-spa blueprint owns the motion tokens (`motionBaseline` topic in application-spa's docs/topics.md); the charts blueprint's ADR-1903 references them and adds no topic of its own.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Probe pack

`probe-packs/application-charts.pack.mjs` ships three checks anchored to blueprint AC ids:

- `AC-18102-1` non-colour distinction (colour plus pattern plus direct label)
- `AC-18103-1` text-alternative table in the same landmark, cell-per-value
- `AC-18104-1` keyboard traversal contract with reduced-motion suppression

Every check carries a `description` field per spec section 9. `appliesTo` binds `TAC-1901-application-charts-render-shell` OR any FBS route matching an operator-configured chart-route glob. See `probe-packs/application-charts.pack.mjs` for the source; see `packages/rcf-lite/test/fixtures/probe-pack-application-charts/README.md` for the sample-app fixture and the negative-run break switches.

## Consumers

- `application-dashboard` (visual round T-3): the leaf blueprint the dashboard shell consumes. The dashboard's chart region delegates chart rendering to this blueprint's render shell; the dashboard pack does not duplicate the chart-accessibility ACs, it references them.
