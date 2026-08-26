# The SPA blueprint: an operator's guide

This guide is for the human running the project, not the coding agent. It explains what applying this blueprint buys you, when it is the wrong tool, and what still needs your judgement afterwards.

## What this blueprint is

A specification package for single-page applications with public and authenticated surfaces, session-based auth, one deployable, dark and light by default, fully responsive by default. Applying it (`rcf define blueprint add <path>`) merges 64 namespaced documents into your RCF tree: 21 requirements, 28 user stories carrying 167 acceptance criteria, 6 architectural components, and 9 decision records. It also ships a design system: contrast-validated design tokens for both themes, a realising stylesheet, wireframes for the nine canonical surfaces, per-component behaviour contracts, a viewport table, and sample data.

The point, in one sentence: the visual and UX floor of your build becomes part of the specification, so the same build cycle that verifies your features also verifies that the product looks and behaves like someone cared.

## What it deliberately is not

- It is not code. No components, no framework choice, no test files. Your working agent implements tests from the ACs the same way it does for your own stories, and writes the application in whatever stack the project chose. (Blueprints shipping tests was considered and ratified out: adherence is expressed as ACs, decision 5 of the design brief.)
- It is not your product spec. It says every route must handle empty, loading, error, and success; it cannot know what your routes are. Elicitation still happens; this package is the floor under it.
- It does not ship FBS work items. FBSs are the work of the implementing agent, not the blueprint: build tasks have to be derived in the host project at creation time, where the project's own constraints, sequencing, and existing work apply. The blueprint contributes the WHAT (REQ/US/AC/TAC/ADR); your project derives the HOW.

## When to reach for it

Any project whose primary surface is a browser SPA: dashboards, admin panels, SaaS products, internal tools that deserve to feel like products. Compose it freely with an API blueprint; that composition is the intended shape.

## When it does not fit

- Server-rendered or content-first sites (marketing, docs): the routing and state decisions here assume a client-side application; a future static-site blueprint is the right home.
- Native or hybrid mobile shells: the breakpoints and target-size floors overlap, but the navigation and auth decisions do not transfer.
- Projects with a mandated design system: apply the blueprint for its behavioural ACs, then supersede the theming ADR and swap the token values; the parity and contrast ACs still hold and will validate your mandated palette.

## What a good outcome looks like

Walk any journey in the finished product and try to catch it looking abandoned: force an error, empty a list, expire the session mid-form, switch to dark, drop the network, tab through without a mouse, load it on a phone. A build that honours this doc set has a designed answer everywhere you poke. That is the measure: what the user sees out of the box, against how much was left for them to discover broken.

## Your decisions that remain open

1. Copy. Every empty state, error, and onboarding surface carries product-specific copy; the ACs require the template text be replaced (AC-1124-5).
2. The five global decisions. Routing, theming, client state, error envelope, auth model ship as accepted defaults. Disagree by superseding with a project-level ADR, not by editing the blueprint's files.
3. Composition conflicts. Adding a REST-style blueprint will surface deliberate conflicts on `errorEnvelope` and `authModel`. That is the mechanism working: resolve each with one project-level decision.
4. Key routes and journeys. The performance and journey ACs bind to inventories your project declares during elicitation. Declare them honestly; an empty journey inventory makes those ACs vacuously green and that defeats the point.

## Cost honesty

This doc set makes builds slower to declare done, on purpose: 167 criteria is the price of "no route ships half-dressed". If the project is a one-day throwaway, that price is wrong for you; skip the blueprint rather than opting out of half of it. If the project has users, the price is the product.
