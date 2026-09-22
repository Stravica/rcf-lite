# Capability tags

A convention on the requirement `tags[]` array that carries a lightweight
product taxonomy without a schema change. The Product Map tab on the
review surface consumes it (grouping "by capability"). Absence is not
an error at schema level; adopting the convention is a project decision.

## The convention

Each requirement carries one or more capability slugs on its existing
`tags[]` array, using the form:

```
capability:<kebab-slug>
```

Rules:

- Slug is `[a-z0-9]+(-[a-z0-9]+)*` — kebab-case, no leading digit-only
  segments, no underscores, no capitals.
- A requirement can carry more than one capability tag; it appears
  under each capability's bucket in the Product Map.
- A requirement with no `capability:<slug>` tag falls in an
  "Unclassified" bucket.
- Non-capability tags stay on the array unchanged; the convention rides
  alongside whatever tag hygiene the project already keeps.

## The rcf-lite taxonomy

Twelve slugs, derived from the actual verbs and surfaces of the shipped
rcf-lite chain. If a requirement genuinely spans two, tag it under
both.

| Slug | What it names |
|---|---|
| `project-init` | Scaffolding a new RCF project on disk; init, doctor, umbrella CLI plumbing. |
| `requirements-authoring` | Author-side verbs — create, read, update, delete, link, validate, EVAL wiring, tag conventions. |
| `build-sequence` | The FBS queue, the five-stage build cycle, spec-first build guidance. |
| `review-surface` | The read-only HTML review surface, its tabs, deep links, live streaming. |
| `mcp` | The local MCP surface over the full feature set. |
| `blueprint-library` | The blueprint library mechanism itself — composition, standards, companion resolution, shelf discipline. A blueprint is not a capability; a specific blueprint carries capabilities. This slug names the product's own blueprint mechanism (library, apply, shelf), not any concrete blueprint. |
| `applications-shelf` | Application-level blueprints — datatable, charts, dashboard, forms, notifications, account settings, and their probe packs. |
| `platform-integrations` | Cloudflare and other platform primitives — KV, cron, Durable Objects, tunnels, Hetzner. |
| `edge-security` | Access, Turnstile, rate-limiting; anything that sits in front of the app. |
| `deploy` | Deploy targets and hosting — deploy-cloudflare-workers, deploy-hetzner-server, docker-compose host. |
| `verify` | The independent verifier, browser-verify probes, referee guarantees, coverage strictness. |
| `feedback-loop` | The local-capture-through-submit feedback pipeline. |

## Adding a new capability

- Single-word verb or noun in kebab-case (two words maximum, joined by
  a hyphen). No fashion terms, no acronyms unless they are already the
  product's own vocabulary.
- Must map to an existing product surface or a deliberate near-term
  addition. If it names something a reader would not find in the
  requirements set, do not add it.
- Add the slug to the table above with its one-line meaning in the
  same PR that first uses it. A slug that is used but not documented
  is a defect.
- Promote to a proper schema field only if the tags earn their keep
  in the Product Map view over time. Until then, the convention is
  cheap to change and free to drop.

## Machine check

A test in the view suite verifies every REQ under
`packages/rcf-lite/rcf/requirements/` carries at least one
`capability:<slug>` tag, and that every slug used is listed in this
document. That test is the operational contract behind the convention.

## Blueprint attribution and the by-blueprint grouping

The Product Map ships a sixth grouping, "By blueprint", alongside the
capability grouping. It buckets requirements per contributing blueprint
using `manifest.blueprints[].contributions[]` (parsed by
`scope.contributionsForBlueprint`) as the source of truth, with an
`Application` bucket for the project's own (non-blueprint) requirements. Inside each
bucket the second level is the same capability convention documented
above. Every REQ row an applied blueprint contributed also carries a
compact blueprint badge (`.pm-blueprint-badge`) in the summary line
across every grouping - shape, component, trace coverage, capability
and the by-blueprint grouping itself.
