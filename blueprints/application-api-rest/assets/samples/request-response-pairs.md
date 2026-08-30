# Sample request-response pairs per verb class

Reference realisations of the wire contract (application-api-rest-REQ-002, application-api-rest-REQ-007, application-api-rest-REQ-009, application-api-rest-REQ-010) using the illustrative `widgets` resource from the OpenAPI skeleton. The shapes are normative; the resource is not. All timestamps RFC-3339 UTC, all properties camelCase, every response with an explicit Content-Type.

## GET, collection page (filtered, sorted, paginated)

```
GET /v1/widgets?status=active&sort=name,-createdAt&limit=2 HTTP/1.1
Authorization: Bearer <token>
```

```
HTTP/1.1 200 OK
Content-Type: application/json
X-Request-Id: 7f3a2c9e-4b1d-4e8a-9c6f-2d5b8e1a0f47

{
  "items": [
    {
      "id": "wgt_01j5xq",
      "name": "Alpha widget",
      "status": "active",
      "createdAt": "2026-08-19T09:14:07Z",
      "updatedAt": "2026-08-19T09:14:07Z"
    },
    {
      "id": "wgt_01j5xr",
      "name": "Beta widget",
      "status": "active",
      "createdAt": "2026-08-18T16:02:33Z",
      "updatedAt": "2026-08-19T08:41:12Z"
    }
  ],
  "next": "b3BhcXVlLWN1cnNvci0y",
  "prev": null
}
```

## GET, single resource

```
GET /v1/widgets/wgt_01j5xq HTTP/1.1
Authorization: Bearer <token>
```

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "wgt_01j5xq",
  "name": "Alpha widget",
  "status": "active",
  "createdAt": "2026-08-19T09:14:07Z",
  "updatedAt": "2026-08-19T09:14:07Z"
}
```

## POST, creation with idempotency key

```
POST /v1/widgets HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: 0d9f6a7e-create-alpha

{ "name": "Alpha widget" }
```

```
HTTP/1.1 201 Created
Content-Type: application/json
Location: /v1/widgets/wgt_01j5xq

{
  "id": "wgt_01j5xq",
  "name": "Alpha widget",
  "status": "active",
  "createdAt": "2026-08-19T09:14:07Z",
  "updatedAt": "2026-08-19T09:14:07Z"
}
```

Retried identically within the TTL: the same 201 body replays, nothing applies twice (AC-2112-3). Same key, different body: 422 problem details (AC-2112-4).

## PATCH, partial update returning the result

```
PATCH /v1/widgets/wgt_01j5xq HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{ "status": "archived" }
```

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "wgt_01j5xq",
  "name": "Alpha widget",
  "status": "archived",
  "createdAt": "2026-08-19T09:14:07Z",
  "updatedAt": "2026-08-19T11:20:45Z"
}
```

## DELETE, idempotent removal

```
DELETE /v1/widgets/wgt_01j5xq HTTP/1.1
Authorization: Bearer <token>
```

```
HTTP/1.1 204 No Content
```

Repeated DELETE of the same id: 404 with problem details is acceptable and documented; 500 is not.

## Error shapes

Validation failure (unknown query parameter, AC-2110-3):

```
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://example.com/problems/unknown-parameter",
  "title": "Unknown query parameter",
  "status": 400,
  "detail": "Parameter 'colour' is not declared for this endpoint. Declared parameters: cursor, limit, includeTotal, status, sort.",
  "instance": "urn:request:7f3a2c9e-4b1d-4e8a-9c6f-2d5b8e1a0f47"
}
```

Auth failure on a user-class endpoint (AC-2106-5):

```
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json

{
  "type": "https://example.com/problems/unauthenticated",
  "title": "Authentication required",
  "status": 401,
  "detail": "Provide a valid bearer token or session.",
  "instance": "urn:request:2b8e1a0f-9c6f-4e8a-4b1d-7f3a2c9e5d47"
}
```

Rate limit (application-api-rest-REQ-011):

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 12

{
  "type": "https://example.com/problems/rate-limited",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "User-class limit of 100 requests per 60s window exceeded. Retry after 12 seconds.",
  "instance": "urn:request:9c6f2d5b-8e1a-0f47-4b1d-7f3a2c9e4e8a"
}
```

Server failure (no internals leaked, AC-2111-4):

```
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json

{
  "type": "https://example.com/problems/internal",
  "title": "Internal server error",
  "status": 500,
  "detail": "An unexpected condition prevented the request from completing. Quote the instance id to support.",
  "instance": "urn:request:4e8a9c6f-2d5b-4b1d-8e1a-7f3a2c9e0f47"
}
```

## Probe shapes (application-api-rest-REQ-006)

```
GET /healthz/ready HTTP/1.1
```

Degraded:

```
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "status": "failing",
  "checks": [
    { "name": "database", "status": "ok" },
    { "name": "cache", "status": "failing", "detail": "connect timeout after 250ms" }
  ]
}
```
