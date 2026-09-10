// Storage-round-trip probe for platform-cloudflare-durable-objects v1.0.0.
//
// Creates an in-memory DO storage driver on each of the two
// elicited backends (sql and kv per ADR-3403), drives put/get,
// delete/get and list({prefix}) on each; asserts the round-trip
// on both. Also asserts driver.backend reports the elicited
// answer (AC-33111-1). The backend-mismatch mutation-run is
// triggered fixture-side by the shim
// h2-cf-do-storage-round-trip-shim.mjs, which constructs a driver
// from an unrecognised backend answer that the shipped factory
// clamps to sql per ADR-3403 recommendedDefault; the probe body
// receives the mismatch driver from the shim and surfaces the
// clamp as an AC-33103-1 fail so a reviewer can see the
// substitution.
//
// anchorAcId: AC-33103-1.
// Additional-result anchor: AC-33111-1 (driver.backend field
// present with the elicited answer on every returned driver).
// accountBound: false.

export const anchorAcId = 'AC-33103-1';
export const accountBound = false;

async function driveRoundTrip(driver, backendLabel) {
  await driver.put('k/hello', 'value');
  const got = await driver.get('k/hello');
  await driver.put('k/one', 1);
  await driver.put('k/two', 2);
  await driver.put('p/a', 'A');
  await driver.put('p/b', 'B');
  const listed = await driver.list({ prefix: 'p/' });
  await driver.delete('k/hello');
  const gone = await driver.get('k/hello');
  return {
    getOk: got === 'value',
    listSize: listed.size,
    listHasA: listed.get('p/a') === 'A' && listed.get('p/b') === 'B',
    deleteOk: gone === undefined,
    backendLabel,
    reported: driver.backend,
  };
}

export default async function runProbe() {
  const { prepareStorageDrivers } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/h2-cf-do-storage-round-trip-shim.mjs');
  const { createInMemoryDoStorage, mismatchDriver, mutationOn } = await prepareStorageDrivers();

  const results = [];

  const sqlDriver = createInMemoryDoStorage({ backend: 'sql' });
  const kvDriver = createInMemoryDoStorage({ backend: 'kv' });

  const sql = await driveRoundTrip(sqlDriver, 'sql');
  const kv = await driveRoundTrip(kvDriver, 'kv');

  const bothOk =
    sql.getOk && sql.listHasA && sql.listSize === 2 && sql.deleteOk && sql.reported === 'sql' &&
    kv.getOk && kv.listHasA && kv.listSize === 2 && kv.deleteOk && kv.reported === 'kv';

  results.push({
    anchorAcId: 'AC-33103-1',
    verdict: bothOk ? 'pass' : 'fail',
    detail: bothOk
      ? `both backends round-tripped: sql {get:${sql.getOk}, listSize:${sql.listSize}, delete:${sql.deleteOk}, backend:${sql.reported}}; kv {get:${kv.getOk}, listSize:${kv.listSize}, delete:${kv.deleteOk}, backend:${kv.reported}}`
      : `round-trip mismatch: sql=${JSON.stringify(sql)} kv=${JSON.stringify(kv)}`,
  });

  // AC-33111-1: default backend is sql when no arg is passed. Also
  // covers the driver.backend-field-present requirement across the
  // three driver openings above (sql, kv, default).
  const defaultDriver = createInMemoryDoStorage({});
  const defaultOk = defaultDriver.backend === 'sql' &&
    typeof sqlDriver.backend === 'string' &&
    typeof kvDriver.backend === 'string';
  results.push({
    anchorAcId: 'AC-33111-1',
    verdict: defaultOk ? 'pass' : 'fail',
    detail: defaultOk
      ? `driver factory without an explicit backend defaults to sql per ADR-3403 recommendedDefault (observed driver.backend=${defaultDriver.backend}); backend field present on every returned driver (sql=${sqlDriver.backend}, kv=${kvDriver.backend}, default=${defaultDriver.backend})`
      : `default backend mismatch: expected sql, observed ${defaultDriver.backend}`,
  });

  if (mutationOn) {
    // The shipped factory clamps any unrecognised backend answer to
    // sql; the mutation-run surfaces the observation and returns
    // fail so a reviewer can see the clamp in action. The shim
    // constructs the mismatch driver; the probe body reports it.
    const clampedButMismatched = mismatchDriver.backend === 'sql';
    results.push({
      anchorAcId: 'AC-33103-1',
      verdict: 'fail',
      detail: `mutation-run active (fixture shim reports backend-mismatch on): unrecognised backend answer clamped to ${mismatchDriver.backend} (clampedToSql=${clampedButMismatched}) instead of failing at the boundary`,
    });
  }

  return { results };
}
