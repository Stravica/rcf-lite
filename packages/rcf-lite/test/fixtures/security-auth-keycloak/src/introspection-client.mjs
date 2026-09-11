// TAC-1203 Keycloak introspection client shape. RFC 7662 says the
// introspection response is a JSON object with a boolean `active`
// field and, when active, additional fields the resource server
// may act on. This adapter builds the request body and parses the
// response shape.

export function buildIntrospectionForm({ token, clientId, clientSecret }) {
  if (!token) return { ok: false, error: 'token required' };
  if (!clientId || !clientSecret) return { ok: false, error: 'clientId and clientSecret required' };
  const body = new URLSearchParams();
  body.set('token', token);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  return { ok: true, body: body.toString() };
}

export function parseIntrospectionResponse(json) {
  if (!json || typeof json.active !== 'boolean') return { ok: false, error: 'response missing boolean `active` field per RFC 7662' };
  return {
    ok: true,
    active: json.active,
    principalId: json.sub || null,
    scope: json.scope || null,
    username: json.username || null,
  };
}
