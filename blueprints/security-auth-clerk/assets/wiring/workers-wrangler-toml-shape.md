# Workers wrangler.toml integration note

The wrangler-side configuration a project needs when the Clerk middleware runs inside a Cloudflare Worker. This is a composition boundary between this blueprint (owns the middleware and session-verifier contracts) and `deploy-cloudflare-workers` (owns the wrangler shape); the notes below are the Clerk-specific overlay a Workers deployer applies on top of that blueprint's wrangler-toml sample.

## The Clerk-specific overlay

```
# wrangler.toml - Clerk-specific overlay
compatibility_flags = ["nodejs_compat"]

[vars]
# Public URL of the Clerk-hosted sign-in surface. Not a secret; safe to
# commit. The middleware's HTML refusal path redirects here.
CLERK_SIGN_IN_URL = "https://<clerk-subdomain>.accounts.dev/sign-in"

[assets]
directory = "./public"
binding = "ASSETS"
# Every auth-gated route that could collide with a static file must appear
# here, or the assets binding serves the static file BEFORE the fetch
# handler runs and the middleware is silently bypassed. See the composition
# note below.
run_worker_first = ["/api/*", "/sign-in"]
```

Secrets are declared by name only, in the deploy blueprint's discipline: no `[secrets]` block in wrangler.toml (that block is decorative and not honoured by wrangler at 4.x, per the deploy blueprint's F-009 fix), and no value in any committed file. The two names the Clerk middleware reads are:

- `CLERK_SECRET_KEY` - server-side Clerk API key, read as `env.CLERK_SECRET_KEY` by `session-verifier.mjs`.
- `CLERK_PUBLISHABLE_KEY` - Clerk publishable key, read as `env.CLERK_PUBLISHABLE_KEY` by `session-verifier.mjs`.

Bootstrap-and-steady-state guidance for setting the values lives on the deploy blueprint's `bootstrap-vs-steady-state.md` asset; the shape is the same for both Clerk secrets.

## The auth-gate bypass finding

The default `[assets]` binding on a Cloudflare Worker serves any file in the assets directory at its path before the Worker's `fetch` handler runs. If an auth-gated route (`/notes` for a UI page, `/api/notes` for an API surface) collides with a static file at the same path, the static file is served without ever hitting the middleware. This is a silent auth bypass at ship time; a project ships assuming the middleware protects `/notes` and only finds out on the first live probe that `/notes` returned the HTML shell to an unauthenticated request.

The `run_worker_first` array is the wrangler-side fix: every path listed there is routed through the fetch handler before the assets binding gets a chance. A project on the middleware boundary shape should list every auth-gated route class on the list.

The composition responsibility is shared: `deploy-cloudflare-workers` teaches the mechanism (`run_worker_first` in wrangler-toml-shape.md, its US-12101 AC-12101-4 is the runtime-observable acceptance), and this blueprint teaches which routes need it (every auth-gated one on the project's HTTP surface). Neither blueprint carries the project's route list; that emerges from the project's own routing surface.

## What is NOT taught here

- **Which routes are gated.** The blueprint fixes the middleware boundary shape and the auth model. The concrete route list is a project decision the wrangler.toml integrates against.
- **How the assets binding composes with static-first vs worker-first per-path routing.** The rules and mechanism belong to the deploy blueprint.
- **Custom-domain vs workers.dev-only production URL.** Same: deploy blueprint concern. The Clerk overlay above is identical either way.

## Notes

- The `CLERK_SIGN_IN_URL` var is not a secret. Committing it in `wrangler.toml [vars]` is the default; a project that wants the value to differ across environments moves it to an environment-specific `[env.<name>.vars]` block per wrangler's standard shape.
- The `nodejs_compat` flag is required because `@clerk/backend` relies on Node built-ins. Without it, the Worker fails to start with a runtime error naming the missing built-in.
- Reading the secret at request time from `env` (not at module top-level from `process.env`) is what the workers-fetch-shape sample's `createVerify` factory does; the two files together are the enabling shape.
