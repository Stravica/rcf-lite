# RCF overview

The Requirements Confidence Framework (RCF) is a document model and a build method. It keeps every piece of shipped work connected, through explicit documents on disk, to the requirement that asked for it and the test that verifies it. The `rcf` CLI referees that structure mechanically; the agent and the human operating the loop supply the judgement.

## The confidence gap

AI-driven development produces working code faster than a human can check it against intent. The result is a gap: the code runs, the tests pass, and nobody can say with confidence which stated requirement each change serves or whether every requirement is actually verified. RCF closes that gap structurally. Requirements, stories, acceptance criteria and tests are documents with typed references, so "does this code serve a requirement?" becomes a query, not an act of faith.

## The document hierarchy

```
PRD -> REQ -> US / AC -> TAC / ADR -> BS / FBS -> TS / TC
```

- **PRD** - the product intent: the problem, who has it, what changes when it is solved.
- **REQ** - one testable capability the product must have.
- **US / AC** - a user story under a requirement, carrying acceptance criteria: observable, testable statements of done.
- **TAC / ADR** - the architecture as components (TAC) and decisions (ADR), referenced by the work that depends on them.
- **BS / FBS** - the build sequence and its functional build specifications: the ordered queue of work items, each scoped to a set of acceptance criteria.
- **TS / TC** - test suites and test cases, each pointing at the acceptance criteria they verify.

The full per-type detail is in `rcf://docs/document-model`.

## The three traceability questions

Every RCF query is one of three questions:

1. **Is it covered?** Does every acceptance criterion have a test case pointing at it? (`rcf coverage`)
2. **What does it trace to?** Which requirement asked for this; which stories, criteria and tests hang off it? (`rcf trace`)
3. **What breaks if it changes?** Which documents and tests are invalidated by a change to this one? (`rcf impact`)

## The build cycle in five lines

1. **Define** - confirm the plan against every in-scope acceptance criterion in the spec bundle.
2. **Build** - implement to those criteria and nothing beyond them.
3. **Review** - validate the tree, then re-read the diff against every in-scope criterion.
4. **Test** - write tests until strict coverage holds over the in-scope criteria.
5. **Finalise** - CI green, merge, then record the lifecycle transition.

Every stage ends in a commit. The normative statement is `rcf://docs/build-cycle`; the deep guidance is the `rcf_execute_build_cycle` prompt.

## Mechanical, not semantic

The tool referees structure, never adequacy. `rcf validate` proves every document matches its schema and every reference resolves; `rcf coverage` proves every acceptance criterion has a test case pointing at it. Neither proves that the acceptance criteria capture the requirement's intent, or that a test asserts the right behaviour. That judgement belongs to the agent and the human operating the loop. The tool's contribution is to make the structural half of confidence mechanical, so judgement is spent only where judgement is needed.

---

Canonical reference: https://stravica.ai/rcf-methodology/overview
