// H-2 (h2-cf-platform-probe-integrity) fixture-side shim for the
// DO storage-round-trip probe.
//
// Moves the mutation switch that clamps a bogus backend answer out
// of the shipped probe body so the probe module holds zero env
// reads and zero mutation-run branches (AC-15401-1, mutation-purity
// rule from r7 precedent). The shim exposes a factory that opens
// the driver factory used for the round-trip drives (always the
// shipped one) plus a mismatch-driver factory that is populated
// only when the mutation switch is engaged. The probe body drives
// whichever pair comes back and reports the shape.
//
// Contract:
//   prepareStorageDrivers(): {
//     createInMemoryDoStorage,          // shipped factory
//     mismatchDriver,                    // null under the shipped
//                                        // path; a driver returned
//                                        // from a bogus backend
//                                        // answer under the
//                                        // mutation-run
//     mutationOn,                        // true when the mutation
//                                        // switch is engaged
//   }
//
// The shim reads the mutation env token internally so the probe
// body carries zero references to the mutation-switch env name.

import { createInMemoryDoStorage } from './src/do-storage.mjs';

export async function prepareStorageDrivers() {
  const mutationOn = process.env.SIMULATE_STORAGE_BACKEND_MISMATCH === 'true';
  const mismatchDriver = mutationOn
    ? createInMemoryDoStorage({ backend: 'not-a-real-backend' })
    : null;
  return { createInMemoryDoStorage, mismatchDriver, mutationOn };
}
