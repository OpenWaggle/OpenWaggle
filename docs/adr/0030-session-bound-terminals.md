# ADR 0030: Session-Bound Terminals With Persisted Scrollback

Date: 2026-09-03
Status: Proposed

## Context

OpenWaggle's terminal is a single project-keyed PTY. `terminal:create` takes a
project path, a module-level map in the IPC handler owns the process, and the
shell dies whenever the panel unmounts. ADR 0010 introduced Session worktrees,
so a worktree-mode session runs its agent in
`~/.openwaggle/worktrees/<repo>/<sessionId>` while the terminal still opens in
the original checkout — the user cannot run commands against the branch the
agent is working on. ADR 0020 recorded the gap: nothing ties a terminal to a
session.

T3 Code (pingdotgg/t3code) solves the same problem in its own app: terminals
are keyed `(threadId, terminalId)`, default to the thread's worktree, survive
hiding and reloads through persisted, sanitized scrollback replayed on attach,
and render through a Ghostty WASM engine in a tabbed, split-able drawer.

## Decision

We adopt t3code's terminal model, adapted to OpenWaggle's single-process
Electron architecture:

1. **Every terminal is a Session terminal.** Terminals are keyed
   `(sessionId, terminalId)` with client-chosen `terminalId`s. A terminal's
   cwd is the session's Working path: the Session worktree in worktree mode,
   the opened checkout in local mode, the project path for a pre-send draft.
   Opening a terminal never creates a worktree; a send does that (ADR 0010).
   Draft terminals keep running where they started after first send; only new
   terminals pick up the born worktree.

2. **PTYs live in the Electron main process, not a sidecar server.** T3 Code
   runs a separate server process because it supports remote and WSL backends.
   OpenWaggle has no such surface today; a main-process Effect service (port +
   adapter) gives us the same lifecycle semantics without a second process,
   IPC hop, and packaging surface. If remote terminals ever become real, the
   port boundary is where a sidecar adapter slots in.

3. **Terminals survive invisibility; scrollback is persisted state.** Hiding
   the panel, switching sessions, or reloading the window never kills a PTY.
   The main process caps scrollback at 5,000 lines per terminal, persists it
   to `userData/terminal-logs/` through a coalescing writer, strips
   query-response escape sequences from persisted chunks, and replays the
   snapshot on attach so reload restores visual state. A dead shell respawns
   on demand when its pane is viewed, after revalidating the cwd; a missing
   Working path surfaces an error instead of silently spawning elsewhere.

4. **Renderer is xterm.js 6 with the DOM renderer, not Ghostty WASM.** T3
   Code's Ghostty VT engine wins VT-parser microbenchmarks but brings a
   vendored WASM binary, a bespoke Canvas 2D renderer, and a custom
   IME/selection/surface stack we would own forever. We initially shipped
   xterm's WebGL addon, but it mis-scales glyphs inside the panel
   (devicePixelRatio/viewport mismatch — content renders tiny in the corner),
   the exact class of surface bug t3 code solved by hand-rolling a renderer;
   the DOM renderer is deterministic in-app and fast enough behind coalesced
   IPC. Revisit WebGL behind a user setting only with in-app visual
   validation.

5. **Output is coalesced, targeted, and offset-gated.** PTY chunks buffer
   ~10 ms per terminal and flush to windows attached to that terminal only —
   never broadcast to every window as today. Each terminal's output stream is
   cumulative-byte-offset; the attach snapshot reports the offset it covers
   and every output event carries its start/end offsets, so a pane drops
   exactly the span it already received via replay — no duplicated output
   during the attach round-trip, no buffering protocol needed. Detach is
   per terminal (pane unmount), never surface-wide.

6. **Lifecycle follows the session.** Deleting a session kills its PTYs and
   deletes its terminal history (t3code's close-for-thread with
   `deleteHistory`). Archiving keeps terminals running — archive is
   reversible, delete is not. Removing a Session worktree kills terminals
   whose cwd lived inside it.

7. **Parity scope.** Tabs, splits (≤ 4 visible panes per tab), rename, close,
   restart, clear, process-aware tab titles from a shared process-table poll,
   listening-port preview detection, in-terminal search and web links, a
   shell fallback chain, and Shortcut-registry commands with VSCode-style
   defaults (⌘J toggle stays; split uses ⌘\ since ⌘D belongs to diff.toggle).

## Consequences

- The `terminal:create(projectPath)` IPC contract and its handler are
  replaced by session-keyed channels; ADR 0020's terminal limitation note is
  superseded for terminals.
- Draft groups are keyed per project (`draft:<projectPath>`), so successive
  drafts in the same project reuse that project's draft terminals by design;
  the group migrates to the session key after first send, and new terminals
  then bind to the born Session worktree.
- Terminal history files appear under the app data directory; session delete
  must trigger terminal cleanup (new coupling between session lifecycle and
  the terminal service).
- The old single-terminal `terminalOpen` flag becomes a per-session panel
  state; docs that describe a project terminal need updating.
- Future remote/WSL terminals reuse the service port rather than this
  architecture changing.

## References

- T3 Code terminal manager: `apps/server/src/terminal/Manager.ts`
  (open/re-open semantics, history persistence, process activity).
- ADR 0010 (worktree-per-session), ADR 0018 (branch changes under a worktree
  are untracked — terminals changing branches inherit the same limitation),
  ADR 0020 (provenance vocabulary; terminal gap note).
