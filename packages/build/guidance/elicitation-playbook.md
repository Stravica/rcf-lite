# Elicitation playbook

## 1. Read this if

You are the agent starting a project with a human. The end state is concrete: a validated RCF tree (PRD, requirements, stories with testable acceptance criteria, architecture captured as TAC / ADR) and an actionable FBS queue, reachable in one or two sittings. When you finish, `rcf validate` is clean and `rcf build --next` hands back a real work item.

This is the lite tier of the elicitation method: one operator voice, one agent, blank directory to first build loop. Section 9 states plainly what sits above this tier; section 11 states the integrity rules that hold across the whole conversation - read it, the failures it forecloses are quiet ones.

Every command and output shown below is real, captured against a scratch project scaffolded with `rcf init`.

## 2. The method in one view

Decomposition order, one conversation level at a time:

```
intent            -> PRD
capabilities      -> REQ (per capability)
per REQ           -> US (who wants it and why)
per US            -> AC (testable statements of done)
before any stack  -> deploy target (where it runs) -> ADR (section 6)
as it emerges     -> TAC / ADR (architecture, captured or authored)
then              -> BS / FBS (the ordered build queue)
```

Write documents as you go with `rcf create` and `rcf update`; do not batch the tree up in your head for one big write at the end. Run `rcf validate` after every level. Start from the scaffold:

```
$ rcf init --project-name "Field notes" --non-interactive
RCF project created.
  Document chain     scaffolded under rcf/ - PRD, requirement, story, acceptance criterion, architecture and build-sequence placeholders for your agent to fill in.
  MCP server         registered in .mcp.json.
  Agent instructions written to CLAUDE.md and AGENTS.md.
```

The scaffold gives you valid placeholder roots (PRD, TAD, BS) plus one placeholder REQ / US / TAC / ADR / FBS chain; you replace placeholder content as the conversation fills it in.

## 3. Framing the product (PRD)

Question frames:

- What problem does this solve? Describe the moment it hurts.
- Who has that problem? Be specific enough that we could find one of them.
- What changes for them when this exists?
- What is deliberately out? Name two things this product will not do.

The good-enough bar for a lite PRD: a named problem, a named user, a stated change, and an explicit out-of-scope list. One paragraph each. Resist the urge to draft a vision document; the PRD's job here is to give every requirement below it something to trace to.

## 4. Drawing out requirements (REQ)

Question frames:

- What must the product be able to do for the PRD's change to happen? List capabilities, not features.
- For each capability: how would we know it works? (If no answer survives, it is not yet a requirement.)
- Which of these are must-have for first use, and which can wait?
- Are any of these really constraints (performance, security, compatibility) rather than capabilities? Capture those as non-functional requirements.

One testable capability per REQ. Capture `category` (functional or non-functional), `priority` and a `rationale` that records why the requirement earns its place, in the operator's terms.

Decomposition heuristics. Too big: the REQ needs "and" to state ("capture and search and tag notes" is three). Too vague: no observable behaviour survives questioning ("the product should be fast" becomes a non-functional REQ only once "fast at what, measured how" has an answer). A REQ that resists both splits and sharpening usually belongs in the PRD's out-of-scope list instead.

```
$ rcf create req --parent PRD-001 --title "Capture a note from the command line"
REQ-002 created at rcf/requirements/req-002.json
```

The created document carries a TODO description and default category / priority values; replace the description and add the rationale with `rcf update` before moving on. TODOs left in place are honest, visible debt, but a REQ still wearing its defaults is not yet elicited.

## 5. Stories and acceptance criteria (US / AC)

Question frames per REQ:

- Who, exactly, is the person or system exercising this capability? (`asA`)
- What do they do? (`iWant`)
- Why do they bother? (`soThat`)
- Walk me through one concrete use, start to finish. The walk-through is where ACs come from.

```
$ rcf create us --parent REQ-002 --title "Capture a note in one command" --from-file story.json
US-201 created at rcf/user-stories/us-201.json
```

(`story.json` carried the asA / iWant / soThat fields; `--from-file` merges body fields the flags do not cover.)

The testable-AC quality bar, applied to every AC before it lands:

- **Given / when / then**, each clause filled in.
- **An observable outcome.** The `then` names something a test could inspect: a file exists, an exit code, an error naming the id. Not a state of mind.
- **One behaviour per AC.** If the `then` needs "and" between two different outcomes of two different actions, split it.
- **`testable: true` means a machine could check it.** Read the AC as a test skeleton; if you cannot see the assertion, rewrite the AC.

```
$ rcf create ac --parent US-201 --description "Adding a note creates a note file and exits 0" --from-file ac.json
AC-201-2 created at rcf/user-stories/us-201.json
```

(ACs live inside their story's file; `ac.json` carried the given / when / then.)

Anti-patterns, each with the fix:

- **Compound ACs.** "Notes are saved and searchable and synced" is three ACs wearing one id. Split.
- **Untestable adverbs.** "Quickly", "intuitively", "gracefully". Replace with a measure or delete: "within 2 seconds" is testable; "quickly" is a mood.
- **Implementation-shaped ACs.** "Uses SQLite for storage" is an ADR, not an AC. The AC states the behaviour ("a note survives a restart"); the architecture decision goes where architecture decisions go (section 6).

The same criterion, failing and passing the bar:

```
Fails:  "Notes are captured quickly and reliably."
        (two behaviours, two untestable adverbs, no observable outcome)

Passes: given a running archive,
        when note add "text" runs,
        then a note file exists containing the text and the command exits 0.
```

The failing version is what operators say; the passing version is what you write down. The translation is the job.

### Depth: one AC is not coverage

The quality bar above makes a single AC well-formed. It does not make a story covered. ACs are the real shape of the application: no AC, no guarantee the work gets done, or gets done a particular way - an unstated scenario is one the build is free to get wrong. A story with one happy-path AC ships a happy-path-only feature, and the gaps surface later as bugs (which then trace straight back here - see the build-cycle playbook's bug-triage section). So for each story, do not stop at the first AC. Sweep its scenario classes and write an AC for every one the story actually has:

- **Happy path.** The main success case, stated as above.
- **Edges.** The boundaries and awkward-but-valid inputs: empty, one, many, maximum, duplicate, already-exists, out-of-order. Each edge the feature will really meet is an AC.
- **Failure paths.** What happens when it goes wrong: bad input, a missing precondition, a conflict, a not-found. "Fails" is not an outcome; name the observable one - an exit code, a structured error naming the thing, a left-unchanged state. A silent or undefined failure is a gap, not a non-requirement.
- **Non-functional, where the story has one.** A constraint that has to hold: a latency or size bound, a permission rule ("only the owner can read it"), a durability guarantee ("survives a restart"). Capture it as an AC on the story if it is local to this behaviour, or as a non-functional REQ (section 4) if it is system-wide. Do not invent constraints the operator never implied - but do ask, because these are the ACs operators most often leave unsaid.

The four questions to run per story: what is the success case? what are its boundaries? how does it fail, and what is observable when it does? is there a constraint - speed, permission, persistence - that must hold? One AC per answer that has one. If the operator gives a thin answer ("it just searches"), press once - "what should it do when nothing matches? when the query is empty?" - rather than banking the happy path and moving on. Thin answers accepted without pressing are the single biggest source of thin AC sets.

The judgement call is depth, not exhaustiveness: a note-capture command does not need a concurrency AC; a shared multi-user store does. Cover the scenarios the story genuinely has, and no more. A story that resists having any edge or failure case is a signal too - either it is trivially small, or it has not been questioned hard enough yet.

**Worked example - a thin AC set versus an adequate one.** Story: as a note keeper, I want to search my notes by keyword, so that I can find one without scrolling.

The thin version, what a shallow pass produces - one AC, happy path only:

```
AC-301-1  given notes exist,
          when I search for a keyword some note contains,
          then the matching notes are listed.
```

That is well-formed and useless as a spec: it says nothing about no-match, an empty query, or match rules, so the build is free to crash on an empty query and still pass its one AC. The adequate set covers the story's real scenarios:

```
AC-301-1  (happy)   given notes exist,
                    when I search for a keyword some note contains,
                    then every note containing it is listed and the command exits 0.

AC-301-2  (edge)    given notes exist but none contains the keyword,
                    when I search for it,
                    then an empty result is shown and the command exits 0 (not an error).

AC-301-3  (edge)    given a keyword several notes contain,
                    when I search for it,
                    then all matches are listed, most-recent first.

AC-301-4  (failure) given any state,
                    when I search with an empty query,
                    then the command exits non-zero with a message naming the missing query, and lists nothing.

AC-301-5  (nfr)     given a store of 10,000 notes,
                    when I search,
                    then results return within 1 second.
```

Same story, one AC versus five. The extra four are not gold-plating - they are the boundaries and failures the feature will meet on its first real day, and AC-301-5 is the constraint the operator would have assumed and never said. That set is the difference between a spec the build can satisfy blind and a spec that only looks finished.

## 6. Capturing architecture as it emerges (TAC / ADR)

### Establish where it will run first, before any stack

The deploy target is the first architectural question and it is asked **early - before any technology stack is named or committed.** "Where will this app actually run once it is built?" comes before "what shall we build it with", not after, and never by silent inference. This is a load-bearing decision made for an owner who usually cannot judge it: a stack chosen before the host is known is a stack that may have no host, discovered only at deploy, when it is most expensive to unwind.

- **Ask it as its own item, early.** Put the deploy-target question in the conversation before the architecture takes any concrete shape. A one-line answer ("it lives on my Cloudflare account", "I've got Netlify", "it runs on my own machine") is enough to constrain everything downstream.
- **Constrain the stack to the answer.** Once the target is known, the stack you choose (section below) must be one that target can actually host. Do not commit a stack the host cannot run - a Node-and-native-module stack on a Cloudflare-only account is the exact dead-end this rule exists to foreclose. If the only good stack for the app is incompatible with the stated host, that is a tradeoff to surface (section 11), not a silent override.
- **Capture it as an ADR on the project's own tree.** Record the deploy target and the stack constraint it implies as an ADR, so the decision is visible and revisable rather than buried in the agent's head. `rcf create adr --parent TAD-001 --title "Deploy target: <where> - stack constrained to <what it can host>"`.

### When the owner does not know: the hosting-choice walkthrough

Many owners will not know their options. When the deploy-target question is reached and the owner does not know where the app will run, **do not choose silently and do not choose on technical merit alone** - run a plain-language hosting-choice walkthrough and let the owner make the call.

- **Explain the options in plain language, no unexplained jargon.** Describe the realistic hosting choices for this kind of app in terms the owner can act on: what runs where, what each costs in effort and money, what each rules in or out. If a term has to appear ("static site", "serverless", "container"), define it in a phrase. A bare "pick a provider" freezes a non-expert; a walked choice does not.
- **Cover configuring the account, not just naming a provider.** The walkthrough continues past "which provider" into standing the account up: creating the account, generating the tokens or keys the deploy needs, and the CLI setup that connects the local project to it. Naming a provider and stopping leaves the owner exactly as stuck as before.
- **Isolate the human-only steps and name them honestly.** Sign-ups, billing and payment details, token generation, and CLI authentication are the account-holder's to do - they cannot be done by the agent and must not be pretended. Name each such step plainly as "this one is yours to do, here is exactly what to click", pause for the owner to do it, and continue. Never perform these silently, and never claim to have done something only the human can do. (This is the run-03 impersonation-refusal posture: the honest boundary is stated, not blurred.)

Which document: a **TAC** is a lasting component - it has a purpose, responsibilities and interfaces ("the note store", "the CLI surface"). An **ADR** is a decision - it has a context, a decision and consequences ("notes are plain files on disk, not a database"). A statement about what exists is a TAC; a statement about what was chosen, where an alternative existed, is an ADR.

Minimum capture: a TAC needs its purpose and responsibilities; an ADR needs context, decision and consequences, plus the alternatives considered and why each was not chosen. One honest sentence per field beats a page of hedged ones.

```
$ rcf create tac --parent TAD-001 --title "Note store"
TAC-002 created at rcf/tacs/tac-002.json
$ rcf create adr --parent TAD-001 --title "Notes are plain files on disk"
ADR-002 created at rcf/adrs/adr-002.json
```

**When the operator gives no architectural direction, author it yourself.** Do not leave the TAD hollow because nobody dictated an architecture. The default authoring move:

- Derive the TAC set from the capability domains in the REQ / US tree: the nouns that keep recurring (store, capture surface, search) are your components. Give each a purpose, responsibilities and the interfaces its neighbours rely on.
- Record an ADR for every consequential stack or structure choice you make: language, storage shape, process model, anything a future maintainer would ask "why is it like this?" about. Fill context, decision and consequences honestly, including the costs; list the alternatives you actually considered and the real reason each lost.
- Populate the TAD's required sections to the standard an engineering reviewer would respect: someone who has never spoken to you should be able to read the TAD set and build to it.

The boundary: author the architecture, but do not improvise a formal design method. Trade-off scoring frameworks, architecture evaluation techniques and alternatives-weighing systems are the Define/Spec product's territory (section 9). Your ADRs record the judgement you exercised; they do not need a methodology to justify it.

## 7. Building the queue (BS / FBS)

Group ACs into FBS items. One FBS is a coherent deliverable, buildable in one sitting: it should read as one work order, not a grab bag. ACs from the same story usually travel together; an FBS spanning many stories is a split candidate.

- **`buildOrder` follows dependency order.** What must exist first goes first. The scaffolded BS defaults to `dependencyFirst`; the other strategies are `verticalSlice` (one thin end-to-end path first), `domainGrouped` (finish each domain before the next) and `riskFrontLoaded` (the scary items first, while there is still time to react). Choose in one line, in the BS's own fields, and move on.
- **`dependsOnFbsIds` honesty.** Declare a dependency when the item genuinely cannot be built first, and only then. Padded dependencies serialise a queue that could have parallel work; missing ones hand the build loop a lie.
- **Sizing bands.** `small` is roughly an hour to half a day (1-4h), `medium` half a day to a day (4-8h), `large` one to two days (8-16h). The schema caps `estimatedHours` at 16: an item that wants more is two items.

```
$ rcf create fbs --parent BS-001 --title "Note capture command" --acs AC-201-2
FBS-002 created at rcf/fbs/fbs-002.json
```

## 8. When to stop

The done-bar, all five together:

1. Every REQ has at least one US.
2. Every US has at least one testable AC.
3. The queue's head item is actionable: `rcf build` shows a `Next actionable` id.
4. `rcf validate` is clean.
5. `rcf coverage` has been run and its zero-covered baseline is understood.

Queue-head evidence from the scratch project:

```
$ rcf build
# Build queue: BS-001 - Initial build sequence

Generation strategy: dependencyFirst

| order | id | title | status | state | blocked by |
|---|---|---|---|---|---|
| 1 | FBS-001 | TODO: name this build session | notStarted | actionable |  |
| 2 | FBS-002 | Note capture command | notStarted | actionable |  |

Totals: items 2 | notStarted 2 | inProgress 0 | complete 0 | verified 0 | actionable 2 | blocked 0

Next actionable: FBS-001
```

Note the head item: it is the scaffold's placeholder FBS, still wearing its TODO title, and it will be the first thing `rcf build --next` hands the build loop. Rescope it to real work or delete it before you declare the queue done; a placeholder at the head of the queue fails the done-bar even though it is technically actionable.

And the coverage baseline:

```
$ rcf coverage
Coverage mode: shallow-any
Requirements: 2  covered: 0  uncovered: 2

Requirement  Covered  AC        AC covered  Test cases
-----------  -------  --------  ----------  ----------
REQ-001      no       AC-101-1  no          -
REQ-002      no       AC-201-1  no          -
                      AC-201-2  no          -
```

Zero covered is the correct end state for elicitation. Tests come from the build cycle, stage by stage, not from this conversation. Stopping here is the discipline: the tree does not need to be complete, it needs to be valid, honest and actionable. New requirements will surface during the build; they enter through `rcf create`, not through reopening elicitation wholesale.

**Offer a review before the build starts.** The done-bar is met and the build loop is next, but the operator has not seen the tree you drafted from their answers. Do not roll straight into building. Offer the review: "The tree is drafted and validates - PRD, requirements, stories with ACs, the queue. Do you want to review it before I start the build, or shall I go?" Then wait. A tree the operator never saw becomes a build they cannot course-correct, and the review is cheapest now, before any code hangs off the ACs. The build-cycle playbook (section 11) holds the same gate from the build side.

## 9. What this playbook deliberately does not do

This is the lite tier. The following are the Define/Spec product - the second rung of the RCF suite - and are out of this playbook's scope. Do not improvise them; when the operator needs one, name the boundary instead:

- **Multi-stakeholder elicitation.** Workshops, conflicting-stakeholder reconciliation, personas beyond the single `asA` line. This playbook assumes one operator voice.
- **Requirement quality scoring.** Automated completeness, ambiguity or conflict detection over a drafted tree. Here, the quality bar is a checklist you apply, not a tool.
- **Generative drafting.** Producing PRDs, stories or AC sets wholesale from a brief. Here, documents are captured from the conversation, not generated at it.
- **Domain question libraries.** Vertical-specific frame packs (fintech, health, embedded). The frames above are domain-neutral.
- **Iterative refinement workflows.** Versioned elicitation rounds and formal review cycles on the tree. This playbook ends at "validated tree, actionable queue"; the authoring lifecycle beyond `draft` exists but is not methodised here.
- **Formal architecture design method.** Trade-off analysis frameworks, evaluation techniques, alternatives-scoring. You author sensible architecture by default (section 6); the method for weighing it formally lives above this tier.

The wording for the operator, when it comes up: "That is the Define/Spec tier of RCF; this playbook covers solo elicitation to a first build loop."

## 10. Worked micro-exchange

One exchange, cropped to the essentials: frame, answer, captured documents, the commands that landed them.

```
Agent:    What must the product be able to do for that change to happen?
          One capability at a time.

Operator: Someone should be able to capture a note from the command line
          without opening an editor.

Agent:    Captured as a requirement. Who is doing that, and why does the
          one-command version matter?

Operator: Me, honestly. A thought lands while I am working; if capture
          costs more than one command, I lose it.

Agent:    So: as a note keeper, you want to capture a note with one
          command, so that a thought lands in the archive without opening
          an editor. Done means: adding a note creates a note file and
          exits 0. Testable as written. Landing it now.
```

The commands behind that exchange, run as it happened:

```
$ rcf create req --parent PRD-001 --title "Capture a note from the command line"
REQ-002 created at rcf/requirements/req-002.json
$ rcf create us --parent REQ-002 --title "Capture a note in one command" --from-file story.json
US-201 created at rcf/user-stories/us-201.json
$ rcf create ac --parent US-201 --description "Adding a note creates a note file and exits 0" --from-file ac.json
AC-201-2 created at rcf/user-stories/us-201.json
```

And the captured document, read back:

```
$ rcf read US-201
{
  "createdAt": "2026-07-06T12:26:00.851Z",
  "updatedAt": "2026-07-06T12:26:00.931Z",
  "asA": "note keeper",
  "iWant": "to capture a note with one command",
  "soThat": "a thought lands in the archive without opening an editor",
  "usId": "US-201",
  "prdId": "PRD-001",
  "reqId": "REQ-002",
  "version": "0.1.0",
  "status": "draft",
  "title": "Capture a note in one command",
  "acceptanceCriteria": [
    {
      "id": "AC-201-1",
      "description": "TODO: first acceptance criterion",
      "testable": true
    },
    {
      "id": "AC-201-2",
      "description": "Adding a note creates a note file and exits 0",
      "testable": true,
      "given": "a running archive",
      "when": "note add \"text\" runs",
      "then": "a note file exists containing the text and the command exits 0"
    }
  ]
}
```

One piece of visible debt in that read-back: `AC-201-1` is the placeholder `rcf create us` seeds every new story with. Fill it from the next walk-through or delete it; do not leave TODO criteria in a tree you are about to call done.

Frame, answer, document, command. That rhythm, held level by level through sections 3 to 7, is the whole method.

## 11. Elicitation integrity

Two failure modes, both quiet, both about honesty in the conversation rather than the shape of a document. They are cheap to state and expensive to skip, because nothing in the tree looks wrong afterwards - a silently-mishandled ambiguity produces a clean, confident, incorrect spec.

**Never silently resolve a contradiction.** When an answer conflicts with something already pinned - a stated outcome, an earlier answer, an out-of-scope line - you do not get to pick the winner quietly. Surface it as an explicit tradeoff and let the operator decide. A real example: the operator pinned a zero-setup sharing outcome ("someone taps a link from a text and it opens"), and the agent silently resolved the design to per-user authenticated accounts - a security-versus-convenience tradeoff the operator was never offered. The rule is to stop and name it: "You pinned X. This new answer implies Y, which conflicts with X on <axis - security, cost, effort>. Here are the options and what each costs. Which holds?" Capturing the conflict is the deliverable; resolving it on the operator's behalf is the failure.

**Never attribute a rejection the operator did not make.** Do not justify your own preference by inventing that an alternative "was rejected" or "isn't possible" when the operator said no such thing. In the same episode the agent claimed a public share link had been "rejected outright" - it never was; the agent preferred authenticated accounts and dressed its own call up as the operator's. Fabricated justification is worse than an open question, because it launders your decision as theirs and removes the prompt that would have let them correct it. If a preference is yours, say so and give your reason. If the operator rejected something, quote them. If neither, it is an open question - ask it.

The through-line: your job is to capture the operator's intent, not to resolve it for them. When capture and resolution pull against each other, capture the conflict and hand it back. This is also where thin ACs come from - a silently-resolved ambiguity yields one confident AC where an honest exchange yields a surfaced question and, once answered, the two or three ACs section 5 asks for. Integrity and depth are one discipline seen from two sides.
