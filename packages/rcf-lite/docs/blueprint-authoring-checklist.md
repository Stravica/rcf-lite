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
