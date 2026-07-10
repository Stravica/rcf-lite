# The RCF 5-stage build cycle

The normative statement of the cycle. Every FBS item is delivered by one pass of five stages, in this order, under these contracts. The spec bundle that `rcf build --next` emits carries the same cycle as its closing runbook, parameterised for the item in hand; if this page and a bundle ever disagree, the bundle is authoritative.

## The five stages

**1. Define.**
Entry: you hold the item's spec bundle. Exit: your plan is confirmed against every in-scope acceptance criterion in the bundle's section 4, and pickup is recorded with `rcf build <fbs-id> --mark inProgress`. Referee: the bundle itself, plus `rcf validate` on a clean tree.

**2. Build.**
Entry: a confirmed plan. Exit: the acceptance criteria are implemented, using the bundle's architectural context, with nothing beyond them; deviation from the bundle is escalation, not improvisation. Author or update Code Nodes (`rcf create cn --path <file>[#symbol] --acs <ac-ids>`) for the source as you write it - comprehension of which symbols serve which ACs is cheapest to capture now, and Stage 5 refuses completion without it. Referee: none at this stage beyond the bundle as the spec.

**3. Review.**
Entry: the implementation is complete. Exit: `rcf validate` comes back clean and the diff has been re-read against every in-scope acceptance criterion, with deviations documented. Referee: `rcf validate`.

**4. Test.**
Entry: a reviewed diff. Exit: TS / TC documents and the tests they point to exist for the in-scope acceptance criteria, and `rcf coverage --strict` covers them. Referee: `rcf coverage --strict`.

**5. Finalise.**
Entry: covered, reviewed work. Exit: CI green and the work merged per the driving workflow's convention, then `rcf build <fbs-id> --mark complete` after the merge and `rcf build <fbs-id> --mark verified` after post-merge verification. `--mark complete` refuses (exit 3, missingCodeNodes) if any in-scope acceptance criterion still carries no Code Node - go back to Stage 2, or declare `--no-code-nodes` for a genuinely no-code spec. Referee: CI, plus the mark commands' own refusals.

## Every stage commits

Each stage ends in a commit. The commit is the stage boundary: it makes the cycle auditable in history and keeps a failed stage cheap to unwind. A stage without its commit is not finished.

## The lifecycle is forward-only

`notStarted -> inProgress -> complete -> verified`. Forward jumps are legal. Backward transitions are refused with exit 4; the deliberate-correction escape hatch is `rcf update <fbs-id> --set executionStatus=<status>`, and reaching for it should be rare enough to be remarkable.

## Depth

This page is the contract. For per-stage guidance, failure modes, escalation rules and worked examples, fetch the `rcf_execute_build_cycle` prompt or read `build-cycle-playbook.md` in this directory.

---

Canonical reference: https://stravica.ai/rcf-methodology/build-cycle
