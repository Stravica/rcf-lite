# Getting started

## 1. Read this if

You want to go from an empty directory to a working RCF project. Humans and agents both: the journey is designed to be judged by a human in one sitting and executed by an agent verbatim.

By the end you will have a validated RCF tree for a small product, answers to the three traceability questions (what is uncovered, what does this connect to, what does a change break), and one full build-loop cycle behind you.

Every command below was run for real against a fresh project; every output block is pasted, not typed. The journey assumes the `rcf` shell helper from [install, section 6](install.md#6-verify-the-install). Concepts get one line each as the journey needs them; the mental model lives in [how it works](how-it-works.md).

## 2. Scaffold a project

The worked example is Recipe Box, a small app for saving and searching recipes. Make a directory and scaffold:

```sh
mkdir recipe-box && cd recipe-box
rcf init --non-interactive --project-name "Recipe Box"
```

```
Scaffolded 9 files under rcf/.
  rcf/manifest.json
  rcf/prd.json
  rcf/requirements/req-001.json
  rcf/user-stories/us-101.json
  rcf/tad.json
  rcf/tacs/tac-001.json
  rcf/adrs/adr-001.json
  rcf/build-sequence.json
  rcf/fbs/fbs-001.json
```

Run it as plain `rcf init` on a terminal and it prompts for the project name instead.

What you got, in five lines: `manifest.json` declares the tree's three roots. `prd.json` (the product), `tad.json` (the architecture) and `build-sequence.json` (the build queue) are those roots. Every other document hangs off them: a requirement, a user story with one acceptance criterion, an architecture component (TAC), an architecture decision record (ADR) and one build item (FBS). Each carries `TODO` placeholder text that you replace next. The on-disk layout is specified in the [rcf-schemas file-layout doc](https://github.com/Stravica/rcf-schemas/blob/main/docs/file-layout.md).

## 3. See your tree

```sh
rcf view
```

This starts a local server (default `http://127.0.0.1:4373/`) and opens your browser on a rendered, tabbed review surface: overview, requirements, architecture, build sequence. Leave it running while you author - any change to a `*.json` file under `rcf/` streams to the open tab without a refresh. Ctrl-C shuts it down cleanly.

The server binds `127.0.0.1` only and has no auth; it is for you, on your machine. Do not tunnel or proxy it anywhere. `rcf help view` covers ports, strict mode and exit codes.

## 4. Author the chain

Time to replace the placeholders with the actual product. First the PRD - the problem and the objective:

```sh
rcf update PRD-001 --set problemStatement="Home cooks lose recipes across bookmarks, screenshots and notes apps." --set objectives.0="Keep every recipe in one place and find it again by ingredient."
```

```
PRD-001 updated at rcf/prd.json
```

The scaffolded requirement and story become recipe capture:

```sh
rcf update REQ-001 --set title="Recipe capture" --set description="Users can save a recipe with a title, an ingredient list and a method." --set domain=capture
rcf update US-101 --set title="Save a recipe" --set asA="home cook" --set iWant="to save a recipe with its ingredients and method" --set soThat="I never lose it again" --set acceptanceCriteria.0.description="Saving a recipe with a title, at least one ingredient and a method succeeds"
```

```
REQ-001 updated at rcf/requirements/req-001.json
US-101 updated at rcf/user-stories/us-101.json
```

Grow the tree with a second requirement - search - and a story under it:

```sh
rcf create req --parent PRD-001 --title "Recipe search"
rcf update REQ-002 --set description="Users can find saved recipes by ingredient." --set domain=search
rcf create us --parent REQ-002 --title "Find a recipe by ingredient"
rcf update US-201 --set asA="home cook" --set iWant="to search my recipes by ingredient" --set soThat="I can cook with what I already have" --set acceptanceCriteria.0.description="Searching for an ingredient lists every recipe that uses it"
```

```
REQ-002 created at rcf/requirements/req-002.json
REQ-002 updated at rcf/requirements/req-002.json
US-201 created at rcf/user-stories/us-201.json
US-201 updated at rcf/user-stories/us-201.json
```

Ids are assigned for you: requirements count up (`REQ-002`), stories are numbered by requirement (`US-201` = first story of the second requirement), and a new story is seeded with one placeholder acceptance criterion (`AC-201-1`). Add a second criterion for the edge case:

```sh
rcf create ac --parent US-201 --description "Searching for an ingredient no recipe uses returns an empty list, not an error"
```

```
AC-201-2 created at rcf/user-stories/us-201.json
```

Inspect any document by id (acceptance criteria live inline in their story):

```sh
rcf read US-201
```

```json
{
  "createdAt": "2026-07-06T13:56:10.221Z",
  "updatedAt": "2026-07-06T13:56:10.414Z",
  "usId": "US-201",
  "prdId": "PRD-001",
  "reqId": "REQ-002",
  "version": "0.1.0",
  "status": "draft",
  "title": "Find a recipe by ingredient",
  "asA": "home cook",
  "iWant": "to search my recipes by ingredient",
  "soThat": "I can cook with what I already have",
  "acceptanceCriteria": [
    {
      "id": "AC-201-1",
      "description": "Searching for an ingredient lists every recipe that uses it",
      "testable": true
    },
    {
      "id": "AC-201-2",
      "description": "Searching for an ingredient no recipe uses returns an empty list, not an error",
      "testable": true
    }
  ]
}
```

`rcf read <id> --field <dotPath>` prints a single field when that is all you need.

The architecture side gets the same treatment. Name the scaffolded component and cross-link the search story to it, so the tree records which component realises which story:

```sh
rcf update TAC-001 --set name="Search index" --set purpose="Maintain the ingredient-to-recipe index that search queries." --set responsibilities.0="Index recipes by ingredient on save."
rcf link US-201 --tac TAC-001
```

```
TAC-001 updated at rcf/tacs/tac-001.json
US-201 tacIds updated (1 entries).
```

Changed your mind about a document? `rcf delete` removes it, and `--dry-run` shows the plan first. Recipe Box has no architecture decision recorded yet, so the placeholder ADR goes:

```sh
rcf delete ADR-001 --dry-run
rcf delete ADR-001
```

```
Would delete 1 file(s) and mutate 0 doc(s). (dry-run)
  [dry-run] would delete rcf/adrs/adr-001.json
Deleted 1 file(s), mutated 0 doc(s).
  delete rcf/adrs/adr-001.json
```

Deleting a document that others depend on is refused (exit 4) unless you pass `--cascade` - the tree does not silently break.

## 5. Validate

Every `rcf` write is schema-validated on the way in, but you can also edit the JSON files by hand - the filesystem is the source of truth, not the tool. `rcf validate` walks the whole tree and reports schema violations and broken references:

```sh
rcf validate
```

```
rcf validate: tree is clean.
```

To see it catch something, hand-edit `rcf/user-stories/us-201.json` and change its `reqId` to `REQ-999`, then:

```sh
rcf validate
```

```
[error] brokenReference US-201: US US-201 references unknown REQ REQ-999
[error] 1 error found; output written with broken-section markers. Pass --strict to refuse the render.
```

Exit code 3. Everywhere in the CLI, exit 3 means the tree itself is unsound. Change the `reqId` back and `rcf validate` is clean again.

## 6. Ask the traceability questions

The point of keeping this structure is that mechanical questions get mechanical answers.

**Which requirements are actually covered by tests?**

```sh
rcf coverage
```

```
Coverage mode: shallow-any
Requirements: 2  covered: 0  uncovered: 2

Requirement  Covered  AC        AC covered  Test cases
-----------  -------  --------  ----------  ----------
REQ-001      no       AC-101-1  no          -
REQ-002      no       AC-201-1  no          -
                      AC-201-2  no          -
```

Zero covered - true, because nothing specifies tests yet. Coverage is answered by the test layer of the chain: a test suite (TS) owns test cases (TC), and each test case verifies one acceptance criterion. Specify the search behaviour:

```sh
rcf create ts --parent US-201 --title "Ingredient search behaviour" --purpose "Verify ingredient search returns complete and safe results." --test-level integration --acs AC-201-1,AC-201-2
rcf create tc --parent TS-001 --ac AC-201-1 --slug flour-search --description "Searching for flour lists every recipe that uses flour"
rcf create tc --parent TS-001 --ac AC-201-2 --slug unknown-ingredient --description "Searching for dragon fruit returns an empty list"
```

```
TS-001 created at rcf/test-suites/ts-001.json
TC-001-flour-search created at rcf/test-suites/ts-001.json
TC-001-unknown-ingredient created at rcf/test-suites/ts-001.json
```

```sh
rcf coverage
```

```
Coverage mode: shallow-any
Requirements: 2  covered: 1  uncovered: 1

Requirement  Covered  AC        AC covered  Test cases
-----------  -------  --------  ----------  -------------------------
REQ-001      no       AC-101-1  no          -
REQ-002      yes      AC-201-1  yes         TC-001-flour-search
                      AC-201-2  yes         TC-001-unknown-ingredient
```

`--strict` is the CI-gate form: per-AC coverage, exit 4 on any gap. With REQ-001 still uncovered it prints the same table and exits 4 - wire exactly that into a pipeline when you want "nothing unspecified gets merged".

**What does this document connect to?**

```sh
rcf trace US-201 --both
```

```
Trace pivot: US-201  direction: both

Ancestors:
Depth  Id       Kind  Title
-----  -------  ----  -----
-1     REQ-002  req
-2     PRD-001  prd

Pivot: US-201

Descendants:
Depth  Id                         Kind       Title
-----  -------------------------  ---------  -----
1      TS-001                     testSuite
1      AC-201-1                   ac
1      AC-201-2                   ac
2      TC-001-flour-search        tc
2      TC-001-unknown-ingredient  tc
```

`--forward` (the default) walks descendants, `--back` walks ancestry to the root - from a failing test case straight up to the product intent it protects:

```sh
rcf trace TC-001-flour-search --back
```

```
Trace pivot: TC-001-flour-search  direction: back

Depth  Id                   Kind       Title
-----  -------------------  ---------  -----
0      TC-001-flour-search  tc
-1     TS-001               testSuite
-2     AC-201-1             ac
-3     US-201               userStory
-4     REQ-002              req
-5     PRD-001              prd
```

**If this changes, what needs re-checking?**

```sh
rcf impact TAC-001
```

```
Impact pivot: TAC-001

Id                         Kind       Role        Action needed
-------------------------  ---------  ----------  -------------
TAC-001                    tac        pivot       -
TAD-001                    tad        ancestor    review-arch
US-201                     userStory  descendant  review-scope
TS-001                     testSuite  descendant  re-verify
AC-201-1                   ac         descendant  re-approve
AC-201-2                   ac         descendant  re-approve
TC-001-flour-search        tc         descendant  re-run
TC-001-unknown-ingredient  tc         descendant  re-run
```

One command, and "we are changing the search index" becomes a checklist.

All three verbs take `--format table|json|mermaid`. JSON is for programs:

```sh
rcf coverage --format json
```

```json
{
  "ok": false,
  "strict": false,
  "totals": {
    "requirements": 2,
    "covered": 1,
    "uncovered": 1
  },
  "requirements": [
    {
      "id": "REQ-001",
      "covered": false,
      "acs": [
        {
          "id": "AC-101-1",
          "covered": false,
          "testCases": []
        }
      ]
    },
    {
      "id": "REQ-002",
      "covered": true,
      "acs": [
        {
          "id": "AC-201-1",
          "covered": true,
          "testCases": [
            "TC-001-flour-search"
          ]
        },
        {
          "id": "AC-201-2",
          "covered": true,
          "testCases": [
            "TC-001-unknown-ingredient"
          ]
        }
      ]
    }
  ]
}
```

Mermaid renders the same answer as a diagram (GitHub renders the fence natively; `rcf view` renders it live). [How it works](how-it-works.md#2-the-document-chain) shows one.

## 7. Drive the build loop

The FBS documents under `rcf/fbs/` are the build queue: each Feature Build Spec carries a build order, a lifecycle status and dependency edges. Point the scaffolded first item at the capture story, and queue the search work behind it:

```sh
rcf update FBS-001 --set title="Save a recipe end to end" --set summary="Implement recipe capture: the recipe model, storage and the save flow behind AC-101-1."
rcf create fbs --parent BS-001 --title "Ingredient search" --acs AC-201-1,AC-201-2
rcf update FBS-002 --set 'dependsOnFbsIds=["FBS-001"]' --json
```

```
FBS-001 updated at rcf/fbs/fbs-001.json
FBS-002 created at rcf/fbs/fbs-002.json
FBS-002 updated at rcf/fbs/fbs-002.json
```

`rcf build` with no arguments is the queue overview:

```sh
rcf build
```

```
# Build queue: BS-001 - Initial build sequence

Generation strategy: dependencyFirst

| order | id | title | status | state | blocked by |
|---|---|---|---|---|---|
| 1 | FBS-001 | Save a recipe end to end | notStarted | actionable |  |
| 2 | FBS-002 | Ingredient search | notStarted | blocked | FBS-001 |

Totals: items 2 | notStarted 2 | inProgress 0 | complete 0 | verified 0 | actionable 1 | blocked 0

Next actionable: FBS-001
```

`rcf build --next` assembles the spec bundle for the next actionable item - the work, its acceptance criteria with full ancestry, the architectural context and a five-stage runbook - as a single markdown document. Print it, or sink it to a file to hand to an implementing agent:

```sh
rcf build --next --out fbs-001-bundle.md
```

```
bundle written to fbs-001-bundle.md
```

```sh
head -12 fbs-001-bundle.md
```

```
# Spec bundle: FBS-001 - Save a recipe end to end

## 1. Header

- Item: FBS-001 - Save a recipe end to end
- Queue: order 1, item 1 of 2
- Execution status: notStarted
- Parent chain: BS-001 -> PRD-001 (Recipe Box)
- Spec last touched: 2026-07-06T13:57:22.413Z

## 2. Queue and dependency context

```

Whoever drives the loop records lifecycle transitions as the work moves:

```sh
rcf build FBS-001 --mark inProgress
rcf build FBS-001 --mark complete
```

```
marked FBS-001 notStarted -> inProgress
marked FBS-001 inProgress -> complete
```

Completing FBS-001 unblocks the queue:

```sh
rcf build
```

```
# Build queue: BS-001 - Initial build sequence

Generation strategy: dependencyFirst

| order | id | title | status | state | blocked by |
|---|---|---|---|---|---|
| 1 | FBS-001 | Save a recipe end to end | complete | complete |  |
| 2 | FBS-002 | Ingredient search | notStarted | actionable |  |

Totals: items 2 | notStarted 1 | inProgress 0 | complete 1 | verified 0 | actionable 1 | blocked 0

Next actionable: FBS-002
```

The lifecycle is forward-only (`notStarted -> inProgress -> complete -> verified`); marking backwards is refused:

```sh
rcf build FBS-001 --mark inProgress
```

```
[error] refused build: refusing backward transition complete -> inProgress on FBS-001; for a deliberate correction use: rcf update FBS-001 --set executionStatus=inProgress
```

Exit code 4 - the "refused" code. The tool ships the marking primitive and the discipline: mark `complete` on merge, `verified` after post-merge verification.

## 8. Do it from your agent

Everything you just did by hand, an MCP-wired agent does over the same contract: eleven `rcf_*` tools mirroring the verbs (identical JSON envelopes), the tree served as resources, and two playbook prompts - `rcf_execute_build_cycle` for driving the build loop well, and `rcf_elicit_requirements` for drawing a tree like Recipe Box's out of a conversation with you instead of authoring it by hand. Registration is one config entry: [install, section 7](install.md#7-wire-into-an-agent-harness).

## 9. Where next

- [How it works](how-it-works.md) - the mental model behind what you just built, demonstrated on this repository's own tree.
- The [rcf-examples](https://github.com/Stravica/rcf-examples) gallery - `minimal-product` is the floor (about as small as a useful tree gets), `comprehensive-product` is the ceiling.
- `rcf help <verb>` - the full flag reference for every command you met here.
