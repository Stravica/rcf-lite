# Allow-list-file principal registry (project-authored pattern)

A common step past the single-address registry: a static file on disk holding the registered set, one address per line. The blueprint does not ship this implementation, but the pattern below is what most small teams end up with before they need a database.

## Interface satisfied

```
isRegistered(email) -> Promise<boolean>
```

## Configuration

The project supplies one field:

```json
{
  "registeredEmailsFile": "/etc/app/registered-emails.txt"
}
```

## File format

Plain text, one address per line, ignored:

- lines that start with `#` (comments)
- empty lines
- surrounding whitespace on each address

Example:

```
# Registered operators; edit and restart the app to apply.
operator@example.com
teammate@example.com

# On-call cover
oncall@example.com
```

## Behaviour

The registry reads the file once at start (or reloads on a project-owned signal) and holds the trimmed lowercase set in memory. `isRegistered(email)` returns true when the trimmed lowercase form of `email` is in the set, false otherwise.

## Why the blueprint does not ship it

Two reasons. First, the reload story is project-specific: some projects want a SIGHUP reload, some want a filesystem watcher, some want a restart-required posture. Second, the file location and permissions are project deployment concerns; hardcoding `/etc/app/...` in the blueprint is a WESPA leak of exactly the shape the authoring standard's provenance rule forbids. The blueprint documents the pattern here so a project writing it does not reinvent the shape.
