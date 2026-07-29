# Pending test cases

Register of acceptance criteria with **no** Test Case, produced by the
assertion-level audit of all 76 ACs against the existing test corpus
(w-2026-07-28-005 step 4) and worked down by the coverage-tail pass
(w-2026-07-29-014 / w-2026-07-29-015). A TC binds an AC only when an
existing test genuinely asserts the AC's *outcome* - a test that merely
exercises the same module does not count. Each row says what a
sufficient test must assert, and names the nearest existing test where
one exists.

Of the original 14 rows: the 4 AC-drift rows were resolved by operator
ruling (AC text revised to the deliberate design, then bound) and 9
assertion gaps got their tests written and bound. One row remains.

Status: **75 bound / 1 pending** of 76 ACs. `rcf coverage --strict`
exits 4 while any row below remains.

| AC | US | Kind | What a sufficient test must assert | Nearest existing test |
|---|---|---|---|---|
| AC-502-2 | US-502 | feature gap | FBS items with no dependency between them are reported as **parallel-safe**. The AC is right (operator ruling 2026-07-29): the build sequence should show which FBSs can execute in parallel. No such surface exists in build-lite - the queue exposes per-item actionable state only. Forensics (w-2026-07-29-015): the feature was SPECIFIED here (TAC-005 declares a `buildOrder` interface computing "parallel-safe groups"; FBS-010 lists "Topological build order with parallel-safe groups" as a deliverable, and is marked complete) but Phase 6 shipped the queue without it; it is fully implemented in the full RCF platform (rcf-tools `computeTiers` / `parallel-opportunities` / build-graph tier groupings). Resolution: complete the specified surface (port the tier computation, expose it via `rcf build`), then bind a test asserting two independent items land in the same parallel-safe group. | `test/build/queue.test.js::complete AND verified dependencies both satisfy (D2 rule 2)` (two items actionable, not asserted as such) |
