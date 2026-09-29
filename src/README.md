# `entire.ts` — Entire CLI plugin, hand-ported to OpenCode V2

⚠️ **This file diverges from what `entire enable --agent opencode` generates.**

The Entire CLI (v0.11.3) auto-generates `.opencode/plugins/entire.ts` using the
OpenCode **V1** plugin API: a named `EntirePlugin` export returning V1 hook
keys. OpenCode **v2.0.18** requires a default-exported definition with an `id`
and a `setup` (or `effect`) function, so the generated V1 file failed to load
with:

> Plugin must export a default definition with an id and an effect or setup
> function (server log ref `err_757dac0c`, 2026-09-27)

As of entireio/cli v0.11.4-nightly (2026-09-26) upstream still generates the V1
file, so this is a **local port** of that generator output, following the
official V1→V2 plugin migration guide:
<https://opencode.ai/v2/docs/build/plugins/migrate-v1>

## Regeneneration warning

Running `entire enable --agent opencode` again will **overwrite this file** with
the incompatible V1 version and the plugin will fail to load again. If that
happens, restore this port from git history
(`git checkout -- .opencode/plugins/entire.ts`) and re-save it so the server
reloads it. Replace the port wholesale once Entire ships V2 support.

## Dependency

`import { Plugin } from "@opencode/plugin"` resolves through
`../package.json` + `../node_modules` (pinned to the running OpenCode version,
currently `2.0.18`). OpenCode does **not** install plugin dependencies itself.

When OpenCode is upgraded, bump the pin in `../package.json` to match the new
server version, run `npm install` in `.opencode/`, then re-save `entire.ts` to
trigger a plugin reload. If the plugin was loaded before `node_modules`
existed, the running server may fail resolution until `opencode service
restart` (its runtime caches the failure).

## V1 → V2 mapping applied

| V1                                                                          | V2                                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `export const EntirePlugin: Plugin = async ({ directory }) => ({…})`        | `export default Plugin.define({ id: "entire", setup(ctx) })` from `@opencode/plugin`                                                           |
| `directory`                                                                 | `ctx.location.directory`                                                                                                                       |
| returned `event` hook                                                       | `ctx.event.subscribe()` (server-wide stream, filtered to this location)                                                                        |
| `experimental.chat.system.transform`                                        | `ctx.session.hook("context")`, appending `{ type: "text", text }` to `event.system`                                                            |
| turn-start on the user message (`message.updated` / `message.part.updated`) | `session.inbox.enqueued` (carries the prompt text, fires before the first LLM call) with `session.inbox.delivered` fallback                    |
| model tracking from assistant messages (`modelID`)                          | `session.step.started`                                                                                                                         |
| turn-end on `session.status` idle                                           | `session.execution.succeeded\|failed\|interrupted` (plus `session.status` / `session.idle` fallbacks, guarded so turn-end fires once per turn) |
| session-end on `server.instance.disposed`                                   | `location.shutdown` / `global.disposed`                                                                                                        |

Hook payloads, the `sh -c` PATH guard around `command -v entire`, the
sync-vs-async spawn semantics, and the one-time context-injection capture are
preserved from the V1 file.

## Maintenance note

Change this file, not the original V1 source: the upstream version is what
`entire.enable` restores. The V2 event stream was verified against a live
OpenCode v2.0.18 server (`session.inbox.enqueued`, `session.execution.*`,
`session.status`, `location.shutdown` payloads) — re-verify those shapes if the
server version changes materially.
