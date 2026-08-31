# Provider selector: list-shape rendering

The reference rendering TAC-1104 emits when the project has N>1 configured providers. Framework-agnostic HTML string; a project on React, Vue, or another rendering pipeline substitutes its own selector surface as long as it honours the query-parameter contract on `/auth/sign-in?provider=<id>`.

## Rendered shape (illustrative, not a template lock)

```
<main data-selector="oauth2-providers">
  <h1>Sign in</h1>
  <ul>
    <li><a href="/auth/sign-in?provider=google">Sign in with Google</a></li>
    <li><a href="/auth/sign-in?provider=github">Sign in with GitHub</a></li>
    <li><a href="/auth/sign-in?provider=corporate-sso">Sign in with Corporate SSO</a></li>
  </ul>
</main>
```

## Query-parameter contract

- `GET /auth/sign-in?provider=<id>` initiates a flow against the named provider.
- `GET /auth/sign-in` with N==1 short-circuits to the single provider.
- `GET /auth/sign-in` with N>1 renders this selector (or the project's replacement).
- Any `provider=<unknown-id>` is refused with `OAUTH2_PROVIDER_UNKNOWN` (AC-10109-2).

## Substituting a bespoke selector

A project that wants a branded rendering replaces the route handler that TAC-1104 provides; the substituted handler reads the same `providerConfig` module and renders however it wants, then links each choice to `/auth/sign-in?provider=<id>`. The state machine downstream is unchanged. There is no other seam to observe: the contract is the query parameter.
