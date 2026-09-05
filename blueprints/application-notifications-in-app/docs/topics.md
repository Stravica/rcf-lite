# application-notifications-in-app: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. The in-app-notifications contract is a composed application shape; every ADR (priority-to-role mapping, toast timeout floor, centre retention window) is non-global.

## Deliberately unclaimed topics

- `notificationsChannel` (the channel this blueprint owns). Not a global topic; the family-prefix reservation is the discoverable coordination mechanism (see below). A future blueprint that composes across all in-app-adjacent channels (a shared preferences store, for instance) would either share TAC-2103 or supersede this blueprint.
- `livingRegionMapping` (the priority-to-role mapping). Reserved for the applying project as the ADR-2101 decision, not a global topic; a project that supersedes the mapping authors its own ADR.

## Family-prefix reservation

The `application-notifications-` prefix is reserved for the sibling channel blueprints the shelf will grow into: `-email`, `-push`, `-webhook`. This is a doc-only reservation in v1.0.0 (per spec Q3 default). No sibling channel ships in this round. See the family-prefix row in the shelf band registry below and the blueprint README's "Family-prefix reservation" section.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-notifications-email (reserved) | 21101-21899 (reserved) | 22xx (reserved) | doc-only reservation (not shipped) | tba |
| application-notifications-push (reserved) | 22101-22899 (reserved) | 23xx (reserved) | doc-only reservation (not shipped) | tba |
| application-notifications-webhook (reserved) | 23101-23899 (reserved) | 24xx (reserved) | doc-only reservation (not shipped) | tba |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Probe pack

`probe-packs/application-notifications-in-app.pack.mjs` ships three checks anchored to blueprint AC ids:

- `AC-20101-1` live-region preseeding on every declared route (both wrappers present AND empty at load)
- `AC-20102-1` transient toast contract with priority-to-role mapping and timeout measured against the six-second WCAG 2.2.1 floor
- `AC-20103-1` centre acknowledge round-trip enumerated by `data-notification-id`, reconciled through client and server request logs

Every check carries a `description` field per spec section 9. `appliesTo` binds `TAC-2101-application-notifications-in-app-live-region` OR any FBS route matching `notifications-centre`. See `probe-packs/application-notifications-in-app.pack.mjs` for the source; see `packages/rcf-lite/test/fixtures/probe-pack-application-notifications-in-app/README.md` for the sample-app fixture and the four negative-run break switches.
