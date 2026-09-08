# ADR 0030: Session-Bound Terminals With Persisted Scrollback

Date: 2026-09-03
Status: accepted

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
   On first send, the draft group is atomically re-keyed to the born Session
   without restarting its PTYs or losing layout and scrollback. Those inherited
   panes stay in the original checkout and are visibly labelled as such. New
   terminals use the Session worktree. Moving an inherited pane into that
   worktree is an explicit restart action, with the normal foreground-process
   close protection.

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
   Working path surfaces an error instead of silently spawning elsewhere. A
   renderer reload attached to the same live PTY replays seamlessly. After a
   full app restart, persisted output is visibly separated as `Previous
   terminal session`, historical input and TUI modes are neutralized, and a
   clean shell starts below it; replay never impersonates a live old TUI.

4. **Renderer is xterm.js 6 with the DOM renderer, not Ghostty WASM.** T3
   Code's Ghostty VT engine wins VT-parser microbenchmarks but brings a
   vendored WASM binary, a bespoke Canvas 2D renderer, and a custom
   IME/selection/surface stack we would own forever. We initially shipped
   a guarded xterm WebGL path and verified its DPR geometry and throughput,
   but real-Electron screenshot analysis found an almost blank completed flood
   viewport even though the canvas backing size was correct. The DOM renderer
   visibly paints the same workload and stays inside the latency and long-task
   budgets behind coalesced IPC. The failed WebGL experiment and its dependency
   are removed; a future renderer change must first pass the same visible-ink
   gate in the packaged app. xterm 6.0 stable does not implement the Kitty
   keyboard protocol used by modern TUIs, so the renderer pins the aged,
   published `6.1.0-beta.303` build exactly and enables its upstream
   `vtExtensions.kittyKeyboard` state machine. Legacy encoding remains active
   until the child process negotiates Kitty flags; press, repeat, and release
   events then use xterm's protocol encoder. Any app or clipboard shortcut
   claimed before xterm records its physical key code and consumes the paired
   release, preventing an orphan Kitty keyup. The pin moves back to a stable
   xterm release once the same protocol lands there, after the protocol,
   performance, and visible-Electron gates pass again.

5. **Output is coalesced, targeted, and offset-gated.** PTY chunks buffer
   ~10 ms per terminal and flush to windows attached to that terminal only —
   never broadcast to every window as today. Each terminal's output stream is
   cumulative-byte-offset; the attach snapshot reports the offset it covers
   and every output event carries its start/end offsets, so a pane drops
   exactly the span it already received via replay — no duplicated output
   during the attach round-trip. The local desktop adapter permits one
   terminal-wide in-flight chunk because all attached local panes share the
   same main-process history and a replacement pane reconciles that chunk from
   its attach snapshot. Detach is per terminal (pane unmount); renderer reload
   or death releases only terminals that lost their final attached surface.
   This local ACK shape is not the remote protocol. A future remote or
   multi-subscriber adapter must keep a cursor and acknowledgement per
   subscriber, bind both queued-item and queued-byte counts, and resume or
   retry from that subscriber's last applied sequence. One slow or disconnected
   subscriber must never stall another subscriber or the PTY.

6. **Lifecycle follows the session.** Deleting a session kills its PTYs and
   deletes its terminal history (t3code's close-for-thread with
   `deleteHistory`). Archiving stops its hidden process trees but retains
   scrollback and layout, so unarchive restores state and starts clean shells.
   Removing a Session worktree kills terminals whose cwd lived inside it.
   Session archive/delete and worktree removal hold an owner- or path-scoped
   mutation fence until terminal shutdown and history cleanup complete. New
   terminal operations cannot race through the gap between the destructive
   mutation and its cleanup.

7. **T3 Code desktop parity is a floor, not a selected feature list.** Every
   terminal capability and interaction shipped by T3 Code's Electron desktop
   on macOS, Windows, and Linux is required. This includes terminal groups,
   tabs, horizontal and vertical splits, rename, confirmed destructive close,
   restart, clear, process-aware labels, listening-port previews, search, URL
   and file links, copy and paste menus, selection-to-chat, keyboard, IME,
   mouse and clipboard fidelity, appearance controls, contextual shortcuts,
   accessibility, lifecycle, and persistence. OpenWaggle-specific
   improvements ship when they make the terminal safer, faster, or more useful
   in an agent workflow. Known T3 Code defects are not parity behavior and
   must not be copied. T3 Code's web, mobile, and remote-host surfaces are not
   part of this parity floor. The comparison uses T3 Code's latest stable
   release plus terminal changes merged to its main branch, followed by a
   fresh audit immediately before this work merges. Later T3 Code changes are
   follow-up work unless they fix a defect OpenWaggle also has.
   T3's independently owned right-side terminal group is part of the floor:
   the drawer and side panel can coexist, tabs move explicitly between them,
   and one PTY is never mounted in both locations.

8. **Shell fidelity means the user's shell environment, not another terminal
   emulator's profile.** Each Session terminal uses the user's default shell,
   startup configuration, exported environment, locale, authentication and
   display-session variables, and compatible terminal capability markers.
   OpenWaggle continues to own terminal fonts, colours, and shortcuts through
   its Appearance and shortcut settings; it does not import Terminal.app,
   iTerm, Warp, Kitty, or other emulator profiles. A successful settings query
   with no current rows may use defaults. Unknown retired rows are ignored
   without decoding them. A query failure, malformed JSON, invalid schema
   value, or domain conflict in a current row keeps settings unavailable. The
   read-time migrations are the legacy string form of `diffWrapLines`,
   Appearance data written before `terminalPalette` existed, and filling absent
   shortcut commands from defaults for maps written by older releases. Present
   shortcut values still undergo strict validation. Each later
   service read or write first retries the underlying store instead of
   publishing or writing defaults. The app stops before opening the workspace
   and offers an in-place retry; terminal preferences, Browser preview
   defaults, and shortcut dispatch stay blocked.

9. **Terminal startup input is preserved until interactive readiness.** Keys
   entered while a shell starts are kept in order and delivered exactly once
   after the shell is ready to accept interactive input. First output is not a
   readiness signal: startup files may print long before a prompt exists.
   Startup input must not be dropped or echoed above the prompt. Each transport
   chunk carries a renderer-generation nonce and monotonic sequence; main
   acknowledges that identity, rejects old generations, and deduplicates an
   ambiguous retry. Input already acknowledged by main and any renderer-held
   tail form one ordered batch that survives a shell restart and is released
   exactly once behind the new readiness gate. Reattaching reports how many
   acknowledged bytes are still waiting, so hot reload cannot hide queued
   input. OpenWaggle installs a minimal, nonce-bearing prompt-end readiness
   integration for zsh, Bash, fish, PowerShell, and cmd while still loading the
   user's startup files exactly once. An unknown shell never releases queued
   input from first output, prompt-text matching, or a quiet-time guess. It
   exposes `Input waiting for shell readiness` and an explicit `Send now`
   action instead.

10. **Terminal performance budgets are release gates.** Once a shell is ready,
    the 95th-percentile delay from a focused key event to PTY write dispatch is
    at most 16 ms. A pane becomes usable within 50 ms after its geometry is
    stable, excluding time spent in the user's shell startup files. A
    200,000-line output flood loses or corrupts no data and produces no
    renderer long task over 50 ms. Close and restart complete within 250 ms
    during that flood. Visual fitting follows on the next animation frame and
    the PTY receives one final resize after a 150 ms settle window. Scrollback
    byte and line limits apply both in memory and in persisted state. With no
    terminals the subsystem performs no idle polling; multiple terminals share
    process inspection rather than polling independently. Persisted layouts and
    main-process records are bounded independently: at most four panes per tab,
    64 tabs and 64 terminal records per owner, 256 stored owner groups and 256
    records application-wide. Duplicate terminal ids are rejected across an
    owner's entire layout, including different tabs. Exited records also have
    their own count and aggregate-scrollback caps.

11. **Close protection follows process risk, not every click.** A dead shell or
    a prompt known to be idle closes without interruption. Active commands,
    descendants, listening ports, or uncertain state require one confirmation.
    Pane, tab, group, and restart actions share this rule. Main reports success
    only after ownership termination, native resource drain, and the final public
    output-exit event have all been observed. Failure retains the pane and its
    cleanup record. A close request is never physical descriptor-close evidence.

    POSIX root identity is captured at spawn. Darwin signals with the current
    audit token after checking its stable process identity; Linux signals through
    retained pidfds. Neither falls back to a raw numeric PID across a reuse race.
    The exact open master and its slave identity authorize a native tty-member
    sweep, with the root last. Known detached descendants remain eligible only
    through their retained birth identities. The forced pass checks its deadline
    after every probe and handles descendants before a freshly verified root.
    A process that detaches before its first reliable ownership observation is
    outside this claim; this is not whole-machine process containment.

    Linux tty discovery uses registered, non-owning master descriptors and the
    kernel session ioctl. Querying another process's slave descriptor can return
    ENOTTY even when the slave belongs to its controlling terminal. Descriptor
    registrations are bounded and revalidated before use. Closing discovery and
    proving physical tty absence remain separate operations.

    Patched POSIX writes use a separate duplicated writer descriptor. Close
    rejects later writes and drops queued input; resource drain waits for the
    reader and any in-flight writer before releasing both descriptors. This
    prevents an old write from reaching a reused descriptor. The public upstream
    Unix destroy path, which signals its stored numeric PID, is not used.
    Once termination is proven, previously paused output resumes so a finite
    tail can drain. Native no-match results never suppress retained descendants.

    Windows ConPTY roots start suspended and enter a per-terminal kill-on-close
    Job before resuming. WinPTY's agent enters its Job before spawning the shell.
    Termination uses those owned handles, never snapshot PIDs. Root exit, zero
    active Job processes, and Job-handle closure precede the replay-safe tree-exit
    event. JavaScript resumes output and acknowledges drain readiness before the
    native waiter calls ClosePseudoConsole off the main thread. Resource drain
    and final public output exit are distinct observations; shutdown waits for both.

    Windows process and TCP-listener metadata come from asynchronous native
    Toolhelp and IP Helper queries. These are discovery metadata, never kill
    authority. Queries cap rows, allocation, and elapsed work; caller deadlines
    retain a shared in-flight query instead of enqueueing duplicate workers.
    No periodic PowerShell fallback runs. Polling starts only with live targets,
    schedules after completion, backs off failures to 60 seconds, and rejects
    results belonging to a replaced terminal or stopped inspector.

    Installation and packaging rebuild from the pinned patch source. Native load
    probes exercise input, resize, owned-tree close, drain, and exact final output.
    Windows additionally probes a real owned TCP listener and every PTY backend.
    A backend missing the required lifecycle or metadata contract fails before spawn.

12. **Web links have a safe native-preview option.** The persisted Web link
    destination defaults to the system browser and may be changed to
    OpenWaggle. In-app HTTP(S) links and localhost port chips open as bounded
    tabs in the right-side Browser preview with back, forward, reload/stop,
    address, close, and explicit system-browser controls. Its native
    `WebContentsView` has Node integration off, context isolation and sandbox
    on, credentials in URLs rejected, permissions and downloads denied, and
    popup or non-HTTP(S) navigation blocked. Preview ownership and IPC remain
    renderer-window scoped; hiding React chrome hides the native view before
    another surface can cover it. Because a native preview receives keyboard
    events outside the renderer DOM, main reinjects only registered shortcut
    chords into the owning renderer. One ordered resolver then arbitrates
    built-in and Project Action rules, preserving conditional shortcuts without
    double dispatch or intercepting ordinary web-page typing.

13. **The right side has one visible owner.** Route panels such as Diff,
    Session Tree, Workspace file, and extension contributions share one
    exclusive display claim with the Terminal and Browser preview panel. The
    latest explicit open action wins on docked and sheet layouts. Switching
    owners hides the previous panel without destroying its tabs, terminal
    layouts, or route state; closing the winner does not reopen an older panel
    implicitly. Claims include the Session or route request identity so stale
    effect cleanup cannot hide a newer panel.

14. **Project Actions are explicit, visible terminal commands.** A project may
    save up to 50 named actions in `.openwaggle/settings.json`, with at most one
    marked as its Setup action. OpenWaggle may discover compatible definitions
    in a root `t3.json`, but it never runs or saves checked-in commands until the
    user imports them. Import re-reads the file in main and selects a bounded
    source index, so renderer data cannot replace the discovered command. A
    regular action reuses the active terminal only when it is confidently idle;
    otherwise it opens a new Session terminal. The Setup action opens its own
    visible terminal after a Session worktree is persisted and before Pi starts
    the turn. A durable, generation-bound pending record covers first creation,
    adoption after an interrupted creation, and explicit recreation of a missing
    tree. Main commits a unique claim before handing the command to the terminal.
    A reported pre-handoff failure releases that claim, so the next send can
    retry. Terminal acceptance changes it to a durable accepted receipt.
    SQLite and a PTY cannot share a transaction, so a claim that survives an app
    crash is indeterminate: the command may or may not have reached the shell.
    OpenWaggle does not replay that generation automatically because arbitrary
    setup commands may have non-idempotent side effects. Worktree launch details
    explain the interruption so the user can inspect the visible terminal and
    run the action manually if needed. This is at-most-once crash behaviour, not
    a claim of exactly-once shell execution. Accepted generations, indeterminate
    generations, and legacy recorded trees do not run Setup again. Dispatch
    failure stays in the worktree launch details and does not block the agent
    turn. This keeps setup observable and debuggable instead of turning it into
    a hidden process gate.
    Project Action terminals add `T3CODE_PROJECT_ROOT` and
    `OPENWAGGLE_PROJECT_ROOT`; worktree actions also add the matching
    `*_WORKTREE_PATH` variables. These fixed action-context values replace
    caller-provided values, while Local actions remove stale worktree values.
    The overrides are layered over a fresh inferred user shell environment on
    every spawn, so the user's shell, PATH, and ordinary environment stay intact.
    An authenticated later prompt releases the action reuse barrier on supported
    shells. A command too fast for the process sampler falls back only after two
    reliable idle observations and at least 1.5 seconds. Unsupported shells have
    no authenticated prompt, so that fallback cannot distinguish a long-running
    shell builtin that creates no child process; this limitation is disclosed in
    the terminal documentation.
    A project may keep up to 256 ordered Project Action bindings. Each action
    may own several bindings, and each binding may have a T3-compatible boolean
    condition over terminal, preview, and model-picker context. Resolution walks
    the active rules from newest to oldest, so the last matching binding wins,
    including over a built-in command. The editor warns about likely overlap but
    does not prohibit an intentional override. The previous single-shortcut
    settings shape remains readable and is migrated only when that action is
    written; `t3.json` remains untouched because T3 stores bindings separately.

## Consequences

- The `terminal:create(projectPath)` IPC contract and its handler are
  replaced by session-keyed channels; ADR 0020's terminal limitation note is
  superseded for terminals.
- Draft groups are keyed per project (`draft:<projectPath>`), so successive
  drafts in the same project reuse that project's draft terminals by design;
  the group migrates atomically to the session key after first send. Its live
  PTYs remain in the original checkout, are labelled `Original checkout`, and
  new terminals bind to the born Session worktree.
- Terminal history files appear under the app data directory; session delete
  must trigger terminal cleanup while the corresponding mutation fence remains
  held (new coupling between session lifecycle and the terminal service).
- The old single-terminal `terminalOpen` flag becomes a per-session panel
  state; docs that describe a project terminal need updating.
- Terminal tabs may live in the bottom drawer or right-side panel without
  changing their runtime owner. A deferred renderer attachment lease prevents
  a React move from detaching a PTY after its destination has attached.
- The right-side panel also presents bounded, Session-owned Browser preview
  tabs. Changing the active session hides and detaches the previous Session's
  native views without destroying them, so its background run can continue.
  ADR 0031 owns the full profile, automation, capture, and lifetime contract.
- Route and workspace right panels remain separate content owners but consume
  width through one exclusive renderer claim, so they never stack docked
  widths or interactive sheets.
- The exact xterm beta pin is an intentional compatibility dependency, not a
  floating prerelease. A real-DOM regression test negotiates Kitty mode and
  verifies both press and release encoding; production Electron QA remains the
  visual and IME gate.
- Future remote/WSL terminals reuse the service port rather than this
  architecture changing.
- A future remote OpenWaggle option remains a separate product decision. The
  terminal service stays transport-independent so desktop parity work does not
  close that path or claim remote behaviour before it is designed. Remote
  adapters must implement per-subscriber cursors, acknowledgements, item/byte
  budgets, and retry from the last applied sequence; they cannot reuse the
  local desktop's terminal-wide in-flight acknowledgement as-is.
- Project Actions share the terminal transport, shell resolution, startup-input
  queue, close protection, previews, and process labels. They do not introduce
  a second command runner or shell policy.
- Terminal file links under the Session Working path use OpenWaggle's preview.
  Absolute links outside it use the remembered installed-editor preference and
  preserve line and column; they never fall through to an arbitrary OS default.
- The pinned node-pty patch is part of the terminal safety contract. Every
  node-pty upgrade must preserve descriptor-only close, in-flight POSIX writer
  quiescence, Darwin descriptor-bound signaling, and Windows handle-owned tree
  termination without raw PID fallback, then pass the native Darwin and Windows
  lifecycle integrations before release.

## References

- T3 Code terminal manager: `apps/server/src/terminal/Manager.ts`
  (open/re-open semantics, history persistence, process activity).
- Pinned node-pty safety patch: `patches/node-pty@1.1.0.patch`.
- Native terminal lifecycle integration:
  `src/main/adapters/terminal/__tests__/terminal-node-pty-native.integration.test.ts`.
- T3 Code parity audit on 2026-09-08: stable `v0.0.40`
  (`09e8de9c655ae85410bf6b00446f272a01da81c7`) and main
  (`7220dfe2c949476eaa7d21eccbcd3a0ce0eddb49`). The audit includes native
  Windows metadata polling and failure backoff, as well as main's
  incremental bounded terminal-history/output work and its suspension of
  painting, snapshots, and cursor timers for hidden terminal surfaces.
  OpenWaggle goes further on desktop by unmounting hidden renderer surfaces
  while the main-process PTY, bounded history, and activity snapshot continue.
  T3's per-subscriber orchestration budget remains a useful remote-transport
  pattern, not a claim that T3 currently applies that exact protocol to
  terminal output.
- ADR 0010 (worktree-per-session), ADR 0018 (branch changes under a worktree
  are untracked — terminals changing branches inherit the same limitation),
  ADR 0020 (provenance vocabulary; terminal gap note).
