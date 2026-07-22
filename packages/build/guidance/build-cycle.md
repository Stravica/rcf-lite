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
Entry: a reviewed diff. Exit: TS / TC documents and the tests they point to exist for the in-scope acceptance criteria, and `rcf coverage --strict` covers them. Every "verified" or "tested" claim made in this stage names the runtime it was checked against and never implies verification on a deployed runtime that was not exercised. Referee: `rcf coverage --strict`.

**5. Finalise.**
Entry: covered, reviewed work. Exit: CI green and the work merged per the driving workflow's convention, then `rcf build <fbs-id> --mark complete` after the merge, and `verified` written by the finalise gate (`rcf finalise <fbs-id> --url <deploy-url>`) once an independent post-merge verify run passes with ship authority. `--mark` caps at `complete` - it cannot write `verified`. `--mark complete` refuses (exit 3, missingCodeNodes) if any in-scope acceptance criterion still carries no Code Node - go back to Stage 2, or declare `--no-code-nodes` for a genuinely no-code spec. The PR body's verification section carries a runtime label on every claim. Referee: CI, the finalise gate, plus the mark commands' own refusals.

## Definition of done includes a working local preview

A build is not done until it also leaves a **working, documented local preview** as its default outcome - a dev server, seeded data where the app needs data to be usable, ideally started with one documented command. This is required whether or not the owner stated a hosting target: the local preview is the runtime the owner can always drive, and remote deployment is an addition on top of it, never a replacement for it.

## Every stage commits

Each stage ends in a commit. The commit is the stage boundary: it makes the cycle auditable in history and keeps a failed stage cheap to unwind. A stage without its commit is not finished.

## The lifecycle is forward-only

`notStarted -> inProgress -> complete -> verified`. Forward jumps are legal, but the `--mark` ladder caps at `complete`: `--mark verified` is refused with exit 4 and points to `rcf finalise`, because `verified` is written only by the finalise gate after an independent verify run. Backward transitions are refused with exit 4; the deliberate-correction / manual-override escape hatch is `rcf update <fbs-id> --set executionStatus=<status>`, and reaching for it should be rare enough to be remarkable.

## Depth

This page is the contract. For per-stage guidance, failure modes, escalation rules and worked examples, fetch the `rcf_execute_build_cycle` prompt or read `build-cycle-playbook.md` in this directory.

---

Canonical reference: https://stravica.ai/rcf-methodology/build-cycle
