# Pending test cases

Register of acceptance criteria with **no** Test Case. A TC binds an AC
only when an existing test genuinely asserts the AC's *outcome* - a
test that merely exercises the same module does not count. An AC that
cannot yet be honestly bound is registered here as a row, never stubbed
as a TC.

The register is empty. The assertion-level audit of all 76 ACs
(w-2026-07-28-005 step 4) opened it with 14 rows; 4 AC-drift rows were
resolved by operator ruling (AC text revised to the deliberate design,
then bound), 9 assertion gaps got their tests written and bound
(w-2026-07-29-014 / w-2026-07-29-015), and the final row - AC-502-2,
a genuine feature gap - was closed by porting the parallel-safe tier
computation from the full RCF platform into the build queue and binding
TC-014-independent-items-share-tier to it.

Status: **76 bound / 0 pending** of 76 ACs. `rcf audit coverage --strict`
exits 0, and CI runs `rcf define validate` and `rcf audit coverage --strict` as
required steps, so a new uncovered AC or a non-resolving testPointer
fails the build. A future genuine gap gets a row here (AC id, US, kind,
what a sufficient test must assert, nearest existing test) until its
test lands.
