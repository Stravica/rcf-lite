# Generic OIDC (discovery-driven) provider record

A sample provider record shape for any OIDC provider that publishes an RFC 8414 or OIDC Core discovery document. Populate the endpoints from `<issuer>/.well-known/openid-configuration` at boot; the operator or the project code writes a one-off populator that fetches discovery and returns the record on this shape.

```
{
  id: '<OPERATOR_CHOSEN_STABLE_SLUG>',
  label: '<OPERATOR_CHOSEN_LABEL>',
  authorizeUrl: '<DISCOVERY.authorization_endpoint>',
  tokenUrl: '<DISCOVERY.token_endpoint>',
  userinfoUrl: '<DISCOVERY.userinfo_endpoint>',
  issuer: '<DISCOVERY.issuer>',
  jwksUri: '<DISCOVERY.jwks_uri>',
  endSessionEndpoint: '<DISCOVERY.end_session_endpoint>',
  clientId: '<PLACEHOLDER_CLIENT_ID>',
  clientSecret: '<PLACEHOLDER_CLIENT_SECRET>',
  scopes: ['openid', 'profile', 'email'],
  redirectUri: '<PLACEHOLDER_PROJECT_CALLBACK_URL>',
  flow: 'authorisation-code-pkce',
  providerKind: 'oidc',
  providerLogout: 'redirect',
  enabled: true
}
```

Notes for the operator:
- Discovery is a single fetch at boot; the populator caches the result or writes the record verbatim onto the config module.
- `providerLogout: 'redirect'` is safe when `endSessionEndpoint` is present; if the discovery document omits it, drop `providerLogout` to `'none'` or the adapter refuses boot per AC-10108-3.
- `id` is a project-local stable slug the operator chooses; it appears in `principalId` derivations and in the `?provider=<id>` query parameter, so keep it short and lowercase.

Do NOT commit the real `clientSecret` in the record; read it from `security-secrets-management` (when composed) or the process environment at boot.
