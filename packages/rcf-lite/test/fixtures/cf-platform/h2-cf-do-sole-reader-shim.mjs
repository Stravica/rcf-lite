// H-2 (h2-cf-platform-probe-integrity) fixture-side shim for the
// DO sole-reader-scan probe.
//
// Moves the mutation switch that seeds a synthetic non-facade
// consumer out of the shipped probe body so the probe module holds
// zero env reads and zero mutation-run branches (AC-15401-1,
// mutation-purity rule from r7 precedent). The shim exposes a
// factory that produces either the shipped file set (the default)
// or the file set plus a scratch-side leaker written into a
// throwaway directory outside the applied source root (the
// mutation-run). The probe body treats both paths identically:
// scan the returned files, report the leaks.
//
// Contract:
//   prepareSoleReaderScan({ files }): {
//     files,       // possibly-augmented file set to scan
//     mutationOn,  // true when the mutation switch is engaged
//     cleanup,     // async function; removes the scratch tree
//     leakerPath,  // null under the shipped path; the synthetic
//                  // consumer path under the mutation-run
//   }
//
// The shim reads the mutation env token internally so the probe
// body carries zero references to the mutation-switch env name.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export async function prepareSoleReaderScan({ files }) {
  const mutationOn = process.env.SIMULATE_NON_FACADE_IMPORT === 'true';
  if (!mutationOn) {
    return { files: files.slice(), mutationOn: false, cleanup: async () => {}, leakerPath: null };
  }
  const scratch = resolve(tmpdir(), `h2-cf-do-sole-reader-scratch-${process.pid}-${Date.now()}`);
  await mkdir(scratch, { recursive: true });
  const leakerPath = join(scratch, 'leaky-consumer.mjs');
  await writeFile(
    leakerPath,
    'export function leak(env) { return { cell: env.CELL, hub: env.HUB }; }\n',
    'utf8',
  );
  return {
    files: files.concat([leakerPath]),
    mutationOn: true,
    async cleanup() {
      await rm(scratch, { recursive: true, force: true });
    },
    leakerPath,
  };
}
