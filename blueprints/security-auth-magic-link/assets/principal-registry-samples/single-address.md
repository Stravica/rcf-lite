# Single-address principal registry

The blueprint's TAC-505 ships one registry implementation: a single-address lookup for solo-operator deployments. The project supplies one email string at configuration time; the registry returns true only for that email (compared case-insensitively after trimming whitespace) and false for every other input.

## Interface satisfied

```
isRegistered(email) -> Promise<boolean>
```

## Configuration

The project supplies one field:

```json
{
  "registeredEmail": "operator@example.com"
}
```

## Behaviour table

| Input | Resolved |
|---|---|
| `operator@example.com` | `true` |
| `Operator@Example.COM` | `true` (case-insensitive) |
| `  operator@example.com ` | `true` (whitespace trimmed) |
| `other@example.com` | `false` |
| `""` | `false` |
| `null` or `undefined` | `false` |
| `"not-an-email"` | `false` (registry does not validate shape, but no match means false) |

## Why it exists

The rcf-lite tier this blueprint targets includes solo-operator projects (watchpost, personal dashboards, single-tenant admin surfaces). The single-address registry is the smallest useful implementation and demonstrates the boolean-only shape of the contract; projects that scale past one operator write their own allow-list-file or database-lookup implementation, keeping the same interface.
