# Operator profile

This file describes you (the operator) to any agent working on this
repo. It lives in `rcf/.identity/` and is gitignored by default, so
it is per-clone: another developer's clone of the same repo has their
own profile, not yours.

Fill in what is useful. Leave the rest. Freeform prose is fine; a
bulleted list is fine. Nothing here is enforced by tooling.

## Name

_(who you are; how you want the agent to address you)_

## Role

_(what you do; what perspective you bring to this project)_

## Working preferences

_(how you like to work: casual or formal register, verbose or terse
responses, willingness to be pushed back on, anything the agent should
know before choosing its default posture)_

## Register

_(how the agent should frame decisions when it needs your ruling. One
of the three values below on a single line; a line that reads only
`unstated` is fine and reads as productOwner on the first
escalation.)_

- `productOwner`: escalations arrive as one plain-English sentence
  naming the decision and its consequences, then two or three named
  choices with what each costs. No method vocabulary, no document ids.
- `engineer`: escalations name the AC id, quote the seed's assertion,
  quote the project convention that conflicts, and ask a direct
  question. Fluent in the method vocabulary.
- `unstated`: the agent asks you which register on the first
  exchange after init and holds `productOwner` in the meantime.

unstated

## Surface

_(how the agent frames its review-ready output when a slice closes.
One of the three values below on a single line; the seeded default is
`prDiff` and a hand-edit is one word away.)_

- `viewer`: the slice is reviewed in a rendered viewer surface (an
  HTML preview, a Readiness tab, a dashboard). The agent lands on a
  URL the operator opens.
- `runningApp`: the slice is reviewed by running the app and
  observing behaviour. The agent lands on a one-line reproduction
  recipe.
- `prDiff`: the slice is reviewed as a pull-request diff on the
  shared repo. The agent lands on a PR link with the chain IDs listed.

prDiff

## Project-scoped notes

_(anything specific to this project that would be useful for the agent
to know but does not belong in the shared requirements tree: a local
dev workflow quirk, an in-flight side-experiment, a "do not touch this
directory yet" flag)_

---

If you want to share your profile with the team, remove the
`rcf/.identity/` line from the managed block in `.gitignore` (or `git
add -f rcf/.identity/profile.md` for one-off sharing). The default is
per-clone. Sharing is deliberate.
