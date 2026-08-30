# From-address rotation pattern (generic)

The adapter's from-address is one configuration reference (`RESEND_FROM_ADDRESS`). A project that ships one product from one verified domain sets one value and moves on. A project that ships several product surfaces from several verified domains uses this pattern to keep the reference-per-surface story clean without hardcoding domain literals into the adapter or the auth wiring.

## Shape

```yaml
mailFromByProduct:
  productAlpha:
    reference: FROM_ADDRESS_PRODUCT_ALPHA
    subjectPrefix: "Product Alpha"
  productBeta:
    reference: FROM_ADDRESS_PRODUCT_BETA
    subjectPrefix: "Product Beta"
  transactional:
    reference: FROM_ADDRESS_TRANSACTIONAL
    subjectPrefix: null
```

- One reference name per surface. Values live in the vendor the project's secret resolver reads from; the map above carries only the reference names.
- The `subjectPrefix` is an optional string a surface may want prepended to the outbound subject; leave `null` for surfaces that pass a fully-composed subject.
- Any real domain, product name, or sender local-part stays out of this file; the map is a routing table over reference names, not a directory of live addresses.

## How the adapter reads the map

The project's composition wires a `mailFromSelector({ productKey })` in front of the adapter. The selector reads the map, resolves the reference name against the project's secret resolver, and passes the resolved from-address into the adapter's `send` call. The adapter itself continues to consume one from-address per call; the routing lives one level up.

## What the pattern is not

- Not a mail-templating engine. The `subjectPrefix` is a routing detail, not a template layer.
- Not a domain-verification workflow. The pattern assumes every reference in the map resolves to a value the provider has already verified; see `resend-verification-pointer.md` for where to point the operator for verification.
- Not a rate-limiting policy. Sending volume decisions live in a project-level ADR, not in this file.

## Example generic values (placeholders only)

The reference names above are illustrative. Real values look like generic placeholders and never appear in this file:

```
FROM_ADDRESS_PRODUCT_ALPHA -> notifications@example.test
FROM_ADDRESS_PRODUCT_BETA -> notifications@example.test
FROM_ADDRESS_TRANSACTIONAL -> notifications@example.test
```

`example.test` is the IETF reserved test domain; a real project resolves each reference to its own verified sender address inside the vendor the secret resolver reads from.
