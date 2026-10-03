# DISCOVERY home for prototypes

This document is the doctrine and the ledger conventions for
prototypes. It is served under the slug `discovery-prototypes`,
through `rcf://docs/discovery-prototypes`, and through the
`rcf_discover_prototype` prompt that wraps it with the walk.

The posture is ADR-4132: prototypes live in DISCOVERY as evidence;
code is burned; salvage is re-derivation.

## What a prototype is

An elicitation instrument built in DISCOVERY to learn what to ask.
It is recorded in the intake classification as an artefact of kind
`other` with the prototype's name. The prototype belongs to
DISCOVERY, not DEFINE: it is a tool for learning, not a draft of
what gets built.

## What is recorded

Its outputs are brief statements with source spans
`prototype:<name>:<observation>`:

- Capabilities: what people did with it.
- Constraints: what they refused or asked for.
- Open questions: what it raised that the brief had not.
- Out of scope: what it was never allowed to do.

Reactions that need a ruling become decisions with options and a
default. The intent-complete loop then reads one check
(`brief:openQuestions`) and the owner answers in one place; the
prototype's observations ride the same ladder as every other brief
statement.

## What is burned

The code. The burn is one brief statement, kind `constraint`:

> Prototype <name> (commit <sha>, burned <date>) is reference only;
> no code from it is promoted.

The build that follows starts from the tree, never from the
prototype. The brief ledger holds the burn statement alongside the
other statements the prototype produced; nothing further is said in
code or in configuration.

## Salvage by re-derivation

The only middle path. Extract requirements from a promising
prototype as evidence (statements sourced to its files and lines),
run them through intake and the PO loop like any document, and
rebuild from the tree. The prototype is a quarry.

"Grow the prototype" is named here as rejected, with the provenance
reason from Dex's note: a shape reaching the project tree without
the PO loop that owns every settled shape is a shape without a known
origin, and no amount of auditing after the fact can restore the
owner.

## The managed-block rule

The managed block gains one rule the harness picks up through
`rcf doctor`:

> A statement sourced to `prototype:` is evidence. A document that
> cites prototype code as its implementation is a D2 finding the
> engineer resolves by re-deriving.

That rule is prose; no check is added in 0.30.0.
