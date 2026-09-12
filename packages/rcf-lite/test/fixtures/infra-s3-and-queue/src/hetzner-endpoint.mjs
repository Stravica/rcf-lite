/**
 * Hetzner Object Storage endpoint-shape helper.
 *
 * Realises the object-storage-s3 v1.1.0 TAC-2904 helper contract. The
 * sole composer of the vendor-documented endpoint pattern
 * <bucket>.<location>.your-objectstorage.com per
 * https://docs.hetzner.com/storage/object-storage/overview. The
 * shipped facade at TAC-2901 (fixture path src/object-store.mjs) is
 * unchanged; a probe or an applying project imports composeHetznerEndpoint
 * and feeds the composed https URL to createObjectStore through the
 * elicited endpointUrl parameter.
 *
 * Mutation-purity discipline: every
 * SIMULATE_ switch that alters INPUT lives here on the fixture side.
 * Probe modules under blueprints/object-storage-s3/contributions/probes/
 * NEVER read a SIMULATE_ variable; a probe-side grep for SIMULATE_ must
 * return zero hits.
 */

const VALID_LOCATIONS = new Set(['fsn1', 'hel1', 'nbg1']);

/**
 * Compose the Hetzner Object Storage endpoint URL from an elicited
 * bucket name and a vendor-documented location code. Refuses on an
 * unknown location so an applying project cannot silently ship an
 * invalid endpoint.
 *
 * Under SIMULATE_HETZNER_ENDPOINT_MISSHAPEN=true the composed URL
 * drops the vendor subdomain `your-objectstorage.com` and returns a
 * malformed host so the probe FAILS naming the missing subdomain.
 */
export function composeHetznerEndpoint({ bucket, location }) {
  if (typeof bucket !== 'string' || bucket.length === 0) {
    const err = new Error('hetzner-endpoint: bucket is required and must be a non-empty string');
    err.field = 'bucket';
    throw err;
  }
  if (typeof location !== 'string' || !VALID_LOCATIONS.has(location)) {
    const err = new Error(
      `hetzner-endpoint: location must be one of ${[...VALID_LOCATIONS].join(', ')}; got ${JSON.stringify(location)}`,
    );
    err.field = 'location';
    throw err;
  }
  if (process.env.SIMULATE_HETZNER_ENDPOINT_MISSHAPEN === 'true') {
    // Fixture-side INPUT mutation: drop the vendor subdomain.
    return `https://${bucket}.${location}.example.invalid`;
  }
  return `https://${bucket}.${location}.your-objectstorage.com`;
}

/**
 * Read the Hetzner Object Storage credential pair, bucket and
 * location from the process env. Names match the round-5 T-2
 * env-var discipline (HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID etc.) so
 * the runner and the fixture agree on one shape.
 */
export function hetznerCredentialsFromEnv() {
  return {
    accessKeyId: process.env.HETZNER_OBJECT_STORAGE_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.HETZNER_OBJECT_STORAGE_SECRET_ACCESS_KEY || null,
    bucket: process.env.HETZNER_OBJECT_STORAGE_BUCKET || null,
    location: process.env.HETZNER_OBJECT_STORAGE_LOCATION || null,
  };
}

/**
 * Whitelisted metadata fields the Hetzner probe's lifecycle event
 * records are allowed to carry. Kept small on purpose: enough to
 * observe the round-trip, nothing that could carry a credential or
 * an object body.
 */
export const HETZNER_EVENT_WHITELIST = new Set([
  'event',
  'ts',
  'endpointHost',
  'bucketName',
  'location',
  'key',
  'size',
  'contentType',
]);

/**
 * Build the payload a lifecycle event record carries. The base
 * record is copied verbatim; under SIMULATE_HETZNER_EVENT_LEAK=true
 * the fixture-side decorator appends fixture-labelled credential
 * fields so the probe's whitelist assertion FAILS naming the leaked
 * field names. Real credentials are never handled by this decorator.
 */
export function makeHetznerEventDecorator(baseEvent) {
  const record = { ...baseEvent };
  if (process.env.SIMULATE_HETZNER_EVENT_LEAK === 'true') {
    record.accessKeyId = 'AKIA-FIXTURE-LEAK-DO-NOT-USE';
    record.secretAccessKey = 'FIXTURE-SECRET-LEAK-DO-NOT-USE';
  }
  return record;
}

/**
 * Walk an array of event records; return {pass, leaked[]}. leaked
 * carries every field name that appeared on any record but is not on
 * the whitelist.
 */
export function assertMetadataOnlyEventRecords(events) {
  const leaked = new Set();
  for (const record of events) {
    for (const k of Object.keys(record)) {
      if (!HETZNER_EVENT_WHITELIST.has(k)) leaked.add(k);
    }
  }
  return { pass: leaked.size === 0, leaked: [...leaked] };
}
