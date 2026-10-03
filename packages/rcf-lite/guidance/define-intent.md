# The product-owner intent loop

This document is the operator-side reference for the DEFINE step 3
intent-complete loop. It is the content of the `rcf_define_intent` MCP
prompt and the `rcf://docs/define-intent` resource. The agent reads it
once per session and drives the loop; the product owner never sees any
of it.

## The shape of a turn

A turn is four steps and nothing else.

1. Run `rcf define questions --persona productOwner` (or
   `rcf_define_questions` over MCP). The call returns the next question
   set from the readiness object. Nothing is stored for the loop; the
   tree, the four ledgers (`rcf/define/`) and the profile
   (`rcf/.identity/profile.md`) are the state.
2. Ask the first one to three questions in one group, in plain words,
   with the passage from the document quoted exactly. Never show more
   than one group at a time; never show ids, verbs or stage names
   unless the owner asks.
3. Run the write-back the question carries. Every question's
   `writeBack[]` names one command per answer kind; pick the one that
   matches the owner's reply and run it. The write-back is idempotent:
   running it twice does not change the tree.
4. Re-run `rcf define readiness --level intent` (or
   `rcf_define_readiness`). On exit 0 the loop is finished and you
   print the verdict (section below). On exit 4 the loop continues:
   go back to step 1.

The loop is monotone. Each answer removes its item or converts it into
at most two further product-owner items (an openQuestion promoted to a
decision asks `wellFormed` once if the harness under-fills it; a
statement resolved to a new REQ asks `reqHasUs` once). No engineer
edit can re-open the PO loop.

## The register

The first turn's first act is replacing the Register choice list in
`rcf/.identity/profile.md` with `productOwner` when the person
driving is the product owner. The profile is operator prose; you edit
it directly (no verb owns it). The same holds for the Surface choice
list.

The PO register has three wording rules.

- Plain sentences. No method terms. "What this is for" beats
  "capability statement". "Who uses this" beats "AC-18602-4 user story
  elicitation".
- Quote the passage. When the question is about a brief statement,
  quote the statement text in double quotes. The owner recognises their
  own words. "Your document says 'Officers can put a loan on hold.'"
  beats "statement 7".
- One group at a time. The question object groups by source span so
  the owner thinks about one passage before moving on. Never collapse
  two groups into one prompt.

## Starting a session

A product-owner session starts with `rcf define questions --persona
productOwner`. If the brief is empty, the only question the loop
returns is `brief:sinceFreeze`: hand me your document, or tell me in a
few sentences what this is for. Walk the folder with the intake prompt
(`rcf_define_intake`) first when the owner has supplied one; otherwise
take their sentences and feed them in through `rcf define ledger brief
add --text "<text>"`.

## Ending a session

When `rcf define readiness --level intent` returns ok, print exactly
these lines:

```
Intent-complete: yes.
Your document has been turned into N requirements with M user stories.
The engineer blockers remaining are K.
```

Then run `rcf define readiness --level intent --json` and save the
output beside the source folder as `<folder>.intent-complete.json`
(outside `rcf/`; readiness writes nothing itself). Commit the tree.
The Readiness tab URL is the artefact a delivery stream attaches.

## The engineer register

The same compute runs with `--persona engineer`: the question set is
the engineer blockers in failing stages, and its exit is
`levels.readyToBuild.ok`. Per-check question templates and per-check
write-backs for the engineer register are NOT part of DEFINE step 3
PR 2 (spec §1.1: "The engineer register is the same mechanism with
`--persona engineer`; it is not designed here beyond that flag and
is what step 4 inherits."). Until step 4 lands, the engineer-persona
questions return the shared compute shape with empty `writeBack` and
`answerKinds`; the harness reads the raw blocker and runs the
engineer verb that matches the check by hand.

## What the loop does NOT do

- No conversation state in rcf-lite. The tree, the ledgers and the
  profile are the state (ADR-4129).
- No separate findings list. Intake scan findings become
  `openQuestion` statements and the loop reads one check
  (`brief:openQuestions`) rather than two surfaces (ADR-4130).
- No stale title-hit fallback. A statement whose `resolvedBy` is a
  REQ id outside the closed grammar fails `skeleton:resolvedBy`; the
  question returns the title hit as a suggestion rather than the
  compute accepting it silently.
