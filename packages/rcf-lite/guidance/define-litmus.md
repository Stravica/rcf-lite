# Litmus: landing n fresh-context readings at the current hash

This document is the content of the `rcf_define_litmus` MCP prompt
served argument-free by the server. The agent reads it once per
session and runs the litmus pass when the operator or the readiness
verb asks for it.

## What a litmus reading is

A litmus reading is a probe-ledger entry whose `finding` field begins
`litmus:<reader>:` and whose text includes the current tree hash. It
is written by `rcf define ledger probes add` just like any other
probe-ledger entry; the `litmus:` prefix is what the verb reads back
when it counts "distinct readers at this hash".

The number of distinct readers is counted across the probe ledger; a
reader id appears at most once in the count regardless of how many
`litmus:<reader>:*` entries it has written.

## When to run

Run this prompt whenever a verb reports the shortfall:

- `rcf define readiness --litmus <n>` exits 4 and prints a `[warn]`
  line naming the current hash and the number of distinct readers
  found. The shortfall is the number of fresh-context readers you
  still owe before the verb will exit 0.
- `rcf define freeze --litmus <n>` refuses (exit 4) with the same
  reason and writes nothing. The freeze is only legal when n distinct
  readers have attested at the hash the verb was asked to freeze.

The harness is the runner. rcf-lite does not spawn processes and does
not make network calls at runtime. You spawn the readers; they land
the entries.

## The shape

Each reading is one `rcf define ledger probes add` call:

```
rcf define ledger probes add \
  --req <reqId> \
  --finding "litmus:<reader>: <one-line observation at hash <hash>>" \
  --severity low
```

Fill in:

- `<reader>` is a short id for this reader. Make it unique per fresh
  context (for example `reader-01`, `reader-02`). The verb counts
  distinct readers by this id.
- `<reqId>` is the REQ the reader is probing. On a readiness pass this
  is typically the first failing REQ or a REQ the operator named; on a
  freeze the ids come from the brief.
- `<hash>` is the current tree hash. Read it from
  `rcf define readiness --json` under `tree.currentTreeHash` (or from
  the `[warn]` line the verb printed).

A reading is "at the hash" when the `hash` substring appears anywhere
in the finding text, not in a separate field. Keep the hash in the
finding text so the entry is self-describing.

## The loop

1. Read `tree.currentTreeHash` from `rcf define readiness --json`.
2. Spawn n fresh-context readers (one claude session per reader is
   enough; a reader must not share context with another).
3. Each reader lands one `litmus:<reader>:` probe-ledger entry at the
   hash. The entry's finding text includes the hash and one
   observation; the reader does not edit the tree.
4. Re-run the verb that asked for `--litmus <n>`. The count is now
   n and the verb exits 0 (readiness) or writes the freeze record
   (freeze).

If the tree changes while the readings are being landed, the hash
moves and the earlier readings no longer count. Hand the readers a
hash that will still be current when the last reading lands; a short
freeze-prep window is the common case.

## When n distinct readers have attested

The verb exits 0. Nothing else is said; the readings stay in the probe
ledger. A later tree change makes them stale and the next invocation
of the verb will require fresh readings at the new hash.
