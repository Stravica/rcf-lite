// List-with-prefix probe for platform-cloudflare-kv v1.0.0.
//
// Puts 10 keys under the shared prefix flags/ through the facade,
// calls facade.list({prefix: flags/}), asserts all 10 return with
// correct metadata shape. Independent of the round-trip probe; the
// round-trip probe also covers this AC as an additional result but
// this probe carries the mechanism as a first-class case for
// US-31104.
//
// anchorAcId: AC-31104-1.
// accountBound: false.

export const anchorAcId = 'AC-31104-1';
export const accountBound = false;

export default async function runProbe() {
  const { createInMemoryKv } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-driver.mjs');
  const { createKvFacade } = await import('../../../../packages/rcf-lite/test/fixtures/cf-platform/src/kv-facade.mjs');

  const binding = createInMemoryKv();
  const facade = createKvFacade({ binding, eventSink: () => {} });

  for (let i = 0; i < 10; i += 1) {
    await facade.put(`flags/feature-${i}`, `on-${i}`, { metadata: { v: 1, i } });
  }

  // Also seed one key OUTSIDE the prefix to confirm it does not
  // appear in the listing.
  await facade.put('other/decoy', 'decoy', { metadata: { v: 1 } });

  const listed = await facade.list({ prefix: 'flags/' });

  const names = listed.keys.map((k) => k.name).sort();
  const expected = Array.from({ length: 10 }, (_, i) => `flags/feature-${i}`).sort();

  const namesMatch = names.length === 10 && names.every((n, i) => n === expected[i]);
  const metadataOk = listed.keys.every(
    (k) => k.metadata && typeof k.metadata === 'object' && k.metadata.v === 1 && typeof k.metadata.i === 'number',
  );
  const decoyAbsent = !names.includes('other/decoy');

  const pass = namesMatch && metadataOk && decoyAbsent;

  return {
    results: [{
      anchorAcId: 'AC-31104-1',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `list({prefix: flags/}) returned 10 keys under the prefix; every entry carries {name, metadata} with metadata.v=1; decoy key outside prefix was NOT included`
        : `list-with-prefix fault: namesMatch=${namesMatch} metadataOk=${metadataOk} decoyAbsent=${decoyAbsent} names=${JSON.stringify(names)}`,
    }],
  };
}
