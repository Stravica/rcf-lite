# guidance/discovery/

Home for project discovery artefacts: discovery briefs, prototype
notes, exploratory write-ups, and anything else that belongs to a
specific DISCOVERY-stage effort rather than the methodology pack
itself.

Files directly under `guidance/` are the methodology inventory,
locked by `test/guidance/inventory.test.js` and `test/mcp/resources.test.js`
and reachable through `rcf://docs/<slug>`. New additions there require a
coordinated test-code change and a manifest update.

Files here, under `guidance/discovery/<slug>.md`, do NOT need a manifest
update and are not served through the methodology-doc URIs. They still
carry the guidance posture (no em-dash, no non-canonical external URLs,
filename stem is a well-formed slug of lowercase letters, digits and
hyphens); `test/guidance/discovery-home.test.js` enforces that.

Companion home for engineer-facing docs: `docs/discovery/`.

Issue 322 carved out this subdir so a first-time contributor can land a
discovery brief without touching the methodology lock.
