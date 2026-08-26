<!-- Never-skip-RCF invariant applies to every section below; see §11.1. Editors: any change to guidance wording is subject to canary release-block. -->

# Elicitation playbook

## 1. Read this if

You are the agent starting a project with a human. The end state is concrete: a validated RCF tree (PRD, requirements, stories with testable acceptance criteria, architecture captured as TAC / ADR) and an actionable FBS queue, reachable in one or two sittings. When you finish, `rcf define validate` is clean and `rcf build bundle --next` hands back a real work item.

This is the lite tier of the elicitation method: one operator voice, one agent, blank directory to first build loop. Section 9 states plainly what sits above this tier; section 11 states the integrity rules that hold across the whole conversation - read it, the failures it forecloses are quiet ones. Section 12 sets the register you hold with the operator throughout: plain language, one decision per message, the method invisible.

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

Write documents as you go with `rcf define create` and `rcf define update`; do not batch the tree up in your head for one big write at the end. Run `rcf define validate` after every level. Start from the scaffold:

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
$ rcf define create req --parent PRD-001 --title "Capture a note from the command line"
REQ-002 created at rcf/requirements/req-002.json
```

The created document carries a TODO description and default category / priority values; replace the description and add the rationale with `rcf define update` before moving on. TODOs left in place are honest, visible debt, but a REQ still wearing its defaults is not yet elicited.

## 5. Stories and acceptance criteria (US / AC)

Question frames per REQ:

- Who, exactly, is the person or system exercising this capability? (`asA`)
- What do they do? (`iWant`)
- Why do they bother? (`soThat`)
- Walk me through one concrete use, start to finish. The walk-through is where ACs come from.

```
$ rcf define create us --parent REQ-002 --title "Capture a note in one command" --from-file story.json
US-201 created at rcf/user-stories/us-201.json
```

(`story.json` carried the asA / iWant / soThat fields; `--from-file` merges body fields the flags do not cover.)

The testable-AC quality bar, applied to every AC before it lands:

- **Given / when / then**, each clause filled in.
- **An observable outcome.** The `then` names something a test could inspect: a file exists, an exit code, an error naming the id. Not a state of mind.
- **One behaviour per AC.** If the `then` needs "and" between two different outcomes of two different actions, split it.
- **`testable: true` means a machine could check it.** Read the AC as a test skeleton; if you cannot see the assertion, rewrite the AC.

```
$ rcf define create ac --parent US-201 --description "Adding a note creates a note file and exits 0" --from-file ac.json
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

## 5.5 REQ shape and its baselines

Every REQ this playbook draws out has a shape (§5.5.1), and each shape carries a baseline set of acceptance criteria (§5.5.2) that must hold unless the operator explicitly rules otherwise. Baselines exist because a UI REQ without a shared-nav AC lets the build ship a UI without a shared nav, and a persistence REQ without a crash-safety AC lets the build ship a store that loses writes on kill. The four-questions sweep of §5 asks the operator what they want, which is the right question. It does not ask what any operator would want if they knew to ask. The baselines are that second question, mechanised.

Silence is not agreement. When the sweep proposes a baseline AC, the operator either accepts it or opts out with a recorded reason. A "we can skip that for now" without a reason leaves the sweep open, and Stage 1 (Define) refuses `rcf build bundle --next` for any FBS that binds ACs on a story with open sweeps. The refusal is the safeguard against the exact failure mode that produced four review-phase defects on the cold run.

### 5.5.1 The five shapes

`webUi` for HTML rendered for a person to look at. `httpApi` for programmatic HTTP endpoints for machine clients. `auth` for identity, sessions, credentials. `persistence` for durable storage the operator's data lives in across restarts. `notifications` for outbound delivery to a human channel. A REQ can carry more than one; a REQ that carries none records `shapes: [none]` (legitimate for pure business-rule REQs). Detection is deterministic keyword-scan over the REQ's `title`, `description` and `rationale` plus the parent PRD's `intent` and `problem` as fallback context; the classifier fires automatically on `rcf define create req` and `rcf define update req --description`, and `rcf discover req-classify <req-id>` re-runs it on demand.

### 5.5.2 Baseline sweep and opt-out ledger

`rcf discover req-baseline sweep --req <id>` walks every US under the target REQ and proposes any baseline AC not yet present. The operator accepts each candidate (which writes it as an AC with `provenance.authoredBy: baseline` and the `baselineKey` set) or opts out with a reason (which writes a `baselineAcOptOuts[]` entry so future USes under the same REQ inherit the ruling). The opt-out reason has a 20-character floor: a one-word "no" reads as silence, and silence is exactly what the ledger exists to prevent. The C+D-native `rcf discover req-baseline opt-out` verb is always available; Track A preflight's design-shape questions surface (`auth.htmlLoginPage` in v1) writes the same ledger for the preflight-driven case, so a preflight session and this playbook share one truth.

Cross-references: the four-questions sweep of §5 still runs; baselines augment it, do not replace it. Track A preflight (see the build-cycle playbook §3 and `rcf discover preflight`) owns the design-shape questions that flip baselines before build. Track B's `uiBaseline.defaults` is the truth source for `webUi` baseline values (see `rcf discover ui-baseline`).

## 6. Capturing architecture as it emerges (TAC / ADR)

### Establish where it will run first, before any stack

The deploy target is the first architectural question and it is asked **early - before any technology stack is named or committed.** "Where will this app actually run once it is built?" comes before "what shall we build it with", not after, and never by silent inference. This is a load-bearing decision made for an owner who usually cannot judge it: a stack chosen before the host is known is a stack that may have no host, discovered only at deploy, when it is most expensive to unwind.

What is asked early is the question, not a provider. The owner is free to answer that they have not decided, or that nothing is being deployed at all, and the two branches below carry those answers without ever pressing for a name.

- **Ask it as its own item, early.** Put the deploy-target question in the conversation before the architecture takes any concrete shape. A one-line answer is enough to constrain everything downstream: "I've got Netlify", "it lives on my Cloudflare account", "it runs on my own machine". Those three are in alphabetical order, which is the only ordering rule this list has - it is not a ranking, and nothing in this playbook picks a provider for the owner.
- **Constrain the stack to the answer.** Once the target is known, the stack you choose (section below) must be one that target can actually host. Do not commit a stack the host cannot run - a Node-and-native-module stack on a Cloudflare-only account is the exact dead-end this rule exists to foreclose. If the only good stack for the app is incompatible with the stated host, that is a tradeoff to surface (section 11), not a silent override.
- **Capture it as an ADR on the project's own tree.** Record the deploy target and the stack constraint it implies as an ADR, so the decision is visible and revisable rather than buried in the agent's head. `rcf define create adr --parent TAD-001 --title "Deploy target: <where> - stack constrained to <what it can host>"`.
- **Not choosing is also an answer.** "I do not know", "not yet", "I am not sure I want this built" and "this is not being deployed" are complete answers to the question, not failures to answer it. The two branches below take them, and neither ends with you naming a provider for the owner.

### When the owner does not know and wants to settle it: the hosting-choice walkthrough

Many owners will not know their options. When the deploy-target question is reached and the owner does not know where the app will run but **wants to settle it now**, **do not choose silently and do not choose on technical merit alone** - run a plain-language hosting-choice walkthrough and let the owner make the call. If they would rather not settle it yet, that is the next branch, not this one.

- **Explain the options in plain language, no unexplained jargon.** Describe the realistic hosting choices for this kind of app in terms the owner can act on: what runs where, what each costs in effort and money, what each rules in or out. If a term has to appear ("static site", "serverless", "container"), define it in a phrase. A bare "pick a provider" freezes a non-expert; a walked choice does not.
- **Cover configuring the account, not just naming a provider.** The walkthrough continues past "which provider" into standing the account up: creating the account, generating the tokens or keys the deploy needs, and the CLI setup that connects the local project to it. Naming a provider and stopping leaves the owner exactly as stuck as before.
- **Isolate the human-only steps and name them honestly.** Sign-ups, billing and payment details, token generation, and CLI authentication are the account-holder's to do - they cannot be done by the agent and must not be pretended. Name each such step plainly as "this one is yours to do, here is exactly what to click", pause for the owner to do it, and continue. Never perform these silently, and never claim to have done something only the human can do. (This is the run-03 impersonation-refusal posture: the honest boundary is stated, not blurred.)

### When the owner defers, is exploring, or is not deploying

The branch above is for an owner who wants to choose and needs help choosing. This one is for an owner who does not want to choose yet, or at all: "I do not know", "not yet", "I am not sure I want this built", "I just want to see it working", "this is not going anywhere". **Do not run the hosting-choice walkthrough at someone who has not asked to choose.** Running it anyway turns an exploratory conversation into a session that stands up accounts, generates tokens and asks for card details for a thing nobody has committed to building - which is the most expensive possible response to "I am not sure". Take the deferral, write it down, and carry on building.

Deferral does not mean the same thing for every capability, so branch on what the capability actually costs to stand up:

- **A capability that cannot exist without an account.** The deploy target itself, and anything else whose only real form is a hosted service someone has to sign up and pay for. Here deferral means **nothing is applied**. There is no provisional version of a hosting account, so do not open one, do not pick a provider "for now", and do not scaffold provider-shaped config against a provider nobody named. Record the deferral as the ADR (below), leave the stack unconstrained by any host, and build to the local preview, which is the hosting-independent done state.
- **A capability with a real local form.** Authentication, a database, object storage, a queue, a mail sink: each of these has a version that runs on the owner's own machine and costs no account, no card, no billing and no human-only step. Here deferral defers **the live decision, not the capability**. Stand the local form up; leave the hosted form unchosen. That is not a grudging allowance, it is the correct answer - it commits the owner to nothing, it lets the build proceed, and it lets verification exercise the real behaviour (a genuine sign-in against a local identity server, not a bypassed one) while the owner is still undecided. Blanket-deferring such a capability is the worse outcome: it leaves the thing unimplemented when the local path would have cost nothing, and it stalls the build and its verification together.

So the question per capability is "what would deferring this actually cost to keep open?", not "is this deferred?". Defer the decision that needs an account. Build the part that does not.

**Record the deferral as the ADR.** A deferral is a decision and gets written down like one: `rcf define create adr --parent TAD-001 --title "Deploy target: deferred - no target chosen"`, `status` left at `proposed`, context stating that the owner has not committed, consequences naming what stays open (the stack is unconstrained by a host; the done state is the local preview), alternatives being the options that were on the table and not taken. Leave it revisable - a deferral is a decision to decide later, and this ADR is what the later conversation reopens. An undecided deploy target recorded nowhere is indistinguishable from one nobody ever asked about.

**Never let a deferral become a silent stub.** This is the one thing deferral must not do. When a capability is deferred outright, the acceptance criteria that require it are deferred with it, visibly - marked deferred, or lifted out of the queue and named as lifted - or scoped down to a stub the owner explicitly agreed to, in those words. An agent that quietly fakes the deferred thing (an auth path that waves everyone through, a store that forgets on restart, a send that goes nowhere) and then reports the build green has manufactured exactly the false green the verification side of this method exists to prevent. Deferring is honest; stubbing without saying so is not. The tree gives you nowhere to hide it either: an AC either holds or it is deferred, and both of those are things you say out loud.

### TAC or ADR: which document takes it

Which document: a **TAC** is a lasting component - it has a purpose, responsibilities and interfaces ("the note store", "the CLI surface"). An **ADR** is a decision - it has a context, a decision and consequences ("notes are plain files on disk, not a database"). A statement about what exists is a TAC; a statement about what was chosen, where an alternative existed, is an ADR.

Minimum capture: a TAC needs its purpose and responsibilities; an ADR needs context, decision and consequences, plus the alternatives considered and why each was not chosen. One honest sentence per field beats a page of hedged ones.

```
$ rcf define create tac --parent TAD-001 --title "Note store"
TAC-002 created at rcf/tacs/tac-002.json
$ rcf define create adr --parent TAD-001 --title "Notes are plain files on disk"
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
$ rcf define create fbs --parent BS-001 --title "Note capture command" --acs AC-201-2
FBS-002 created at rcf/fbs/fbs-002.json
```

## 8. When to stop

The done-bar, all five together:

1. Every REQ has at least one US.
2. Every US has at least one testable AC.
3. The queue's head item is actionable: `rcf build` shows a `Next actionable` id.
4. `rcf define validate` is clean.
5. `rcf audit coverage` has been run and its zero-covered baseline is understood.
6. Every classified REQ has completed its baseline sweep (no open candidates). `rcf discover req-baseline sweep --all --status` prints the open-candidate queue; the Stage 1 gate refuses `rcf build bundle --next` for any FBS binding an AC on a US that still has one.

Queue-head evidence from the scratch project:

```
$ rcf build
# Build queue: BS-001 - Initial build sequence

Generation strategy: dependencyFirst

| order | tier | id | title | status | state | blocked by |
|---|---|---|---|---|---|---|
| 1 | 0 | FBS-001 | TODO: name this build session | notStarted | actionable |  |
| 2 | 0 | FBS-002 | Note capture command | notStarted | actionable |  |

Totals: items 2 | notStarted 2 | inProgress 0 | complete 0 | verified 0 | actionable 2 | blocked 0

Parallel-safe tiers (items in the same tier have no dependency between them and can build in parallel):
- tier 0: FBS-001, FBS-002

Next actionable: FBS-001
```

Note the head item: it is the scaffold's placeholder FBS, still wearing its TODO title, and it will be the first thing `rcf build bundle --next` hands the build loop. Rescope it to real work or delete it before you declare the queue done; a placeholder at the head of the queue fails the done-bar even though it is technically actionable.

And the coverage baseline:

```
$ rcf audit coverage
Coverage mode: shallow-any
Requirements: 2  covered: 0  uncovered: 2

Requirement  Covered  AC        AC covered  Test cases
-----------  -------  --------  ----------  ----------
REQ-001      no       AC-101-1  no          -
REQ-002      no       AC-201-1  no          -
                      AC-201-2  no          -
```

Zero covered is the correct end state for elicitation. Tests come from the build cycle, stage by stage, not from this conversation. Stopping here is the discipline: the tree does not need to be complete, it needs to be valid, honest and actionable. New requirements will surface during the build; they enter through `rcf define create`, not through reopening elicitation wholesale.

**Offer a review before the build starts.** The done-bar is met and the build loop is next, but the operator has not seen the tree you drafted from their answers. Do not roll straight into building. Offer the review, in plain words rather than document names: "The plan is drafted and everything checks out: what we're building, the requirements, and the build order. Want to look it over before I start building, or shall I go?" Then wait. A tree the operator never saw becomes a build they cannot course-correct, and the review is cheapest now, before any code hangs off the ACs. The build-cycle playbook (section 11) holds the same gate from the build side.

**UI-baseline check when a Web UI REQ is present (Track B soft nudge).** After the tree is drafted and before Stage 1 of the first UI-bearing FBS begins, look at the requirements one more time: does any REQ shape as a Web UI (matched by the shared `matchReqShapeSignals` classifier's `webUi` shape, or by the operator naming pages / screens / dashboards in prose)? If so, prompt the operator to run `rcf discover ui-baseline init` before the build cycle picks up its first FBS. The baseline captures the ruled UI defaults once per project (theme mode, shared layout, contrast targets, component vocabulary, auth-flow expectations); every subsequent UI-bearing FBS inherits from it. This is a soft check, not a hard gate at elicitation time - the hard refusal fires later at `rcf define design <fbs-id>` when the FBS is uiBearing and no baseline exists.

## 8.5 Pre-flight config

Between the tree being drafted (section 8) and the build cycle picking up its first FBS (build-cycle playbook, section 3), one more session runs: `rcf discover preflight`. The session is not part of elicitation but sits at the seam between it and the build. It exists because a mocked integration test looks identical to a live one, and the honest answer to "how are we verifying this" has to be captured while the operator is thinking about the product, not while a test suite is going green.

**What it is.** One pass over every third-party service the PRD (and optionally a TAD) names. The scanner surfaces candidates; the session forces one of five attestation modes per service, plus any applicable design-shape answers (v1 catalogue: `auth.htmlLoginPage`), and writes a `preFlightConfig` record on the manifest. No code changes at this stage.

**Why here and not later.** A credential absent at build-start is a decision, not an accident, and the chain records the decision now. When the build cycle picks up an FBS whose ACs reference a service, the FBS carries that attestation across into `dependsOnServices[]` at Define, and the covering test suites carry `runtimeProvenance` on every TC at Test. All three tie back to the pre-flight record so nobody has to remember what the operator ruled.

**The five modes, one line each:**

- `live` - tests hit the live service with a real key you supply.
- `sandboxed` - provider sandbox mode with a real key (no delivery).
- `mocked` - local fixtures or stubs; not ship-authoritative on its own.
- `declaredMockOnly` - ship mock-only intentionally (feature-flagged off, stub for local dev, pre-launch).
- `notShipped` - for local development only; no production path uses it.

Pick honestly. A `mocked` where the ship intent is `live` is the exact failure this whole surface exists to prevent.

**What "declared mock-only" costs at ship time.** Verify emits a `MOCK-ONLY-DECLARED` verdict on the run, disclosed on the finalise summary. The finalise gate refuses to promote the FBS to `verified` on that verdict unless you pass `--ship-without-verified`. This is legitimate for pre-launch stubs and feature-flagged-off code; the chain records it so it is greppable at ship time rather than a false PASS.

**Credentials never enter the chain.** The session prompts for env-var NAMES only. Values are read from the shell at test / finalise time; the name-metadata lives in `.rcf/preflight-secrets.local.json`, which is gitignored via the managed block written by `rcf init`.

**Hand-off to the build cycle.** Once the record is written, the build cycle picks up as normal. `rcf build bundle --next` warns (not refuses) when an in-scope FBS touches an AC whose services are not covered by any `preFlightConfig` record; the operator re-runs `rcf discover preflight` and continues.

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
$ rcf define create req --parent PRD-001 --title "Capture a note from the command line"
REQ-002 created at rcf/requirements/req-002.json
$ rcf define create us --parent REQ-002 --title "Capture a note in one command" --from-file story.json
US-201 created at rcf/user-stories/us-201.json
$ rcf define create ac --parent US-201 --description "Adding a note creates a note file and exits 0" --from-file ac.json
AC-201-2 created at rcf/user-stories/us-201.json
```

And the captured document, read back:

```
$ rcf define read US-201
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

One piece of visible debt in that read-back: `AC-201-1` is the placeholder `rcf define create us` seeds every new story with. Fill it from the next walk-through or delete it; do not leave TODO criteria in a tree you are about to call done.

Frame, answer, document, command. That rhythm, held level by level through sections 3 to 7, is the whole method.

## 11. Elicitation integrity

Two failure modes, both quiet, both about honesty in the conversation rather than the shape of a document. They are cheap to state and expensive to skip, because nothing in the tree looks wrong afterwards - a silently-mishandled ambiguity produces a clean, confident, incorrect spec.

**Never silently resolve a contradiction.** When an answer conflicts with something already pinned - a stated outcome, an earlier answer, an out-of-scope line - you do not get to pick the winner quietly. Surface it as an explicit tradeoff and let the operator decide. A real example: the operator pinned a zero-setup sharing outcome ("someone taps a link from a text and it opens"), and the agent silently resolved the design to per-user authenticated accounts - a security-versus-convenience tradeoff the operator was never offered. The rule is to stop and name it: "You pinned X. This new answer implies Y, which conflicts with X on <axis - security, cost, effort>. Here are the options and what each costs. Which holds?" Capturing the conflict is the deliverable; resolving it on the operator's behalf is the failure.

**Never attribute a rejection the operator did not make.** Do not justify your own preference by inventing that an alternative "was rejected" or "isn't possible" when the operator said no such thing. In the same episode the agent claimed a public share link had been "rejected outright" - it never was; the agent preferred authenticated accounts and dressed its own call up as the operator's. Fabricated justification is worse than an open question, because it launders your decision as theirs and removes the prompt that would have let them correct it. If a preference is yours, say so and give your reason. If the operator rejected something, quote them. If neither, it is an open question - ask it.

The through-line: your job is to capture the operator's intent, not to resolve it for them. When capture and resolution pull against each other, capture the conflict and hand it back. This is also where thin ACs come from - a silently-resolved ambiguity yields one confident AC where an honest exchange yields a surfaced question and, once answered, the two or three ACs section 5 asks for. Integrity and depth are one discipline seen from two sides.

## 11.1 Never-skip-RCF

**Never-skip-RCF.** The bug-fix loop uses the same five-stage cycle as the initial build (Define, Build, Review, Test, Finalise); there is no fast-path, and there is no operator ruling that opens one. Do not offer a shortcut. Do not phrase the choice as "would you rather I skip the RCF wrapping" or any wording that presents bypassing the chain as a legitimate option. The offer itself is the defect. The operator's refusal is not a sign the invariant held; it is a sign the invariant was tested and the guidance surface leaked. Fix the guidance surface.

## 12. Speaking to the operator

Everything above is method; this section is voice. The operator of a lite project is often non-technical, and the first thing they read after `rcf init` is your first message. The method must be invisible in it: they should feel that the work is in hand and all they need to do is steer.

- **Plain language, always.** The method vocabulary (PRD, REQ, US, AC, FBS, TAC, the docs-review gate, this playbook's name) is for files, commands and validation output, not for conversation. Say "what we're building", "the requirements", "the build plan", "a quick review of the docs". A document id may appear when you are pointing the operator at a specific file, or after the operator has used it first - never as the default way to refer to their own product.
- **Never cite rules.** The harness rules and the playbooks shape your behaviour silently. "Per RULE 1" or "the playbook requires" means nothing to the operator and reads as bureaucracy, not competence.
- **One decision per message, stated first.** Lead with the single thing you need from the operator. A genuine question goes at the top of the message, not underneath sections of process narration. Status is one to three sentences; hold the multi-section write-ups for documents the operator asked to read.
- **Check before you ask.** Whether a git remote exists, whether a file is present, what state the tree is in: anything a command or a file read answers is yours to run, not the operator's to report back to you.
- **Remember what you were granted.** Permissions the operator has given ("manage the pushes, branches and PRs"), answers already collected, preferences already stated: track them and act on them. Re-asking reads as not listening.
- **Sound like it is in hand.** The operator steers; you drive. Confidence without hedging, and plain honesty the moment something is genuinely blocked or ambiguous - which is exactly when the operator must hear from you.

The question frames in sections 3 to 7 are already conversational; hold this register between the frames too. The pull is strongest in the first message after init, where the scaffold invites a guided tour of its placeholder documents. Nobody needs the tour. They need to know what you are doing next and the one thing you need from them.
