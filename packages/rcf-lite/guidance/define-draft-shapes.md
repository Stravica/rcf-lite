# Drafting the engineer's entry shapes

This document is the content of the `rcf_define_draft_shapes` MCP
prompt served argument-free by the server. The agent reads it once
per session and runs the draft pass alongside the PO loop. The
product owner may or may not be in the room; the agent populates
`[draft]`-marked entities, components and interfaces so the engineer
walks into a tree whose shape is honest about what is still owed.

## When to run

Run this pass in parallel with the product-owner intent loop and
reconcile when Intent completes (ruling R3 2026-10-05 under
w-2026-10-05-dave-001). Nothing in the draft pass changes the PO
question set, so drafting shapes while the owner answers questions
cannot destabilise the loop or create a question that was not there.
The draft pass reads only the brief ledger, the decisions ledger and
the current tree; it writes only `[draft]`-marked content.
`shapes:draftSettled` then lists exactly what the engineer has yet to
own. When Intent completes (`rcf define readiness --level intent`
prints `levels.intentComplete.ok === true`), the drafts are already
in place and the engineer walks into them.

Nothing in the draft pass can fail a product-owner check. That is the
property that keeps L1 and the draft pass independent. If an edit
would fail any check in the `productOwner` persona, stop and raise it
back to the intent loop (it was not an engineer-only question).

## The three homes

The `[draft]` marker lives on three homes in 0.30.0. The agent writes
to all three; `shapes:draftSettled` reads back from all three.

- `TAD.dataArchitecture.coreEntities[].description` begins `[draft]`
  for every entity minted from an `entity` statement. The marker
  reports under id `TAD.entity:<name>`.
- `TAC.purpose` begins `[draft]` for every TAC stub minted from a
  `surface` or `externalSystem` cluster. The marker reports under id
  `<tacId>`.
- `TAC.interfaces[].description` begins `[draft]` for every interface
  pre-populated inside a draft stub. The marker reports under id
  `<tacId>:<name>`.

Each marker is `[draft]` followed by a space and the one-sentence
seed body. Leading whitespace is tolerated by the reader; keep the
marker at the start of the string regardless.

## The four writes

Walk the brief in this order; each step writes `[draft]` content only.

1. One `TAD.dataArchitecture.coreEntities[]` entry per `entity`
   statement. `description` begins `[draft]` and quotes the
   statement's source so the engineer can trace it. Use the statement
   text to pick a name in UpperCamel; the engineer renames when the
   entity is owned.
2. One TAC stub per `surface` or `externalSystem` cluster when no
   TAC exists for it. `purpose` begins `[draft]`; `responsibilities`
   lists the statements the surface or external system serves (one
   bullet per statement, in the brief's words). Pick a `tacId` of the
   next free number and a descriptive slug; the engineer renames when
   the TAC is owned.
3. On each draft TAC, `[draft]` interfaces with real kinds from the
   closed vocabulary (`recordShape`, `httpRoute`, `event`,
   `cliCommand`, `uiRoute`, `port`, `fileFormat`, `fixture`,
   `other`). Draft one of each kind the surface uses:
   - a `recordShape` per entity the surface owns, with `fields:`
     guessed from the brief;
   - a `uiRoute` per surface;
   - an `httpRoute` per exchange with an external system.
   `description` begins `[draft]` with the one-line what-this-is.
4. `rcf discover req-classify` over every REQ created in the loop, so
   `skeleton:reqShape` passes where the classifier is confident and
   the engineer sees only the rest. The classifier is already
   available under `src/review/` or `src/discover/`; this prompt only
   invokes it.

## The read-back

After the pass, run `rcf define readiness --json` and read
`stages[].checks[]`. `shapes:draftSettled` is the engineer's entry
list: every id it names is a shape the agent pre-populated and the
engineer still has to settle. `shapes:tacHasInterface` and
`shapes:kindVocabulary` have already applied to drafts, so an empty
`shapes:tacHasInterface` finding means every stub carries at least
one interface and an empty `shapes:kindVocabulary` finding means
every interface's kind is in the closed vocabulary. The template
marker check and the entity join arrive in a later PR; the draft
pass does not need them to be honest about what is drafted.

Hand over by naming the three id forms the engineer will see
(`<tacId>:<name>`, `<tacId>`, `TAD.entity:<name>`) and the one verb
they will run to walk them (`rcf define readiness`). Nothing further
is said; the engineer owns the ladder from here.
