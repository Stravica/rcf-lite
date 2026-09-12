/**
 * Fixture-root shim for the object-storage-s3 v1.1.0 Hetzner Object
 * Storage adapter probe. Delegates to the blueprint-side shim so the
 * fixture and the blueprint use the same probe module and the same
 * per-blueprint report path.
 *
 * The shim carries the blueprint slug in its name to disambiguate
 * from any other blueprint that later drives the shared
 * infra-s3-and-queue fixture (per shared-fixture-shim naming
 * convention 2026-09-08).
 */

import '../../../../../blueprints/object-storage-s3/contributions/probes/run-hetzner-object-storage-round-trip.mjs';
