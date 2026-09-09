# Blueprint authoring checklist

## 1. Read this if

You have authored a blueprint and are about to open a PR that ships it. Every item here is derived from a rule in the [authoring standard](blueprint-authoring.md); if an item fails you have a fix in that doc.

Run the checklist bottom-to-top: structural rules the loader would refuse first, then composition rules the mechanism enforces at apply, then adherence rules the mechanism does not enforce but you own as the author.

## 2. Structural (loader-enforced)

- [ ] `blueprint.json` exists at the blueprint root and is valid JSON.
- [ ] `slug` matches `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
- [ ] `version` matches `\d+\.\d+\.\d+`.
- [ ] `category`, when present, matches the same lower-kebab pattern as `slug` and appears in the vocabulary at [authoring standard, section 3a](blueprint-authoring.md#3a-category); a new category needs a row added there in the same PR.
- [ ] Every `contributions[]` entry has `{ id, kind, path }`.
- [ ] Every `path` is relative to `contributions/`, contains no absolute path, contains no `..` segment.
- [ ] Every `kind` is one of `req`, `us`, `tac`, `adr`, `ts`, `cn`. No `fbs`. No `prd`, `tad`, `bs`.
- [ ] Every `scope`, when present, is exactly `"global"`.
- [ ] Every `scope: "global"` contribution is `kind: "adr"` and carries a `topic` string.
- [ ] Every contribution file exists on disk at the declared path.
- [ ] Every contribution file's JSON matches the [rcf-schemas 0.4.4](https://github.com/Stravica/rcf-schemas) contract for its kind.

## 3. Namespacing (grammar-enforced at stamp)

- [ ] Prefix-family ids (REQ, US) either bare (`REQ-001`) or slug-prefixed (`application-spa-REQ-001`). No suffix-shaped forms.
- [ ] Suffix-family ids (ADR, TAC) either bare (`ADR-005`) or slug-suffixed (`ADR-005-spa`, `ADR-005-application-spa-theme`). No prefix-shaped forms.
- [ ] AC ids anchored to their parent US id (`AC-<us-numeric>-N`). AC ids are not namespaced by grammar; the band allocation is the collision-enforcement mechanism.

## 4. AC id band

- [ ] Your blueprint owns exactly one contiguous AC id band recorded in `docs/topics.md`.
- [ ] The band is unclaimed by every currently shipped blueprint (application-spa owns 1101-1899, application-api-rest owns 2101-2899, next-blueprint placeholder holds 3101-3899).
- [ ] Suffix-family ids (ADR, TAC) sit in a distinct number block per blueprint (SPA uses 2xx, REST uses 3xx, next takes 4xx).
- [ ] US ids sit toward the LOW end of your band, leaving headroom at the HIGH end for project-side stories that mechanically derive from a REQ id into your band (watchpost run4 lesson).

## 5. Composition (mechanism-enforced at apply)

- [ ] Every `scope: "global"` topic string is lower camelCase, one concept per topic, no version suffix.
- [ ] No `scope: "global"` topic string mints a variant of an already-shipped topic (`errorShape` when `errorEnvelope` exists, `auth` when `authModel` exists).
- [ ] Every `scope: "global"` topic your blueprint contributes appears in `docs/topics.md` with owning ADR id, meaning, and composition note.
- [ ] Topics your blueprint deliberately does not claim (but that a future blueprint might reach for) appear in `docs/topics.md` as "unclaimed", so a composing author sees the reservation.
- [ ] `rcf define blueprint add <your-source>` applies cleanly on an empty project (exit 0, contribution count matches `blueprint.json`).
- [ ] `rcf define blueprint add <your-source>` applied alongside every currently shipped blueprint either applies cleanly (no shared global topic) or surfaces the pairing as an intentional conflict you documented in `docs/topics.md`.
- [ ] `rcf define blueprint remove <your-slug>` on the same project removes cleanly (no referring-doc refusal on a fresh apply).
- [ ] `rcf define blueprint add <your-source>` re-apply is a no-op at the same version, and returns `alreadyApplied: true`.

## 6. Adherence (author-owned; not mechanism-enforced)

- [ ] Every AC's `then` clause is runtime-observable (specifies what an agent inspecting the deployed surface would see), not document-observable ("the project declares an ADR" is the anti-pattern).
- [ ] Every AC that constrains project-source realisation cross-links to a TAC the project must realise, or names a runtime-verify probe the ship gate will exercise. Mechanism-reach principle from the standard, section 7.
- [ ] Every REQ / US carries `blueprint:<slug>` in `tags` so a chain-authoring seat sees which blueprint minted the doc.
- [ ] `rcf audit coverage --strict` on a scratch project that applied your blueprint reports every blueprint AC as `uncovered` (no project TC binds it), NOT as passed. A blueprint AC that passes without a project TC binding it is a false-positive on shipped floors. (The distinct class `covered-unresolved` is reserved for the case where a TC is authored to claim coverage but its testPointer does not resolve to a real test in the working tree.)
- [ ] Every TAC the blueprint ships names its interfaces and its dependencies, and the responsibilities table cross-references the AC ids each responsibility satisfies.
- [ ] Known mechanism-reach gaps (categories the AC binds but no project-side gate enforces) are listed in the blueprint's `README.md` under "Known mechanism-reach gaps". The watchpost run4 icon/token/component-library gap is the cautionary example.
- [ ] Every runtime-observable AC either binds a check in a shipped probe pack under `probe-packs/`, or explicitly names in the blueprint's `README.md` under "Known mechanism-reach gaps" that no probe pack reaches it yet with a v1.1 minor bump candidate. The default is a shipped pack; the exception is documented. See section 8c of `blueprint-authoring.md` for the pack schema, the `appliesTo` scoping rule (one of route, tacIds, or `blueprint:` tag; the unqualified `() => true` predicate is refused at load), and the check-id cross-check against the blueprint's contributions.
- [ ] Every failure path, error condition and boundary the blueprint's own `guide/<slug>.md` and `contributions/tacs/*.json` describe is traceable to at least one AC on the story that owns the mechanism. AC-set sufficiency rule from the standard, section 7a.
- [ ] Every story's AC set has been swept against the scenario-class prompt list in the standard section 7a (credential missing, non-2xx, rate limit, timeout, partial or interrupted write, permission denied, malformed input, resource already exists, resource gone, concurrent access, quota exhausted, dependency not ready, first-vs-repeat run, idempotency of a retried operation, empty and maximal collections, boundary values). A class the mechanism does not touch is skipped without an AC; a class the guide names as a real path is bound to one.
- [ ] A story that ships with a single AC carries a one-line note stating that the mechanism has no documented failure path in the guide (or the anchored TAC), so the absence is traceable to a decision. Single-AC-legality clause from the standard, section 7a.
- [ ] Every AC on every story carries a disposition marker: `fixed` (mechanism-invariant, true for every applying project) or `template` (shape given, values project-specific). Fixed vs template rule from the standard, section 7b.
- [ ] Every `template` AC names the values the applying agent must set for the project (elicit ids, binding names, path segments, sizing knobs), so the disposition step is a fill-in rather than a rewrite. Section 7b.
- [ ] Every AC or guide statement that rests on a third-party platform fact carries the vendor documentation URL and the ISO-8601 date the fact was verified. Vendor-citation rule from the standard, section 7b.
- [ ] Every token on `blueprint.json:capabilities[]` is named or given a
      contract by at least one `must`-priority requirement on the
      blueprint. A capability declared with no covering requirement is
      either removed from the manifest or backed by a new requirement
      (and story, per section 7a). REQ-layer sufficiency rule from the
      standard, section 7c.
- [ ] Every option value on every `blueprint.json:elicits[].options[]`
      entry, or the value space named by `kind` when `options` is not
      enumerated, is named or given a runtime behaviour by at least one
      `must`-priority requirement on the blueprint. Section 7c.
- [ ] A manifest that omits the `elicits` key is legal only when no
      requirement description, guide passage or TAC responsibility names
      an apply-time answer. If any of those name an apply-time answer,
      the `elicits` key exists and every named answer appears on it. The
      `elicits`-key-legality clause from the standard, section 7c.
- [ ] Every runtime-observable probe on the blueprint emits positive
      evidence of the property it exists to protect (a request id, a
      response body excerpt, a created-then-deleted resource id in an
      inventory diff, a real deploy record), or records
      `accountBoundSkipped: true` with an exact reason. A `pass` verdict
      that carries neither is a defect. Positive-evidence rule from the
      standard, section 7d.
- [ ] Every environment variable a probe or a fixture reads is declared
      on the fixture manifest (the "Declared env vars" table in the
      fixture's own `README.md`): the first-tier `CI_HAS_*` env var that gates the
      account-bound branch, and every second-tier variable the branch
      reads once past the gate. The PR body lists any second-tier env
      var it depends on, so a reviewer can see the surface. Section 7d.
- [ ] Every assertion inside a probe or a gate row that rests on a
      third-party platform fact carries the vendor URL and an ISO-8601
      `verifiedOn` date, per section 7b's vendor-citation clause. A
      literal engine-specific string (a migration keyword, a header name,
      a config-file key) in a probe or a gate row is treated as a vendor
      fact.
- [ ] A probe result of `accountBoundSkipped: true` is legal only when
      the account env is unset; the `reason` field names the specific
      env var. A probe that records `accountBoundSkipped: true` with the
      account env set fails the row (the probe short-circuited on an
      undeclared variable and produced no evidence).
- [ ] Every safety test that guards live cloud resources (teardown
      selectors, "leave these alone" allowlists, pre-flight name
      checks) reads the live inventory from the vendor API when the
      account env is set and asserts against the returned set. A
      hardcoded name list inside a test file is labelled as a
      mock-only fallback in the test's own comment; a review claiming
      to trace live resource names states its source, which is the
      live inventory and never a list inside a test file. Section 7d.
- [ ] Every field name, header name, enum, wire shape and interface
      signature the blueprint mentions has exactly one owning TAC, and
      every other layer references it by id and field rather than
      restating it. Single-definition ownership rule from the standard,
      section 7e.
- [ ] Every REQ that promises an externally observable property carries
      a `deliveredBy` link into a TAC responsibility or an ADR decision
      that delivers it, and the blueprint passes `rcf define blueprint lint-consistency <source>`
      (or every finding is named in `README.md`
      under "Known chain-consistency-lint suppressions" with a
      one-sentence reason; pass-2 findings are not suppressible).
      Section 7e.

## 7. Documentation

- [ ] `README.md` at the blueprint root, one screen: apply command; anatomy table (`Piece | Where | What`); what it contributes and what it deliberately does not; quality bar in one paragraph.
- [ ] `guide/<slug>.md`: what it is; what it is not; when to reach for it; when it does not fit; what a good outcome looks like; the operator decisions that remain open; a cost-honesty paragraph.
- [ ] `docs/topics.md` complete per section 5 above.
- [ ] Every asset the working agent needs to realise the blueprint's ACs is under `assets/` with a stable filename that will survive minor version bumps.

## 8. Voice discipline

- [ ] No em-dashes anywhere in the blueprint's prose (README, guide, docs, ADR context/decision/consequences, TAC purpose/tradeoffs).
- [ ] No emoji.
- [ ] ASCII arrows (`->`) not Unicode arrows.
- [ ] Direct, machine-first tone. No hedging, no marketing lift, no filler.
- [ ] No first-person plural editorial voice.

## 9. Versioning

- [ ] `version` set per the standard, section 8: patch for prose-only edits, minor for additive contributions with no `scope: "global"` topic change, major for global-topic changes or removed contributions.
- [ ] A `CHANGELOG` entry (or the blueprint's `README.md` update) names what changed at this version, including the migration path if any project-authored referring doc will break at re-apply.

## 10. PR hygiene

- [ ] Branch from `main`; PR title names the blueprint and the version (`ship hello-panel blueprint v1.0.0`).
- [ ] PR description names any deliberate `scope: "global"` topic conflicts you are shipping (as with application-spa + application-api-rest's `errorEnvelope` and `authModel`) so the reviewer knows the intent.
- [ ] CI passes; `pnpm test` on the blueprint's directory passes locally.

If every box on this checklist ticks, the blueprint is ready to ship.
