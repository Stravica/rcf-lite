# Agent access pattern for the Secrets CLI

The CLI shape a coding agent should reach for. Every verb keeps the secret bytes off argv, off logs, and off stdout unless a real human on a real terminal has explicitly asked to see them.

## Reading a value into a downstream consumer

```
secrets read database-password | psql --dbname=app --username=api --password-from-stdin
```

`secrets read` writes the value to stdout as raw bytes. The pipe hands it to `psql`. The value crosses one pipe and no more.

## Reading a value into a spawned process (Node.js wrapper)

The pattern below shows the value being read from the CLI, handed to a child process as an environment variable set at spawn time, and never printed on the way through.

```js
import { spawn } from "node:child_process";

async function runWithSecret(secretName, envVarName, command, args) {
  const reader = spawn("secrets", ["read", secretName], {
    stdio: ["ignore", "pipe", "inherit"]
  });
  const chunks = [];
  for await (const chunk of reader.stdout) chunks.push(chunk);
  const value = Buffer.concat(chunks).toString("utf8").trimEnd();
  const readerExit = await new Promise(resolve => reader.on("exit", resolve));
  if (readerExit !== 0) {
    throw new Error(`secrets read ${secretName} exited ${readerExit}`);
  }
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, [envVarName]: value }
  });
  return await new Promise(resolve => child.on("exit", resolve));
}
```

The value is held in memory for the shortest time the pattern allows: read from the pipe, passed as a spawn env, and then out of scope. Nothing in this script writes it to a log, echoes it to stdout, or persists it to a file.

## Writing a value (rotation)

```
generate-fresh-secret | secrets put stripe-api-key
```

`secrets put` reads the value from stdin. Passing the value as a positional argument (`secrets put stripe-api-key HUNTER2`) is refused with `SECRETS_VALUE_ON_ARGV_REFUSED`; even the refusal message does not carry the value.

## Reading a metadata list

```
secrets list --json
```

Emits one JSON entry per manifest entry with fields `name`, `environment`, `owner`, `rotationDays`, `lastRotatedAt`, `required`. No entry carries a `value` or a hash of one; the admin UI's Secrets page renders against this same field set.

## Debug read for a human (terminal only)

```
secrets read database-password --show
```

The `--show` flag is honoured only when stdout is an actual TTY (not a captured stream, not a pipe, not a redirected file). This is the one legitimate reason to look at a value with your own eyes; it is deliberately not scriptable through an agent transcript.

## What NOT to do

- Do not embed a secret value as a literal in agent-authored code, configuration, or a scratch file, even temporarily. Every reference is by logical name through the client.
- Do not pass a value on argv to any command. If a downstream tool only accepts values on argv, wrap it in a small script that reads stdin and re-spawns the tool with the value as an environment variable set at spawn time.
- Do not echo the value from a debug print. The CLI's own logger runs through a redactor, but agent-authored code does not; a stray `console.log(process.env.SECRET)` in a working script defeats the whole discipline.
