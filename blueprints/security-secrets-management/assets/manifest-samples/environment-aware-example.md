# Environment-aware manifest shapes (samples)

The `environments` array is elicited from the operator at first apply. Two common shapes and a pick guide.

## Shape A: three-env `dev` / `ci` / `live`

```yaml
environments:
  - dev
  - ci
  - live
```

Suits a project with a single production target, one CI runner pool, and one developer laptop pattern. `dev` and `ci` values may point at safely fake or shared-test credentials; `live` values point at real vendor-issued production credentials.

## Shape B: project-specific list

```yaml
environments:
  - dev
  - preview
  - staging
  - prod
```

Suits a project with per-PR preview deployments, a shared staging environment, and a promoted-to-production target. Every entry's `paths` object must carry a key for each of the four; the loader refuses a partial entry.

## Pick guide

- Prefer the smallest environment list that captures every meaningfully-distinct resolution path. Adding an environment adds a slot to every entry's `paths` and is a re-encrypt for every value on the default SOPS+age vendor.
- Do not use environment names as feature flags. `dev-with-fake-payments` is a separate concern; keep environments to distinct deployment contexts.
- Name environments as lower-kebab strings; the loader refuses other shapes.
- The environment set is a boot-time selector; a process selects exactly one environment at start-up and holds it for its lifetime. A deployable that needs to switch environments mid-life is misusing the concept; that is what per-request tenancy is for at the application layer, not what environments are for at the secrets layer.
