# application-file-upload: operator guide

## When to reach for it

Your project accepts file uploads from operators, whether one file at a time or a set, whether small text and image assets or large media. You want one contract for the input surface (labelled input plus drop-zone plus keyboard opener per WCAG 2.5.7), one recommended transport that ships resumable-chunked out of the box, one refusal contract that binds errors via `aria-describedby` and never lets refused bytes reach the server, one polite live-region tick that keeps a screen-reader user informed of progress, and a runtime pack that refuses ship on a dropped input, a dropped live-region, a refused file that reached the wire, or a collapsed transport.

## The two transports

The two shipped transport slugs are `multipart` and `tus`. `multipart` is the recommended default (ADR-2401 `recommendedDefault: true`) because every server toolkit accepts it and the client-side code is a Blob split into fixed-size chunks. `tus` is the elicited alternative for projects with a tus server or the third-party tus client library; on the tus branch each chunk is a PATCH request with an `Upload-Offset` header the pack asserts. A third alternative, `vendor-sdk` (S3 multipart, Cloudflare R2 client-direct, Cloudinary widget), is documented in ADR-2401 for projects committed to a vendor; the shipped fixture does not exercise it, and a vendor-sdk project runs the pack against a fixture that mocks the vendor's completion callback.

## The four file-row states

The four shipped state slugs are `idle`, `uploading`, `refused`, `complete`. Every file row on the fixture cycles through this closed set; the same slugs ride `[data-file-state]` on the file row in your applied project. Extending the state set is a v1.1.0 minor bump; removing or renaming a state is a v2.0.0 major.

## When NOT to reach for it

Your product is a marketing site or a static content surface that never accepts an upload. The four contracts model a live upload surface; a static site has no transport, no progress tick, no refusal contract, and forcing the model on a static site adds mechanism without payoff.

Your product has already committed to an opinionated single-vendor upload widget (Uppy with a specific backend, Filepond with a specific plugin set) whose contract is materially different from the input plus refusal plus progress catalogue. Adopt this blueprint only when the vendor widget composes with the input TAC's `collectFiles` factory rather than replacing it.

## What stays your call

- The visual design of the upload region, the file rows and the drop-zone. The blueprint contributes WHAT surfaces under WHAT condition; the palette, spacing and typography are your project's design system's call.
- The accepted MIME set (ADR-2402 elicited enum). No default; every project elicits its own list of IANA media types.
- The per-file size cap in bytes (ADR-2402 elicited). No default; every project elicits its own cap.
- The transport branch (ADR-2401 elicited). Recommended `multipart`; elicit `tus` when a tus server is available or the third-party SDK is on the path; elicit `vendor-sdk` when a vendor SDK is on the path.
- The virus-scan verifier (ADR-2403 capability-plus-elicit). Every project elicits the verifier or the explicit noop; there is no shelf default and the guide names the risk in plain language for the noop path.
- The concurrency cap for the transport worker pool. Recommended default 3; a slow-link project elicits a lower cap.
- The announcer polling interval in milliseconds. Recommended default 250; a project sensitive to CPU cost on a hot page elicits a higher interval.
- The upload endpoint URL. The blueprint declares the shape (`POST /api/upload/chunk` for multipart, `POST /api/upload/tus` for the tus creation URL); the endpoint's server-side handling is your call.

## What a good outcome looks like

The pack fires on every FBS whose surface renders an upload route, and every check returns `pass` on the honest render (both transport branches) and `fail` on the corresponding break switch. Your CI runs the fixture round-trip on every PR that touches an upload surface. Your operator uploads a file with the keyboard alone and hears the polite tick as it advances. Your production upload surface never lets a refused file's bytes leave the browser. Your production stack ships with an explicit virus-scan verifier or with the noop plus the guide's risk paragraph on file.

## Mechanism-reach gaps

The blueprint's README lists the runtime-observable ACs the pack does NOT bind directly (drop-event round-trip, screen-reader adoption, error-message content, network-interruption resume on multipart, assertive-slot exclusive fire, network interruption resumption, background-tab tick continuity). Every gap is a candidate for a v1.1.0 minor bump extending the pack. Combine with `application-error-handling` to route refusal internal error records through the shipped factory and with `application-spa` to inherit the visual tokens.

## Promotion signals

- Three or more consumer blueprints (forms-wizard, an eventual CSV-import, account-settings avatar upload) start elicitizing the same accepted-set entries. Candidate: a `commonAcceptedSets` global topic in a v1.1.0 minor.
- The transport TAC needs a shared engine across an object-storage blueprint and this UI blueprint. Candidate: a dedicated `application-file-transport` blueprint absorbing the chunked-and-resumable path.
- Localisation of the polite and assertive text formats. Candidate: a v1.1.0 minor bump extending the announcer TAC's `announcementFormatsEnum` with a lookup table.

## Costs to be honest about

Realising all three input affordances honestly in a client is a chunk of code even after adopting the TACs; the WCAG 2.5.7 keyboard alternative is often the piece a first cut skips. The pack is Playwright-first, so a project without a running dev server at gate time cannot fire it. The tus branch assumes a tus server or the third-party client; a project that elicits tus without one hits an apply-time refusal on the elicit and unblocks by wiring one in or falling back to multipart.
