# OpenCode Entire Plugin

Unofficial Entire CLI integration for OpenCode V2, hand-ported from the V1 plugin that `entire enable --agent opencode` generates.

## Why

The Entire CLI (v0.11.3) generates `.opencode/plugins/entire.ts` using the OpenCode **V1** plugin API: a named `EntirePlugin` export returning V1 hook keys. OpenCode **v2.0.18** requires a default-exported definition with an `id` and a `setup` (or `effect`) function, so the generated file fails to load with:

> Plugin must export a default definition with an id and an effect or setup function (server log ref `err_757dac0c`, 2026-09-27)

As of entireio/cli v0.11.4-nightly (2026-09-26) upstream still generates the V1 file. This package is a port of that output following the official [V1→V2 plugin migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1).

## Requirements

- OpenCode >= 2.x
- Entire CLI >= 0.11

## Installation

Copy [`src/entire.ts`](src/entire.ts) to `.opencode/plugins/entire.ts` (project) or your global OpenCode plugins directory.

The plugin imports `@opencode/plugin`, and OpenCode does **not** install plugin dependencies itself. Install it next to the plugin and keep it pinned to the running OpenCode server version (currently `2.0.18`). When OpenCode is upgraded, bump the pin, reinstall, then re-save `entire.ts` to trigger a plugin reload. If the plugin loaded before `node_modules` existed, the server may keep failing resolution until `opencode service restart` (its runtime caches the failure).

## Regeneration warning

Running `entire enable --agent opencode` again **overwrites the plugin** with the incompatible V1 version, and it will fail to load again. Restore this port (e.g. `git checkout -- .opencode/plugins/entire.ts`) and re-save it so the server reloads it. Replace the port wholesale once Entire ships V2 support.

## V1 → V2 mapping

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
| returned dispose hook                                                       | function returned from `setup`, aborting the event subscription                                                                                |

Hook payloads, the `sh -c` PATH guard around `command -v entire`, the sync-vs-async spawn semantics, and the one-time context-injection capture are preserved from the V1 file. Hooks use `node:child_process` so they work under both Bun (OpenCode server) and Node (OpenCode Desktop's Electron sidecar); see entireio/cli#2014.

## Maintenance

Change `src/entire.ts`, not the original V1 source: the upstream version is what `entire enable` restores. The V2 event stream was verified against a live OpenCode v2.0.18 server (`session.inbox.enqueued`, `session.execution.*`, `session.status`, `location.shutdown` payloads); re-verify those shapes if the server version changes materially.

## Development

```bash
bun install
bun run format
bun run lint
bun run typecheck
```
