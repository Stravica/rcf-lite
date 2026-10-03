# Recording a prototype in DISCOVERY

This document is the content of the `rcf_discover_prototype` MCP
prompt served argument-free by the server. It walks the agent
through the only path a prototype takes into the chain: as evidence,
with code burned, and with salvage by re-derivation.

The posture is ADR-4132. The code of a prototype is reference only;
no shape in the project tree is promoted from it. The whole worth of
the method is that every requirement, story, AC and shape has a
known origin, and a promotion path would smuggle unowned choices
past the chain.

## What a prototype is

An elicitation instrument built in DISCOVERY to learn what to ask.
It is recorded in the intake classification as an artefact of kind
`other` with the prototype's name.

## What is recorded

The prototype's outputs are brief statements with source spans
`prototype:<name>:<observation>`:

- Capabilities: what people did with it.
- Constraints: what they refused or asked for; what they would not
  do without.
- Open questions: what the prototype raised that the brief had not.
- Out of scope: what the prototype was never allowed to do.

Reactions that need a ruling become decisions with options and a
default (the enumerated form D7 reads).

## What is burned

The code. The burn is one brief statement, kind `constraint`:

> Prototype <name> (commit <sha>, burned <date>) is reference only;
> no code from it is promoted.

The build that follows starts from the tree, never from the
prototype. The constraint sits beside the capabilities and open
questions the prototype produced; the chain reads them all through
the same `brief:openQuestions` / `skeleton:resolvedBy` loop as any
document.

## Salvage by re-derivation

The only middle path. Extract requirements from a promising
prototype as evidence (statements sourced to its files and lines),
run them through intake and the PO loop like any document, and
rebuild from the tree. The prototype is a quarry.

"Grow the prototype" is rejected. The provenance reason is the one
Dex's note gives: a shape reaching the project tree without the PO
loop that owns every settled shape is a shape without a known
origin, and no amount of auditing after the fact can restore the
owner.

## The managed-block rule

A statement sourced to `prototype:` is evidence. A document that
cites prototype code as its implementation is a D2 finding the
engineer resolves by re-deriving. That rule is prose; no check is
added in 0.30.0, and the engineer running D2 sees the finding
through the same `skeleton:resolvedBy` surface that reports every
other pointer.
