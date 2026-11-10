## RCF

This project uses RCF. The tree under `rcf/` is the requirements spine and
the `rcf` CLI plus the `rcf_*` MCP tools are the referee. The rules below
are hard rules, not suggestions. Work is defined by FBS spec bundles, not
by improvised task lists.

This block is managed by `rcf doctor`. Anything you write inside the
`rcf:managed:begin` / `rcf:managed:end` markers is rewritten when the
package upgrades. Add your own project rules outside the markers.

### RULE 1: Elicit first; never fabricate.

Before authoring or rewriting any RCF document, run the elicitation
playbook (`rcf guidance elicitation-playbook` on the CLI or the
`rcf_elicit_requirements` MCP prompt). Ask the stakeholder its questions
and wait for answers. Document content comes from stakeholder answers. If
a fact was not given to you, do not invent it. Ask. A chain written in
one shot without stakeholder input is a method violation, not a
deliverable.

### RULE 2: The full chain is the deliverable.

All layers: PRD, REQ, US, AC, TS, TC, plus the tech side (TAD, TAC, ADR).
Do not drop a layer silently. Init-scaffold TODO placeholders are not a
finished state. Every scaffolded doc is either authored with the
stakeholder or its removal is explicitly agreed with them. If a layer
seems inapplicable, say so and get the stakeholder's agreement before
leaving it out.

### RULE 3: The test layer is mandatory.

Author TS and TC documents and run `rcf audit coverage --strict`. Do not
declare the work done while coverage fails, unless the stakeholder has
explicitly accepted the gap.

### RULE 4: A reported bug is a spec gap first.

When a bug is reported, do not jump to the code. First find the AC that
should have required the correct behaviour and the test that should have
caught it. Add or strengthen that AC (and its TS and TC) so the chain
catches this class of bug, then fix the code against the corrected spec.

### RULE 5: Deploy target before stack; never commit a stack blind.

A technology stack must not be committed before the deploy target is
established, and the stack is constrained to what that target can host.
Choosing a stack the owner's hosting cannot run is a method violation,
not a technical preference. This is an ordering rule: it forbids a stack
ahead of the target. It does not require the owner to have a target, or
to want one.

Raise the question when a stack decision is actually due. If the owner
names a target, constrain the stack to it. If the owner does not know
and wants to settle it, run the hosting-choice walkthrough in the
elicitation playbook and isolate the sign-up, billing, token and
CLI-auth steps as the human account-holder's to do. Do not perform or
pretend them.

If the owner defers, is still exploring, or is not deploying, that is an
answer, not a blocker. Do not press for a provider and do not stand an
account up. Record the deferral as the ADR, hold back the live half of
what was deferred, and build to RULE 6's local preview. A deferred
capability's acceptance criteria are deferred with it, visibly, or
scoped to a stub the owner explicitly agreed to.

Capture the deploy target, or its deferral, and any stack constraint it
implies as an ADR on the project's own tree.

### RULE 6: Every build lands a local preview.

A build is not done until it leaves a working, documented local preview
as its default outcome: a dev server, seeded data where the app needs
it, ideally started with one documented command. This holds whether or
not a host was named and whether or not a deploy happened. Remote
deployment is an addition on top of local preview, never a replacement
for it.

### RULE 7: Verification claims name their runtime.

Every "verified" or "tested" claim, in the Test and Finalise stages and
in the PR body's verification section, names the runtime it was checked
against (for example, "verified against wrangler dev on localhost, not
the deployed Worker runtime"). A claim with no named runtime is
incomplete.

Never state or imply verification on a deployed runtime that was not
exercised. A green test suite is evidence about the runtime it ran on
and nothing more. A ship verdict comes only from the deployed runtime
or a declared runtime-parity claim.

### RULE 8: Never skip the method for speed.

If a bug fix, polish item, or "small thing" would move faster by
bypassing RCF, that is the moment the method matters most. Do not offer
the operator a "skip the spec and just push a fix branch" option. If the
work is genuinely too small to warrant a full chain touch, say so and
propose the minimum spec update that keeps the chain honest. The
operator can choose to accept a shortcut. Offering one first is the
defect.

### RULE 9: Write what you learn.

`rcf/knowledge/` is this project's memory. Every session, if you
learned something the next session should not have to relearn, write it
there. `notes/` for internal facts (decisions, gotchas, runtime facts,
"the CI matrix uses Node 22 not 24"). `docs/` for user-facing prose the
project surfaces. One topic per file. Grep the tree before asking the
stakeholder something you might already know. See
`rcf/knowledge/README.md` for the convention.

### RULE 10: Read the operator profile.

If `rcf/.identity/profile.md` exists, read it at session start. It
describes the operator: name, role, working style, project-scoped
preferences. It is per-clone (gitignored by default), so it may hold
things the operator does not want in the shared repo. The absence of
the file is not an error; a fresh clone from another developer has no
profile of yours yet.

### RULE 11: Validate the chain before you act on it.

Before you emit a build spec, execute one, edit the tree, or run any
verb that reads the tree as truth, run `rcf define validate`. The
operator does not have to ask, and the check does not wait for a stage
that names it. A dirty tree is caught here rather than mid-Build, mid-
Test, or at the ship gate. If validation fails or coverage is broken
against the work in hand, stop and surface the finding to the operator
(RULE 12) before touching code or authoring documents. Everything
downstream assumes the tree you are reading is the tree the referee
thinks it is; the pre-action check is what keeps that assumption true.

### RULE 12: Surface method findings in the operator's language.

When `rcf define validate`, `rcf audit coverage`, `rcf audit trace` or a
spec inspection turns up a gap, translate it into plain intent before
you raise it. The operator hears the behaviour that is missing, not the
document id that is missing. "The plan for search does not say what
should happen when nothing matches, want me to add a check for that?"
beats "AC-207 has no covering TS". Method terms and document ids belong
in files and command output; the conversation carries the intent behind
them. An id appears only when you are pointing the operator at a
specific file, or after the operator used it first.

### RULE 13: Deliver in rounds: the twelve rules

Every change, a bug fix included, is delivered in rounds. These twelve
rules are the round's contract; `rcf guidance build-cycle` carries the
depth for each stage.

1. **The chain.** Every requirement traces to criteria, every criterion
   to one bound test, and every test to recorded evidence. The referee
   is the tool: `rcf define validate` and `rcf audit coverage --strict`
   both exit 0 at every stage exit, or the stage has not exited.
2. **Criteria only for promises.** A criterion is written only for a
   promise to a buyer: money, access, privacy, integrity, a product
   claim or a core journey. Everything else the product needs is the
   builder's hygiene tests, and a hygiene test is never bound to a
   criterion.
3. **Proof level.** Each touched criterion's proof level is chosen at
   DEFINE and recorded with the round: full (its test-strength report is
   one the reviewer reads), journey (its bound test is one end-to-end
   test) or external (`verification: external`, proven again by the
   release Verify). At every level a touched criterion still has a bound
   test and a Code Node. The tool reports test strength and refuses on
   none of its results.
4. **Five stages.** DEFINE, BUILD, REVIEW, TEST, FINALISE, in that
   order, one hand and one commit prefix each. Every job runs all five;
   there is no shortcut around the stages.
5. **Separation.** The hand that writes production code never writes or
   edits a criterion-bound test, a binding or criterion text. The audit
   enforces this by path on every commit, and the merge check runs the
   audit. This rule is never lightened.
6. **DEFINE exit.** From the named base-suite record, only the newly
   added or changed test cases fail at the DEFINE head, and each fails
   at its recorded assertion; an unrecorded baseline failure makes
   DEFINE BLOCKED. There is no throwaway implementation: the
   test-author proves red, and green is the builder's to prove.
7. **BUILD exit.** The reds are green and nothing beyond the criteria is
   built. A test that cannot pass without being changed is a stop for
   the owner, never an edit.
8. **REVIEW.** One reviewer judges the diff against the criteria the
   change claims, on three classes only: buyer harm, a vacuous test, and
   a test or criterion the builder edited. Everything else is a note.
   One re-gate; a second FINDINGS goes to the owner.
9. **TEST.** The bound suites, less the external-level tests, run
   against a running instance of the reviewed head. PASS, FAIL or
   BLOCKED is recorded at that head; BLOCKED changes neither the head
   nor the round budget and is escalated as a missing prerequisite.
10. **FINALISE.** FINALISE writes complete from the recorded verdicts,
    before the merge, so the merge carries it. verified is written by
    the release Verify, outside the round, and no build waits for it. A
    FINALISE failure is escalated with its exit code and output, never
    skipped.
11. **Round budget.** A round is two DEFINE passes and a date, both set
    when it opens. After the first BUILD a note is a candidate for a
    later round, never a reopening of DEFINE. Only the three classes in
    rule 8 can prevent a merge, and at TEST only the failure of an
    in-scope bound criterion blocks. Over budget, the owner gets a plain
    choice.
12. **Spec readiness.** One cold question count before BUILD and, for a
    change to what the tool refuses, one whole-plan adversarial pass at
    DEFINE, each sorted into gaps, preferences and noise. Gaps are fixed
    in the document once; preferences are recorded as defaults with a
    reason; noise is dropped.

The failures these rules guard against are agent-side self-checks:
skipping a layer, gold-plating past the criteria, editing a test to
pass instead of fixing the code,
merging before Finalise has written complete on the PR branch,
marking a stage done without its referee output. You catch each one
before the stage ends. A failure the operator has to point out is a
failure you did not check for.

### RULE 14: Check freshness at session start; offer, never install.

At the start of a new session on this project, run `rcf version --check`
(one call, silent on network trouble) and note the result. If a newer
release is available, tell the operator in one line what changed and
OFFER the upgrade. The exact command to run depends on how rcf-lite is
installed here (global npm, per-repo dep, npx pin); propose the command
that matches this repo's setup and wait for the operator's yes before
running it. If the check reports `status: "unknown"` (offline, cache
miss, feed unreachable) say nothing to the operator; freshness is a
convenience, not a gate. Never run the upgrade without the operator's
explicit go.

### RULE 15: On blueprint apply, dispose every AC.

A blueprint's acceptance criteria come in two shapes: `fixed`
(mechanism-invariant, true for every applying project) and `template`
(shape given, values project-specific). When you apply a blueprint
(`rcf define blueprint add ...`), walk every AC the blueprint
contributed. A `fixed` AC stands as authored: do not weaken or drop
one, and if one appears wrong for the project, that is a defect against
the blueprint, escalated on the blueprint's repo, not edited locally. A
`template` AC is a starting shape: actively dispose of it by accepting
as written, adjusting with the project's values, or dropping with a
stated reason recorded against the story. Silent inheritance of a
`template` AC is a defect. After you have disposed of every `template`
AC, re-sweep the applied AC set against the scenario-class prompt list
(credential missing, non-2xx, rate limit, timeout, partial write,
permission denied, malformed input, already exists, gone, concurrent
access, quota exhausted, dependency not ready, first-vs-repeat run,
idempotency, empty and maximal collections, boundary values) so the
story still covers the mechanism's documented failure paths. Any AC
that rests on a third-party platform fact must show its vendor
documentation URL and the ISO-8601 date the fact was verified; a
citation older than the operator's tolerance is re-verified before the
AC is treated as ground truth.

A blueprint's seed docs are a minimal representational seed set, not a
project spec. You have full scope of the project you are driving, and
you are the party best placed to integrate the seed with the project's
own chain. After you have disposed of every AC, walk the seed's REQs,
TACs and ADRs against the project chain (existing REQs, TACs, ADRs and
the PRD/TAD): resolve integration contradictions you can (parameter
substitution against a settled project value, naming reconciliation
against a settled project convention, composition-order reconciliation
against another applied blueprint), record the disposition in the
tree, and escalate to the operator only the ones that need a
product-shape decision or a two-way credential or account decision. An
internal contradiction (two of the seed's own layers disagreeing about
the same contract) is not yours to resolve; escalate it as a defect
against the blueprint's repo and refuse to derive downstream work from
the ambiguity.

When you escalate, pitch the question at the operator's declared
register. On your first exchange after `rcf init`, if
`rcf/.identity/profile.md` carries no `operatorRegister` value, ask one
question and record the answer to the profile: "One quick set-up
question. When we need to escalate a decision to you, do you want it
framed as a product-owner question (plain English, outcome-shaped) or
an engineer question (with the AC id, the seed's assertion, the
project's convention)? Answer 'product owner', 'engineer', or 'skip'
and I will hold the default." A `skip` answer writes `unstated`, which
reads as `productOwner` on the first escalation; if the operator
answers in method vocabulary, silently promote to `engineer` for the
rest of the session and offer to persist the change to the profile.

### RULE 16: Verify with positive evidence.

Every "verified" claim (in the Test and Finalise stages, in the PR body's
verification section, in any status update) names the runtime it was
checked against AND cites the positive evidence of the property (a
request id, a response body excerpt, a created-then-deleted resource id
in an inventory diff, a real deploy record). "The check did not show the
bad signature" is not evidence; "the request returned id 8f7a-... and
the response body carried the created resource id 12345" is. Where the
account credentials are not present, record the skip honestly (name the
env var that was unset), never fabricate a pass on the strength of
absence. This rule mirrors RULE 15's active-disposition posture: an
absent check is a skip you name, an actual check is a claim you cite.

### RULE 17: Log what misbehaves; ask once before anything leaves.

When a blueprint or rcf-lite itself does something contrary to its own
docs, fails, or forces you into a workaround (a validate finding on
freshly applied content, a contribution that references a piece the
blueprint does not ship, a stale vendor citation, a verb that errors or
hangs, output that contradicts `rcf help`), record it at once with
`rcf feedback add` (kind, target, anchor id, symptom class, severity,
a plain title and a body that says what happened, what the docs say,
and the command or file that shows it). Recording is silent and local;
nothing is sent. Never put customer data, credentials, operator names
or absolute paths in the body: the tool redacts, you do not rely on it.

Ask exactly once per session. The harness hook, or your own judgement
at a natural pause (the queue reports complete, the operator says they
are wrapping up), triggers it: run `rcf feedback preview`, show the
operator the exact titles and bodies it prints and where they would be
filed (name the repo and whether it is public), and ask in one sentence
whether to send them. Yes: `rcf feedback submit --yes`, then relay the
issue links. Not now: `rcf feedback defer`. Never for this project:
`rcf feedback opt-out`. Do not ask again in the same session, do not
submit without a yes, and do not describe the mechanism unless asked.
If submit reports a bundle instead of a link, give the operator the
bundle path and the repo URL in one line and move on.

### Session start

Run `rcf define validate`. A broken tree is fixed or reported before anything
else. Run `rcf build queue` for queue state: what is done, in progress,
blocked. Run `rcf doctor` if the last upgrade of the package changed
these rules. The block you are reading may be out of date; `rcf doctor
--fix` rewrites it.

### Build loop

Docs-review gate: when the tree has just been elicited, offer the
stakeholder a review of it before the first build. Do not roll from
elicitation straight into building without the offer.

Record the base first: `rcf build base-suite --out <file>` runs the RCF
suite at a clean committed base, and no Build starts until it is green
there. Run `rcf build bundle <fbs-id> --base-suite <file>` to get the
spec bundle for the next actionable item, then execute the five-stage
runbook it prints under the twelve rules of RULE 13. DEFINE (`DEFINE:`)
writes the criterion-based and E2E tests and their TS / TC bindings and
marks pickup with `rcf build mark <fbs-id> inProgress`. BUILD (`BUILD:`)
writes production code, Code Nodes and code-hygiene unit tests only.
REVIEW (`REVIEW:`) runs the scoped gate, `rcf audit separation` and
`rcf audit test-strength` read-only (no record), and records `rcf build
verdict review`. TEST (`TEST:`) runs the full RCF suite against a
locally running app, nothing deployed, records the test-strength report
at the reviewed head with `rcf audit test-strength --record`, and
records `rcf build verdict test`.
FINALISE (`FINALISE:`), on a REVIEW MERGE and a TEST PASS with CI green,
runs `rcf build finalise <fbs-id> --ci-run <ref>` on the PR branch,
which checks the recorded verdicts and writes complete
before the merge, then merges. Every commit carries its stage prefix,
and the separation audit judges that prefix against the paths the
commit touches. A failed REVIEW or TEST closes the round, and the next
round starts at DEFINE. Drive the whole queue, not one item.
After each item's Finalise, bundle the next actionable item until the
queue reports complete. If your harness can spawn sub-agents, run each
FBS in its own worker so the driving context stays clean across the
queue: one write worker at a time.

Record lifecycle transitions with the exact mark commands the bundle
prints. Never mark backwards. Run `rcf define validate` after any tree edit,
and `rcf audit trace <id>` or `rcf audit impact <id>` before touching anything with
dependents. PR bodies are evidence-first: lead with what was verified
and how, traced to AC and FBS ids, not a diff walk.

Run the fresh-context self-review every few FBS builds and once at the
end: a reviewer that drives the running app against its ACs, not one
that reads the code. Method: `rcf guidance build-cycle-playbook`,
section 16. It is the cheap in-loop check between builds, and it is not
the independent verification gate. verified is written only by a release Verify (rcf verify run --record):
`rcf verify run --release <label> --since <ref> --record`, outside the
build cycle, runs the bound E2E tests of the specs changed since the
last release against the release candidate and writes verified on each
spec whose tests pass.

If context gets unreliable on a large build, do not stall. Write a
next-session handover doc (queue state, the in-progress item, the next
actionable id), add a line to this file (outside the managed markers)
pointing the next session at it, then stop. A fresh session must resume
without re-elicitation.

### Write discipline

Prefer the `rcf` verbs (`create`, `update`, `delete`, `link`) for tree
edits. After any hand edit to a file under `rcf/`, run `rcf define validate`
before proceeding.

### Escalation

If the bundle is ambiguous or contradicts the tree, stop and ask; do
not interpret. Never mark a stage done without its referee output.

### MCP-wired harnesses

The same contract holds over the server's `rcf_*` tools and prompts.
Method depth, either wiring: the `rcf_execute_build_cycle` prompt, or
on the CLI `rcf guidance build-cycle-playbook`, for the build loop,
queue orchestration, PR authoring and bug triage. The
`rcf_elicit_requirements` prompt, or `rcf guidance elicitation-playbook`,
for elicitation, AC coverage depth and conversation integrity. Run `rcf
guidance` with no arguments to list every method document the installed
package ships.

### Product-owner intent sessions

A product-owner session starts with `rcf define questions --persona
productOwner` (or the `rcf_define_questions` MCP tool) and ends at
`Intent-complete: yes`. Every answer lands through the write-back the
question carries, then readiness recomputes; nothing about the owner's
intent lives only in a chat. The full loop content is in `rcf guidance
define-intent` and the `rcf_define_intent` prompt. Never improvise a
PO loop; the questions and their write-backs are the method.

### Prototype rule

A prototype is engineer entry material, not a product-owner blocker.
When the tree reaches `levels.intentComplete.ok`, the agent may
pre-populate `[draft]` entities, TAC stubs and interfaces so the
engineer has a starting point; those drafts never re-open the PO
loop and never block a freeze. If the owner asks for a visible
prototype before intent-complete, say so (the method is finished the
intent first) and offer to continue the intent loop; never produce a
prototype that bypasses the readiness verdict.

### Prototypes in DISCOVERY (ADR-4132)

A statement sourced to `prototype:<name>:<observation>` is evidence,
not implementation. A document that cites prototype code as its
implementation is a D2 finding the engineer resolves by re-deriving:
extract requirements from the prototype as evidence, run them through
intake and the PO loop like any document, and rebuild from the tree.
The prototype's code is burned (one brief statement, kind
`constraint`); the build that follows starts from the tree, never
from the prototype. "Grow the prototype" is rejected on provenance
grounds. The full doctrine is in `rcf guidance discovery-prototypes`
and the `rcf_discover_prototype` prompt.

### Journey review (ADR-4146)

Never run `rcf discover journey review` on your own. The review verb
seals the discovery record with a ReviewStamp sealed by the
discoveryHash; a stamp that lands without the operator asking turns
the single-reviewer D0 door into a rubber stamp. The operator (or a
reviewer the operator names) runs the verb; the agent surfaces that
the record is ready to review and waits. No other verb ever writes
ReviewStamp: `rcf discover journey add`, `import` and `declare` leave
`record.review` alone, so a journey edit after review reads as stale
on the next check rather than silently re-sealing.
