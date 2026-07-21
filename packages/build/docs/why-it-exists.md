# Why it exists

## 1. Read this if

You are deciding whether to trust this method with your product. No commands on this page; the mechanics live in [how it works](how-it-works.md).

## 2. The problem

AI-built software has a confidence gap. The code exists, and it may even be good - but nobody can say with authority what it is supposed to do, whether it does it, or what breaks when something changes. The requirements lived in prompt history, which is not a specification: it is a transcript of how the builder felt on the way. When the person who prompted the system moves on, or simply forgets, the product's intent goes with them.

Traditional engineering answers this with requirements discipline - specifications, traceability matrices, test evidence. That discipline works, and it is why regulated industries insist on it. It also costs a level of clerical effort that a solo builder or a small product team was never going to spend, which is why most software has no requirements spine at all and AI-assisted software has even less.

## 3. What RCF is

The Requirements Confidence Framework is one unbroken, machine-checkable chain from product intent to test evidence: a product document owns requirements, requirements own user stories, stories own testable acceptance criteria, and test cases verify them - with an architecture chain and an ordered build queue attached to the same spine. Every link is a reference a tool can check, so "is anything unspecified?", "is anything untested?" and "what does this change break?" stop being judgement calls and become queries. The methodology itself is documented at [stravica.ai/rcf-methodology](https://stravica.ai/rcf-methodology).

## 4. Why "Build Lite"

Build Lite is the full-strength chain at minimum user effort. The discipline is not thinned down - the schemas, the validation, the coverage gate and the build queue are all present. What is removed is the clerical burden: the tooling assigns ids, keeps the edges consistent, validates every write, assembles work into implementable spec bundles and referees the loop. You answer questions about your product; the tool maintains the paperwork.

It is built for product owners and builders who do not have an engineering team - the person with a real product idea, an AI coding agent, and no appetite for maintaining a traceability matrix by hand. It is not yet for teams who need multi-user workflow, sign-off ceremony or hosted collaboration; that sits above this tool.

## 5. Why files and a CLI, not a platform

Your requirements live next to your code, as JSON files in your own repository. That is a deliberate architecture, not a budget decision:

- **Git-native.** Documents diff, branch, merge and review exactly like code. Your requirements history is your git history.
- **No lock-in.** The schemas are open, the files are yours, and losing the tool would lose you nothing but convenience.
- **Works offline.** No account, no service, no telemetry. A clone and Node 24 is the whole footprint.
- **Agent-operable by design.** Files and exit codes are the interface agents are best at. A platform would put a UI between your agent and the truth; a CLI puts a contract there instead.

## 6. Why open source from day one

A methodology that sells confidence cannot ask you to take confidence on faith. The code is Apache 2.0 and the proof mechanism is self-referential: this repository is built with RCF, its own tree sits in [`rcf/`](../rcf), and its own referee reports on it - including the parts that are unflattering, like the currently uncovered requirements ([how it works, section 7](how-it-works.md#7-this-repository-as-the-worked-example)). The artefacts are the demo. You can trace this product's intent the same way you will trace yours.

## 7. What comes next

Build Lite is the first tool in the RCF line; the intent is companions that deepen the two ends it referees - specifying products and verifying them. No dates and no feature promises: what ships is what the tree behind this repo says has shipped.
