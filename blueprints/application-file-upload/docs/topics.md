# application-file-upload: coordination vocabulary

## Global topics

The blueprint claims no new global topics at v1.0.0. Every ADR (transport branch, accepted set, virus-scan integration) is non-global.

## Deliberately unclaimed topics

- `uploadEnvelope` (the shape of an upload success or completion response body). Reserved for the applied API blueprint (`application-api-rest` claims it today); this blueprint reads the wire-level chunk acknowledgements, not the envelope body shape, so no claim collides.
- `commonAcceptedSets` (a shelf-wide registry of accepted MIME sets a consumer can reach for). Reserved for a future v1.1.0 minor bump if three or more consumer blueprints start elicitizing the same lists. Held here as an unclaimed topic so a composing author sees the reservation.
- `objectStorageTransport` (a shared engine for the chunked-and-resumable transport that both an object-storage blueprint and this UI blueprint would reach for). Reserved for a future dedicated `application-file-transport` blueprint; held here so a composing author sees the reservation before minting a new topic.
- `announcementFormatsCatalogue` (the localised polite and assertive text formats). Reserved for a v1.1.0 minor bump extending the announcer TAC's `announcementFormatsEnum` with a lookup table.

## Shelf id band and suffix block

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-admin-console | 21101-21899 | 22xx | shipped v1.0.0 | none |
| application-empty-error-states | 22101-22899 | 23xx | shipped v1.0.0 | none |
| application-file-upload | 23101-23899 | 24xx | shipped v1.0.0 | none |
| application-forms-wizard | 24101-24899 | 25xx | shipped v1.0.0 | none |
| application-account-settings | 25101-25899 | 26xx | shipped v1.0.0 | none |
| application-onboarding-tour | 26101-26899 | 27xx | shipped v1.0.0 | none |
| persistence-data-postgres | 27101-27899 | 28xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| object-storage-s3 | 28101-28899 | 29xx | shipped v1.0.0 | `objectStorageContract` |
| messaging-queue-cloudflare | 29101-29899 | 30xx | shipped v1.0.0 | `deliverySemantics` |
| jobs-background | 30101-30899 | 31xx | shipped v1.0.0 | `backgroundJobModel` |
| platform-cloudflare-kv | 31101-31899 | 32xx | shipped v1.0.0 | `keyValueStoreContract` |

The shelf-wide band registry lives in `packages/rcf-lite/docs/blueprint-authoring.md` section 5.

## Composition with application-spa

`application-spa` REQ-006 ships upload and progress and error components as part of its component library. Applying this blueprint alongside `application-spa` composes cleanly: SPA holds the visual tokens for the upload region; this blueprint holds the input affordances, the transport contract, the refusal contract and the runtime enforcement pack. No `scope: "global"` ADR conflict.

## Composition with application-empty-error-states

A refused upload is a refusal contract state, not an empty or error state; the two blueprints do not overlap on state slugs. A transport-level failure (server 5xx during a chunk PATCH) surfaces through `application-empty-error-states`'s server-error state after the transport's retry budget is exhausted. No global-topic overlap.

## Composition with application-error-handling

Refusals and transport-layer failures construct an internal error record through the applied error-handling factory (`suggestedCompanions: errorHandling`). This blueprint reads the factory's shape; `application-error-handling` owns the shape and its correlation-identifier discipline.

## The four fixture states and the two transport slugs

The four state slugs `idle`, `uploading`, `refused`, `complete` and the two transport slugs `multipart`, `tus` appear identically across the blueprint README, the fixture README, the operator guide, the probe pack `checks[]` descriptions and this file. Extending either enum is a v1.1.0 minor bump; removing or renaming is a v2.0.0 major.

## Probe pack

`probe-packs/application-file-upload.pack.mjs` ships four surface-observable checks anchored to blueprint AC ids, one per contract:

- `AC-23101-1` input surface (file input, drop-zone, keyboard-focusable opener)
- `AC-23102-1` progress announcer (polite tick format and monotonic advance)
- `AC-23103-1` refusal contract (aria-describedby error binding, refused bytes never on the wire)
- `AC-23104-1` chunked transport (multipart chunks or tus Upload-Offset)

The pack applies to any FBS binding `TAC-2401-application-file-upload-input` or whose navModel routes name an operator-configured upload path (matching `/upload`). See `packages/rcf-lite/docs/blueprint-authoring.md` section 8c for the pack authoring rules.
