// Entire CLI plugin for OpenCode — hand-ported to the OpenCode V2 plugin API.
//
// ⚠️ Read README.md in this directory before touching this file. It documents
// why this file diverges from what `entire enable --agent opencode` generates
// (that V1 output fails to load on OpenCode v2 with ref err_757dac0c), how to
// restore this port after a regeneration, and the `@opencode/plugin`
// dependency pinned in ../package.json.
//
// Uses node:child_process so hooks work under both Bun (OpenCode server) and
// Node (OpenCode Desktop's Electron sidecar). See entireio/cli#2014.
import { spawn, spawnSync } from "node:child_process";
import { Plugin } from "@opencode/plugin";

type EntireEvent = {
  type: string;
  location?: { directory?: string } | undefined;
  data?: any;
};

export default Plugin.define({
  id: "entire",
  async setup(ctx) {
    const directory = ctx.location.directory;
    // Track seen user inbox items to fire turn-start only once per prompt
    const seenUserMessages = new Set<string>();
    // Track the current session ID for this location (events are server-wide)
    let currentSessionID: string | null = null;
    // Whether a turn-start has fired without its turn-end yet (guards the
    // several V2 idle signals so turn-end fires exactly once per turn)
    let turnActive = false;
    // Track the model used by the most recent assistant step
    let currentModel: string | null = null;
    // One-time model-context injection captured from the turn-start hook's
    // stdout, applied on the next LLM call via the session "context" hook.
    let pendingInjection: string | null = null;

    /**
     * Build the shell command for a hook invocation.
     * Uses sh -c so the command is guarded by a `command -v` probe: when the
     * entire binary is not on PATH the hook exits 0 rather than failing the
     * surrounding OpenCode operation.
     */
    function hookCmd(hookName: string): string[] {
      return [
        "sh",
        "-c",
        `if ! command -v entire >/dev/null 2>&1; then exit 0; fi; exec entire hooks opencode ${hookName}`,
      ];
    }

    /**
     * Pipe JSON payload to an entire hooks command (async).
     * Errors are logged but never thrown — plugin failures must not crash OpenCode.
     */
    async function callHook(hookName: string, payload: Record<string, unknown>) {
      try {
        const json = JSON.stringify(payload);
        const [cmd, ...args] = hookCmd(hookName);
        await new Promise<void>((resolve) => {
          const proc = spawn(cmd, args, {
            cwd: directory,
            stdio: ["pipe", "ignore", "ignore"],
          });
          proc.on("error", () => resolve());
          proc.on("close", () => resolve());
          proc.stdin?.end(json + "\n");
        });
      } catch {
        // Silently ignore — plugin failures must not crash OpenCode
      }
    }

    /**
     * Synchronous variant for hooks that must complete before subsequent agent work
     * or process exit. `turn-start` must finish initializing session state before a
     * fast mid-turn commit can hit git hooks, and `turn-end` / `session-end` must
     * finish before location teardown unloads this plugin.
     */
    function callHookSync(hookName: string, payload: Record<string, unknown>) {
      try {
        const json = JSON.stringify(payload);
        const [cmd, ...args] = hookCmd(hookName);
        spawnSync(cmd, args, {
          cwd: directory,
          input: json + "\n",
          stdio: ["pipe", "ignore", "ignore"],
        });
      } catch {
        // Silently ignore — plugin failures must not crash OpenCode
      }
    }

    // parseInjectedContext scans a hook's stdout for Entire's injection envelope
    // ({"inject_context":"..."}) and returns the text to inject, or null.
    function parseInjectedContext(stdout: string): string | null {
      if (!stdout) return null;
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed) as { inject_context?: unknown };
          if (typeof parsed.inject_context === "string" && parsed.inject_context.length > 0) {
            return parsed.inject_context;
          }
        } catch {
          // not our envelope — ignore
        }
      }
      return null;
    }

    // fireTurnStart fires turn-start synchronously (state must be ready before
    // mid-turn commits) and stashes any model-context injection emitted on stdout
    // for the session "context" hook to apply. Entire emits the injection at most
    // once per session, so pendingInjection is set on the first turn only.
    function fireTurnStart(payload: Record<string, unknown>) {
      turnActive = true;
      try {
        const json = JSON.stringify(payload);
        const [cmd, ...args] = hookCmd("turn-start");
        const proc = spawnSync(cmd, args, {
          cwd: directory,
          input: json + "\n",
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        });
        const out = typeof proc.stdout === "string" ? proc.stdout : "";
        const injected = parseInjectedContext(out);
        if (injected) pendingInjection = injected;
      } catch {
        // Silently ignore — plugin failures must not crash OpenCode
      }
    }

    function resetSessionTracking(sessionID: string) {
      if (currentSessionID === sessionID) {
        return false;
      }
      seenUserMessages.clear();
      currentModel = null;
      turnActive = false;
      currentSessionID = sessionID;
      // Drop any turn-start injection captured for the prior session so it
      // can't leak into the new session's system prompt.
      pendingInjection = null;
      return true;
    }

    // Apply the one-time Entire context injection captured at turn-start by
    // appending it to the system prompt for this LLM call.
    // (V1: experimental.chat.system.transform)
    await ctx.session.hook("context", (event) => {
      if (pendingInjection && Array.isArray(event.system)) {
        event.system.push({ type: "text", text: pendingInjection });
        pendingInjection = null;
      }
    });

    // (V1: the returned `event` hook) Subscribe to the server's public event
    // stream. The stream carries events from every location the server hosts,
    // so handleEvent filters to this plugin's location first.
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal }) as AsyncIterable<EntireEvent>) {
          try {
            await handleEvent(event);
          } catch {
            // Silently ignore — plugin failures must not crash OpenCode
          }
        }
      } catch {
        // Stream ended or aborted during teardown — ignore
      }
    })();

    async function handleEvent(event: EntireEvent) {
      // The event stream is server-wide: ignore events belonging to other
      // locations. Events without a location are guarded by sessionID below.
      const eventDirectory = event.location?.directory;
      if (eventDirectory !== undefined && eventDirectory !== directory) return;
      const data = event.data ?? {};
      const sessionID: string | undefined = data.sessionID;

      switch (event.type) {
        // (V1: session.created) Start tracking a newly created session.
        case "session.created": {
          if (!sessionID) break;
          // Reset per-session tracking state when switching sessions.
          if (resetSessionTracking(sessionID)) {
            await callHook("session-start", {
              session_id: sessionID,
            });
          }
          break;
        }

        // (V1: message.part.updated on the first user text part) The prompt
        // entering the session inbox is the earliest signal that carries the
        // prompt text, and it arrives before the first LLM call.
        case "session.inbox.enqueued": {
          if (!sessionID) break;
          if (resetSessionTracking(sessionID)) {
            callHookSync("session-start", {
              session_id: sessionID,
            });
          }
          const item = data.item;
          if (item?.type === "user" && data.inboxID && !seenUserMessages.has(data.inboxID)) {
            seenUserMessages.add(data.inboxID);
            fireTurnStart({
              session_id: sessionID,
              prompt: typeof item.payload?.text === "string" ? item.payload.text : "",
              model: currentModel ?? "",
            });
          }
          break;
        }

        // (V1 fallback: message.updated on the user message itself) If the
        // enqueued event was missed, fall back to the delivered event and
        // fetch the prompt text through the session context.
        case "session.inbox.delivered": {
          if (!sessionID || !data.inboxID || seenUserMessages.has(data.inboxID)) break;
          seenUserMessages.add(data.inboxID);
          if (resetSessionTracking(sessionID)) {
            callHookSync("session-start", {
              session_id: sessionID,
            });
          }
          let prompt = "";
          try {
            const messages: unknown = await ctx.session.context({ sessionID });
            const message = (Array.isArray(messages) ? messages : []).find((m: any) => m?.id === data.inboxID);
            if (typeof message?.text === "string") prompt = message.text;
          } catch {
            // Keep an empty prompt rather than skipping the turn
          }
          fireTurnStart({
            session_id: sessionID,
            prompt,
            model: currentModel ?? "",
          });
          break;
        }

        // Track the model used by the most recent assistant step
        // (V1: message.updated on assistant messages' modelID)
        case "session.step.started": {
          const model = data.model;
          if (model?.id) currentModel = String(model.id);
          break;
        }

        // (V1: session.status idle) A finished execution ends the turn. Some
        // flows surface other idle signals instead, so the session.status and
        // session.idle cases below act as fallbacks; turnActive guards them
        // so turn-end fires exactly once per turn.
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted": {
          if (!sessionID || sessionID !== currentSessionID || !turnActive) break;
          turnActive = false;
          callHookSync("turn-end", {
            session_id: sessionID,
            model: currentModel ?? "",
          });
          break;
        }

        // Idle fallbacks. session.status carries {status: {type: "idle"|"busy"|…}}
        // in V2 as it did in V1; session.idle is the bare idle signal.
        case "session.status":
        case "session.idle": {
          if (event.type === "session.status" && data.status?.type !== "idle") break;
          if (!sessionID || sessionID !== currentSessionID || !turnActive) break;
          turnActive = false;
          callHookSync("turn-end", {
            session_id: sessionID,
            model: currentModel ?? "",
          });
          break;
        }

        case "session.compacted": {
          if (!sessionID) break;
          await callHook("compaction", {
            session_id: sessionID,
          });
          break;
        }

        case "session.deleted": {
          if (!sessionID) break;
          // Use sync variant: session-end may fire during shutdown.
          callHookSync("session-end", {
            session_id: sessionID,
          });
          if (sessionID === currentSessionID) {
            seenUserMessages.clear();
            currentSessionID = null;
            turnActive = false;
            currentModel = null;
            pendingInjection = null;
          }
          break;
        }

        // (V1: server.instance.disposed) Fires when this location shuts down
        // (e.g. `opencode run` exit) or the whole server disposes — the only
        // reliable way to end sessions on exit, since session.deleted fires
        // only on explicit user deletion.
        case "location.shutdown":
        case "global.disposed": {
          // location.shutdown fires for every hosted location; only this one's
          // teardown should end this plugin's tracked session.
          if (event.type === "location.shutdown" && eventDirectory !== directory) break;
          if (!currentSessionID) break;
          const ended = currentSessionID;
          seenUserMessages.clear();
          currentSessionID = null;
          turnActive = false;
          currentModel = null;
          pendingInjection = null;
          // Use sync variant: this is the last event before teardown.
          callHookSync("session-end", {
            session_id: ended,
          });
          break;
        }
      }
    }

    // (V1: the returned dispose hook) Abort the event subscription on unload.
    return () => {
      controller.abort();
    };
  },
});
