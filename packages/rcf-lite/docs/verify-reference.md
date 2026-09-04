# rcf verify reference

The full technical surface of the verify stage inside `rcf-lite`. The `rcf verify <run|report|provision|cleanup|mcp>` subcommand tree is the primary surface; the `rcf verify` bin is a transition-grace alias that dispatches to the same handlers and prints a one-line deprecation notice on stderr (silenceable with `RCF_QUIET=1`). If you're new here, start with the [README](../README.md); this page is the detail behind it.

> **Two different things are called "prerequisites" here.** [Runtime requirements](#runtime-requirements) is what *you* need installed for the verify pass to run at all. [Prerequisite provisioning](#prerequisite-provisioning-app-state) is about state your *app under test* needs (accounts, sandboxes, seed data) and is a feature of `run`, not a setup step. If a first run fails to launch, you want runtime requirements.

## Runtime requirements

Verify launches a separate agent and gives it a browser; the machine running `rcf verify` supplies both. The [README](../README.md) carries the full what/why/how. In summary:

| Requirement | Why | Satisfy it with |
|---|---|---|
| Node.js >= 24 | `"engines": { "node": ">=24.0.0" }` | [nodejs.org](https://nodejs.org) |
| `claude` on `PATH` | the verifier agent is Claude Code, spawned by bare name | [Claude Code](https://docs.claude.com/en/docs/claude-code/setup), or override with `RCF_VERIFY_LAUNCHER` |
| A local Claude Code login | verify passes its own env to the agent; it holds no credential of its own | `claude` once interactively; authenticate CI runners the same way |
| `npx` on `PATH` | browser tooling is provisioned as `npx -y @playwright/mcp@<PLAYWRIGHT_MCP_VERSION>` (the pinned version rcf-lite ships with) | ships with Node |
| Network egress | npm registry (`@playwright/mcp` at the pinned version), Anthropic's API, and your app's URL | allow all three in restricted CI |
| A browser | `@playwright/mcp` drives a real browser; **nothing in the install chain downloads one** | system Google Chrome by default, else `npx @playwright/mcp install-browser <name>` |

Every one of these fails at *run* time, not install time. A missing `claude`, an unauthenticated machine, or no browser all surface as a verifier-agent launch failure (exit code 1).

## Commands

```
rcf verify run            Run adversarial verification and emit a report artifact
rcf verify report <path>  Re-render a prior report artifact
rcf verify provision      Stand up prerequisite accounts/sandboxes/data standalone
rcf verify cleanup        Tear down provisioned artefacts (all prefixed 'zzverify-')
rcf verify mcp            Serve verify over MCP (local stdio)
rcf help verify           Print help for the verify subcommand
```

`rcf help verify <command>` is the authoritative flag reference for each. The transition-grace `rcf verify <command>` bin accepts the same shapes; every example on this page has an equivalent `rcf verify <command>` form.

## `run` - the verification pass

```sh
rcf verify run \
  --repo <path-to-rcf-chain> \
  --profile <deployed|ci|local-dev> \
  --url <running-app-url> \
  --out report.json \
  [--parity-env] [--provision creds.json] \
  [--severity-gate BROKEN] [--provision-mode run|skip] [--persona name] \
  [--playwright-mcp-version <semver>]
```

The verifier agent receives only the RCF chain (the acceptance contract) and the URL. It never reads the source tree, the test suite, or the builder's self-report; that information disjointness is what makes the verdict independent.

### Pinned Playwright MCP version

`rcf-lite` pins the `@playwright/mcp` version verify runs against; the pinned value lives as `PLAYWRIGHT_MCP_VERSION` in `packages/rcf-lite/src/verify/engine/launcher.js` and every `rcf verify run` composes `npx -y @playwright/mcp@<PLAYWRIGHT_MCP_VERSION>` from it. The pin closes the reproducibility hole that `@latest` opened (a Playwright MCP release could otherwise become a silent runtime change on the next verify run). The preflight prints one line naming the effective pin:

```
Playwright MCP: pinned to @playwright/mcp@<version>
```

`--playwright-mcp-version <semver>` overrides the pin for one run. It exists for a specific emergency: a pinned Playwright MCP release is discovered broken and the fix ships at a later version before rcf-lite can cut a patch bump. The override fires a loud stderr notice that is not silenceable by any quiet flag:

```
Playwright MCP: OVERRIDE @playwright/mcp@<override> (pinned default: <pin>)
```

A non-semver value refuses with exit 2 and the message `--playwright-mcp-version expects a semver string, got '<value>'`. The report artefact always records the effective pin (default or overridden) as `run.runStats.playwrightMcpVersion` so a later `rcf verify report <path>` re-render tells the operator exactly which browser tooling this pass ran against.

## Runtime profiles and verdict authority

Every verdict is stamped with the runtime profile it ran against. Authority is capped by profile: a lower profile can never claim the authority of `deployed`.

| Profile | Verdict authority |
|---|---|
| `deployed` | SHIP-readiness verdict (the ship gate). A local or unreachable URL under `deployed` yields `NOT-DEPLOYED`, never a soft pass. |
| `ci` | Correctness/regression verdict. Ship gate **only** with `--parity-env` (a declared production-parity environment). |
| `local-dev` | Correctness/regression verdict. Never a ship gate. |

`localhost` is a first-class target under `ci`/`local-dev`. What is forbidden is a lower profile masquerading as `deployed`.

## Exit codes (`run`)

```
0  report written, verdict below the severity gate
1  IO / unexpected runtime failure (incl. verifier-agent launch failure)
2  usage error
3  chain could not be loaded
5  severity gate tripped, or NOT-DEPLOYED / BLOCKED
```

The exit code is the machine-readable gate: `rcf build finalise` (also part of [rcf-lite](https://www.npmjs.com/package/rcf-lite)) promotes a build spec to `verified` only on exit 0.

## EVAL coverage preflight (rcf-schemas 0.6.0)

`rcf verify run` prints a preflight-style line summarising EVAL coverage for the chain:

```
EVAL coverage: nonDeterministic=<n>, covered=<k>, missing=<n-k>
```

or, on chains with no non-deterministic ACs:

```
EVAL coverage: no nonDeterministic ACs on this chain
```

An AC declared `determinism: "nonDeterministic"` without a resolving EVAL surfaces on `report.perAcVerdicts[]` as `EVAL-MISSING`; an AC whose bound EVAL's freshest run failed surfaces as `EVAL-BELOW-THRESHOLD`. Both refuse `rcf build finalise` promotion to `verified` unless the operator opts out with `--ship-without-eval "<reason>"` (the acknowledgement lands on the manifest under `shipWithoutEval[]`). Deterministic ACs are never subject to either verdict; TS/TC coverage remains the sole contract for them. `report.run.runStats.evalCoverage` mirrors the counts for report re-render.

## Prerequisite provisioning (app state)

Not to be confused with [Runtime requirements](#runtime-requirements) above: this section is about state your *app under test* needs, not about what you need installed to run verify.

Adversarial testing often needs state: auth accounts, third-party service sandboxes, seed data. `run` provisions declared prerequisites before the pass and tears them down after; `provision` / `cleanup` expose the same machinery standalone. Everything provisioned is prefixed `zzverify-` so cleanup is unambiguous. A prerequisite that cannot be provisioned yields `BLOCKED`, never a silent skip of the journeys that needed it.

## Verifier-agent launcher

Verify launches an isolated fresh agent (Claude Code by default) with the isolation environment (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` + `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`) and browser tooling; that agent drives the running app and returns structured findings.

The launcher is injectable via the `RCF_VERIFY_LAUNCHER` env var (a module exporting `launchAgent`), which is the seam used for integration harnesses and recorded end-to-end runs.

## MCP mode

`rcf verify mcp` serves the verify surface over MCP (local stdio) for agent harnesses that speak it. The MCP server identifies itself on the wire as `rcf-verify-lite` (the pre-0.7.1 scoped package name) for continuity with existing client configs; do not treat that string as a package identifier.
