// H-2 (h2-cf-platform-probe-integrity) fixture-side shim for the
// kv cache-aside-hit-then-miss probe.
//
// Moves the SIMULATE_CACHE_MISS mutation switch out of the shipped
// probe body so the probe module holds zero env reads and zero
// mutation-run branches (AC-15401-1, mutation-purity rule from
// r7 precedent). The shim exposes a factory that returns either
// the shipped facade (the default) or a broken facade that no-ops
// on put (the mutation-run). The probe body just uses whatever
// comes back.
//
// Contract:
//   createCacheAsideFacade({ binding, eventSink }): { facade, mutationOn }
//     - Reads process.env.SIMULATE_CACHE_MISS at call time.
//     - When SIMULATE_CACHE_MISS === 'true', returns a facade whose
//       put is a no-op (the writeback path is disabled); every other
//       verb forwards to the shipped facade. mutationOn === true.
//     - Otherwise returns the shipped facade unchanged.
//       mutationOn === false.

import { createKvFacade } from './src/kv-facade.mjs';

export function createCacheAsideFacade({ binding, eventSink }) {
  const shipped = createKvFacade({ binding, eventSink });
  const mutationOn = process.env.SIMULATE_CACHE_MISS === 'true';
  if (!mutationOn) return { facade: shipped, mutationOn: false };
  const broken = {
    ...shipped,
    put: async () => {},
  };
  return { facade: broken, mutationOn: true };
}
