# application-admin-console: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. The console is a consumer of the identity capability set the applied auth blueprints declare through `capabilities[]`; every ADR (capability vocabulary, baseline roles, invite transport, audit retention) is non-global.

## Deliberately unclaimed topics

- `roleModel` (the shape of a role catalogue: id/label/permission tuples). Reserved for the applied auth blueprint's ADR set; the console reads the applied `roleModel` label vocabulary through the elicited `baseline-roles` answer and does not mint its own role-model global topic.
- `principalDirectory` (the shape of a principal record). Reserved for the applied auth blueprint's ADR set for the same reason.
- `tenancy` (the shape of an organisation abstraction). Reserved for a future `application-tenancy-orgs` blueprint (spec section 11).
- `auditLog` (the audit event stream shape). Reserved for the applied logging companion's ADR set, or a future dedicated audit-log blueprint.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-admin-console | 21101-21899 | 22xx | shipped v1.0.0 | none |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Probe pack

`probe-packs/application-admin-console.pack.mjs` ships four capability-gated checks anchored to blueprint AC ids:

- `AC-21102-1` users directory (fires only when `principalDirectory` is applied)
- `AC-21103-1` permission matrix (fires only when `roleModel` is applied)
- `AC-21104-1` org switcher (fires only when `tenancy` is applied)
- `AC-21105-1` audit-log surface (fires only when `auditLog` is applied)

The pack applies to any FBS binding `TAC-2201-application-admin-console-shell` or whose navModel routes name an admin path. See `packages/rcf-lite/docs/blueprint-authoring.md` section 8c for the pack authoring rules.
