# ADR 0031: Session-owned collaborative browser preview

- Status: Accepted
- Date: 2026-09-05

## Context

OpenWaggle needs the browser workflow that T3 Code users already expect: local-server discovery,
session tabs, responsive viewports, browser profiles, capture tools, and an agent that can work in
the same page the user sees. A panel-only browser is insufficient. Agent runs continue when the
user changes sessions, and a visible React surface cannot be the lifetime owner of a native
`WebContentsView`.

The browser also crosses several authority boundaries. A renderer chooses what to show, Electron
main owns the native view and storage partition, and Pi may request page actions. Treating a tab id
or session id from renderer IPC as proof of ownership would let one renderer claim another
session's browser. Running user controls and agent CDP commands through separate debugger sessions
would introduce races and detach one controller underneath the other.

## Decision

1. **The parity floor is T3 Code stable plus audited main.** OpenWaggle implements the complete
   browser-preview behaviour present in the latest stable T3 Code desktop and relevant fixes merged
   to T3 Code main at the final pre-merge audit. Upstream defects are not compatibility requirements.
   OpenWaggle may add clearer controls, stronger ownership, and stricter bounds.

2. **A Browser preview belongs to a Session, not to the mounted panel.** Electron main keeps the
   native record while the session is hidden or its agent runs in the background. Changing the
   visible session detaches or hides the native view; it does not close it. Explicit tab close,
   Session deletion, renderer/window teardown, and app teardown end the lifetime. Each Session has
   a current preview used when an operation omits `tabId`; opening, selecting, or explicitly
   targeting a tab updates that current record.

   With no retained tab, the preview shortcut creates a launcher record only; no native view exists
   until the user selects or submits a destination. Explicit **New browser tab** actions always
   create independent launcher identities, including for identical URL/profile pairs. Trusted link
   opens may reuse an exact materialized URL/profile match. The launcher exposes at most eight of
   ten persisted recent successful URLs plus bounded HTTP-ready port previews discovered from the
   current Session's terminals.

   A Session retains at most eight tabs. A background automation request at that limit selects the
   oldest tab that is neither the panel's active preview nor the Session's visible floating
   preview. Main authenticates and replaces that same-owner tab in one operation. If native
   creation fails, it restores the victim's owner, profile, URL, mute state, viewport, zoom, and
   appearance. Chromium history and in-page JavaScript state cannot be restored after the old
   native view has been disposed.

3. **Renderer ownership is authenticated.** A durable window host registers each Session owner key
   to one renderer `WebContents`. Main rejects unregistered or cross-renderer opens before creating
   a native view. Main-to-renderer background opens carry a unique request id and monotonic
   generation and complete only after both renderer acknowledgement and native materialization.
   Failure, cancellation, timeout, navigation, or teardown invalidates the request and rolls back a
   late materialization.

4. **Profiles are immutable storage identities for a tab lifetime.** Default and named profiles use
   persistent Electron partitions; Incognito uses an in-memory partition. Changing a tab's profile
   disposes its old native view before creating the replacement. Users may choose a default, create,
   rename, clear, and delete named profiles, and copy bounded compatible cookies from supported
   installed browsers. Imports never modify the source browser and never target Incognito. The
   guided importer holds one stable destination id across retries. A new profile is published to
   settings only after a non-empty cookie write succeeds; a failed publication clears that
   destination partition, and a cleanup failure is surfaced rather than hidden. Finalization is
   serialized, and a new profile becomes visible only after its settings transaction is durable.
   Discovery is capped at 128 source profiles. One import accepts at most 50,000 cookie records from
   a cookie database no larger than 256 MiB, and Settings keeps at most 24 named profiles.

5. **User controls cover the complete preview workflow.** The panel provides bounded tabs,
   navigation and stop/reload, hard reload, detached DevTools, system-browser handoff, zoom,
   light/dark/system appearance emulation, picture-in-picture, responsive and named device
   viewports, screenshot capture, and a bounded recording. Its composer annotation mode matches the
   stable T3 Code Select/Region/Draw/Erase workflow: Shift-click multi-selection, marquee region
   capture, freehand marks, erasing, comments, and reversible live style previews. Selections and
   each freeform collection are capped at 20; paths, strings, owner stacks, stroke points, style
   changes, and the complete payload have independent bounds. Cache, cookies, screenshots,
   recordings, and annotation state are explicit controls rather than hidden side effects.
   Persisted new-tab defaults cover fill or fixed viewport, the stable zoom ladder,
   light/dark/system appearance, 30/60 FPS recording, and automatic floating visibility for
   agent-opened previews. Defaults are sanitized independently and applied before a new native page
   paints; existing tabs retain their active controls.

   Floating previews resize from all eight edges and corners, with arrow-key
   controls and a larger Shift step. Resizing preserves the page's proportions
   and opposite anchor. A temporary chat-container shrink does not overwrite
   the preferred size. Fill-mode pages retain their source CSS viewport through
   presentation-only emulation, so floating does not reflow the page or change
   its saved viewport preference. Returning to the panel removes that emulation.
   Focused page and OAuth-popup editing shortcuts retain native clipboard and
   undo/redo behavior without routing background automation through the host menu.
   Their native context menus target the clicked guest and frame, with spelling
   suggestions, safe link and image copying, and capability-aware editing roles.
   Navigation and disposal dismiss the menu and revoke its captured page actions.
   Hidden automation blocks native menu presentation unless a test installs an
   explicit deterministic replacement for that operation.

   Recording prefers supported H.264 encoders, falls back to WebM, and sizes
   bitrate to actual captured pixels and frame rate within 2.5–50 Mbps. The
   duration and byte caps remain authoritative. Capture tracks stop after
   encoding flushes and before artifact materialization. Local agent recording
   results already point to files in the agent's environment; remote transfer
   remains a future transport requirement.

   A fixed viewport has keyboard-accessible rails on its left, right, and bottom edges and both
   bottom corners. Pointer movement previews the fitted native bounds on the next animation frame
   and commits on release. Arrow keys resize by 10 CSS pixels, or 50 with Shift, and commit once
   150 ms after the final key. Cancellation and a changed tab or source viewport discard the stale
   draft. Ratio locking, dimension limits, and the total-area cap apply to every input method.

   Materialized tabs show their page favicon and Chromium audio activity. Mute is explicit and its
   intent survives tab restoration. The separate picture-in-picture viewer allows up to four
   windows. It waits for each frame to complete before the next 100 ms tick, limits JPEG frames to
   1,280 pixels and 4 MiB, and closes a failed viewer rather than leaving its control queue blocked.
   The viewer document has a three-second load deadline; frame delivery has a one-second deadline;
   and native capture has three one-second attempts separated by 120 ms. Close and cancellation
   stop logical work, although Electron's unresolved `capturePage` promise cannot itself be
   cancelled.

6. **Agent access is one explicit, fail-closed capability.** `enableAgentBrowserAccess` defaults to
   enabled for T3 parity. When disabled—or when the setting cannot be read—OpenWaggle withholds both
   the `preview_*` tools and their system-prompt guidance. Status is read-only; every page-control
   operation uses the existing scoped approval broker. The desktop service rechecks the setting for
   every operation, so disabling access also revokes tools captured by an already-running turn.
   Tools resolve only records owned by their Session and use the Session's current preview when no
   target is supplied.

   An omitted automation visibility choice reads the auto-show preference for that operation and
   may reveal the Session preview in a floating mini-player without replacing the selected right
   panel surface. An explicit visible or hidden choice takes precedence.

   The initial renderer settings read is also a launch boundary. A successful read with no current
   setting rows may use defaults. A database failure or invalid current value keeps settings
   unavailable, shows an in-place retry before mounting the workspace, and makes reads and writes
   retry the store. Preview creation and restoration, recording, and Web link routing do not
   substitute schema-default profiles, viewports, shortcuts, or a fallback to the system browser.
   Browser automation independently rechecks access, default profile, and auto-show settings before
   materialization and opens no native view if that read fails.

7. **Human and agent control share one bounded CDP broker.** User appearance/DevTools operations and
   Pi page actions use one canonical controller identity per native view and one serialized queue.
   Exact expected synthetic input signals distinguish delayed CDP events from real input; unmatched
   human input wins and interrupts the action. Cross-document navigation invalidates in-flight
   locators and mixed snapshots. Every queued action, CDP command, actionability retry, navigation,
   open request, and recording request has cancellation and a bounded deadline. Diagnostics,
   snapshots, results, artifacts, and retained action history have independent count and byte caps.
   Screenshot capture uses three one-second attempts separated by 120 ms. One serialized native
   capture lane per page prevents overlapping compositor requests; an unresolved Electron promise
   cannot hold the user or automation queue forever.

8. **The automation service is transport-independent.** Pi depends on the Browser preview service
   port, while the desktop adapter owns Electron views and CDP. A future remote OpenWaggle product
   can provide another adapter without changing the Session ownership, approval, target-selection,
   or tool contracts. This records an architectural seam, not a remote product decision.

## Consequences

- Hiding a Session may retain native browser processes and storage, so per-owner and application
  limits are mandatory and explicit Session cleanup must reach the manager.
- A trusted OpenWaggle renderer reload keeps the same `WebContents`, registered Session owners, and
  native preview records, so hidden background Sessions do not lose their browser mid-run. An
  untrusted top-level navigation, owner-renderer loss, window close, or explicit teardown still
  revokes the registration and disposes every native view. A crashed preview page process retains
  its record and latest URL while OpenWaggle makes at most three reload attempts with 250 ms
  exponential backoff in a 30-second window. Navigation, replacement, or close cancels pending
  recovery. Materializations that lose their renderer acknowledgement during reload remain
  deadline-bounded and must be retried.
- Browser recordings require renderer `MediaRecorder` participation. Main grants the exact preview
  source and coordinates start/stop through identity-checked request/response messages; a grant
  alone is not a successful recording start.
- Annotation UI is injected into an isolated JavaScript world and rendered inside a closed shadow
  root so page CSS cannot restyle its controls. Live style previews preserve each affected inline
  value and priority, remain visible for the annotation screenshot, and are restored after capture,
  cancellation, navigation, or teardown. The composer receives a bounded screenshot and structured,
  explicitly untrusted page context. React component, source, and owner-stack attribution is
  best-effort: development fibers or explicit data attributes may provide it, while
  production-minified or isolated pages fail closed to empty metadata rather than a guessed source.
- Automation mode may suppress executable disk/user extensions while retaining explicitly trusted
  built-in factories. This lets hidden Electron QA exercise the real Browser preview tools without
  widening extension authority.
- Cookie import can require the source browser to be closed, an OS credential prompt, or macOS Full
  Disk Access. The guided UI reports those states, opens the fixed Full Disk Access System Settings
  destination when available, and rechecks the source instead of silently returning an empty
  import. Its cookie write is nondismissible and synchronously guarded against duplicate submits.
  Windows advertises Firefox and Helium only; Chrome, Edge, Brave, Vivaldi, Opera, and Arc use
  Chromium app-bound encryption that OpenWaggle does not support.

## References

- T3 Code stable `v0.0.40` (`09e8de9c655ae85410bf6b00446f272a01da81c7`).
- T3 Code main audited on 2026-09-08 at
  `7220dfe2c949476eaa7d21eccbcd3a0ce0eddb49`, including the guest/popup context-menu fix.
  Its Electron 44 drag-region inheritance fix does not apply to OpenWaggle's pinned
  Electron 43; layout hit targets must be rechecked when upgrading Electron.
  A fresh pre-merge audit supersedes this reference if
  main advances again.
- ADR 0023: agent access modes and declared authorization.
- ADR 0030: Session-bound terminals and the shared right-panel ownership contract.
