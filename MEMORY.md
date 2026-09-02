# MEMORY.md

Durable OpenWaggle project memory. Keep this compact and technical. Do not add personal/cross-repo agent preferences here.

## Active Warnings

- The working tree may contain another agent's active refactor. Treat dirty files as intended future shape unless there is clear evidence otherwise.
- Legacy vendor-specific agent configuration has been removed; keep this repository centered on `AGENTS.md` and `.agents/`.
- Legacy agent memory files were removed. Add durable OpenWaggle memory here or to focused skills.
- `docs/agents/` is reserved for the adapted `/setup-matt-pocock-skills` workflow. Do not manually scaffold it during unrelated work.

## Current Architecture Direction

### CI is tiered behind a merge queue (ADR 0029, September 2026)

A 2026-09-01 audit of ~300 CI runs (~36h) found 51% green / 21% failed / 27% cancelled, with 85% of failures concentrated on three agent PRs. The enforced merge gate was only three ubuntu checks; the 3-OS E2E matrix and package rehearsals ran informationally per push, so agents burned multi-hour loops on reds that never gated merges. Windows E2E failed 33% of runs — two-thirds of failures were "all 29 tests pass, then `Worker teardown timeout of 90000ms`" (a hanging shutdown, not a test problem), the rest Windows-timing test timeouts and locator misses. `hive-sessions.e2e.test.ts` on PR #181 failed 8× consecutively on a JSON parse race: `applicationCliStdout` returns raw stdout when its extraction grammar does not match, so a leading `{}` empty payload plus trailing content explodes in `JSON.parse`.

Fixes shipped: Fast gate per push (static checks split into Unit / Integration & Component / MCP Conformance jobs + macOS E2E with `retries: 2` and `PLAYWRIGHT_WORKERS: '2'`), Full gate on `merge_group` results (adds Windows/Linux E2E plus path-scoped rehearsals: package consumer smoke when `packages/**`/lockfile/release tooling changed; website/docs rehearsal when website/docs **or package** surfaces changed). `scripts/package-release-gate.ts` encodes tier semantics (`full|fast|fast-no-e2e|visual`); required-but-skipped is an error, skipped-conditional is fine. `e2e/support/electron-process-tree.ts` bounds `app.close()` at 10s, names surviving descendants into `$GITHUB_STEP_SUMMARY`, and force-kills the tree (`taskkill /T /F` on Windows) — a safety net whose forensics feed the root-cause hunt for non-clean Windows exits. The settings-side half (enable merge queue + update the required-check list to the new job names) is a maintainer runbook step in `docs/release-and-versioning.md`. It must be applied in the same admin window as the merge: the rename retires the `Unit & Component Tests` context, so between merge and ruleset swap open PRs show a forever-pending required check until an admin applies the swap or merges with the routine bypass.

### The commit policy was invisible to agents

`scripts/check-conventional-commits.ts` rejected a `mockup:` subject in CI after the agent pushed — the check was deterministic, ~1s, and documented nowhere agents read. Now `pnpm verify` (commit policy vs the `origin/main` merge base + typecheck + lint + unit tests) runs in the husky pre-push hook for feature branches; `prepush:main` still guards pushes to `main`.

- OpenWaggle is an Electron desktop coding-agent UI on top of Pi.
- Main-process architecture is hexagonal: domain, ports, adapters, application services, IPC, stores.
- Pi SDK imports belong in `src/main/adapters/pi/` only.
- Provider/model/auth metadata must mirror Pi through `ModelRuntime`, project-scoped runtime services, and OpenWaggle-owned ports.
- OpenWaggle must not maintain a parallel `src/main/providers/` registry.
- OpenWaggle extension UI direction is ADR-0006: model visual contributions as surface/runtime/execution, default to a framework-neutral federated-module runtime with `mount(context)`, and do not expand placeholder route/content experiments as a parallel legacy runtime.

## Pi Runtime Memory

Load `.agents/skills/pi-integration/SKILL.md` for details.

- Pi JSONL sessions are runtime state; SQLite session projection is the product read model for renderer navigation, branching, persistence, active runs, and UI state.
- Pi-native tool events, thinking levels, compaction behavior, session ids, provider/model ids, and auth methods should stay Pi-native through the adapter boundary.
- Composer thinking choices must come from Pi's `getSupportedThinkingLevels(model)` result. Render that array exactly: `Off`, `Extra High`, and `Max` appear only when Pi declares them for the selected model; never infer levels from model ids.
- Missing projected Pi entries during clean-cut projection rebuilds should be treated as stale/cancelled navigation, not thrown through IPC.
- Preserve Pi-created session ids before first prompt by opening the pre-created id correctly instead of allowing a missing JSONL path to create a different id.
- Build runtime services through Pi's project-scoped service path so extensions/providers are registered before model resolution.
- Pi package extension loading must be scoped to the active project and adapter cwd so package extensions do not read Electron's process cwd or leak server processes.
- OpenWaggle masks user-managed `pi-mcp-adapter` npm entries from its embedded Pi SettingsManager at read time and restores them on writes; never uninstall or remove those shared entries because standalone Pi and other projects may still use them.
- OpenWaggle-owned Pi extension packages must be bundled/copied locally and `asarUnpack`ed for packaged apps.
- Pi-native Waggle state belongs to `@openwaggle/pi-waggle`: runtime custom message/state types use the `pi-waggle.*` namespace, branch mode/config is stored as `pi-waggle.mode-state` custom entries, and OpenWaggle should project metadata from those entries instead of seeding a parallel metadata tree.
- Pi TUI Waggle continuation turns should be scheduled after the current Pi run settles, then append the visible `pi-waggle.turn` custom message and call `sendUserMessage(...)` without `deliverAs`; queuing continuation prompts with `deliverAs: 'followUp'` during `turn_end` can leave them waiting for user confirmation. Accumulate tool-call turns with their `toolResults` before advancing, and use `agent_end` only as a fallback for pending tool-call-only completions.
- User-authored input during an active Pi TUI Waggle run must stop automatic Waggle continuation and be resent with `sendUserMessage(..., { deliverAs: 'steer' })`; otherwise Pi rejects it with “Agent is already processing” because normal prompts during streaming need an explicit streaming behavior.
- Pi custom TUI components must use `@earendil-works/pi-tui` keyboard helpers such as `matchesKey`/`parseKey` instead of raw escape-sequence comparisons; Kitty keyboard protocol encodes Enter, Esc, Space, and Ctrl+C as CSI-u sequences, so raw checks can trap users inside custom menus.
- Pi custom TUI components must never return strings containing embedded `\n`/`\r`; normalize dynamic labels/details to single terminal lines before rendering. They must also truncate rendered lines with `truncateToWidth`/`visibleWidth`, not string length, clamp scroll windows to `items.length - visibleRows`, and reserve fixed blank slots for scrollable lists/details. Embedded newlines, overflowing lines, or shrinking terminal output can corrupt Pi TUI's differential cursor math and leave duplicated-looking rows. Prefer Pi's built-in `ctx.ui.select` for modal menus unless custom rendering is clearly needed, so the Pi footer/status remains visible and interaction steps do not visually jump.

## MCP Runtime Memory

- MCP is an OpenWaggle-owned runtime capability, not a Pi extension. Keep protocol lifecycle, configuration, transport, trust, authentication, capability discovery, and server hosting behind OpenWaggle ports/adapters; Pi receives only the compact gateway tools for an active turn.
- MCP activation resolves session → project → global and defaults off globally. Disabled servers must not connect, inject instructions/capabilities, or remain attached after the safe turn boundary; the UI must distinguish desired, applied, and pending state.
- Interoperate with current MCP (`2026-07-28`) and the supported legacy revisions (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`) across both client and hosted-server paths. Preserve protocol/transport negotiation diagnostics instead of silently dropping older servers.
- Treat remote MCP content as untrusted: require explicit trust and capability opt-ins, keep Event Inbox and server instructions out of context until reviewed, sandbox MCP Apps, isolate sampling, keep roots read-only, validate Remote Skills, and surface every required user or agent follow-up as a durable notice.

## Electron Runtime Memory

Load `.agents/skills/electron-runtime/SKILL.md` for details.

- Native addons have separate Node and Electron ABI targets. Rebuild with the repo scripts before blaming app code.
- Packaged apps may not inherit a shell PATH. Pi package/resource loading and Pi-run child processes that shell out to tools need an adapter-controlled npm-compatible PATH, including common user tool dirs such as `~/Library/pnpm` on macOS.
- `electron-builder` with pnpm can omit transitive runtime modules unless explicit dependencies are present; `ms` is intentionally explicit for `electron-updater`.
- macOS `electron-updater` requires ZIP artifacts in GitHub release metadata; DMG-only mac releases can advertise an update but fail with "ZIP file not provided".
- On Apple silicon, performance/package QA should use arm64 outputs, not Rosetta x64 output from a universal build folder.
- Electron Playwright E2E requires isolated user data and single-instance lock opt-out when another OpenWaggle instance is running.
- Agent-run Electron E2E and QA have a hard non-disruption contract: the app must not show or focus a BrowserWindow, open a native dialog, or launch an external application. Automated paths fail instead of exposing OS UI; visible Electron QA requires an explicit headed command.
- `pnpm dev:debug` is the non-disruptive CDP automation entry point. Visible CDP QA is opt-in through `pnpm dev:debug:headed`; `pnpm dev` remains the normal visible development command.
- Hidden `pnpm dev:debug` uses an ephemeral user-data directory and disables the single-instance lock. It must not focus an existing OpenWaggle process or read and write the normal development profile.
- Hidden agent QA owns CDP port 9223; port 9222 remains available for visible/manual debugging. The hidden launcher preflights 9223 and fails before launching Electron if another process owns it.
- Hidden QA also requires a per-run identity in the renderer URL before accepting a CDP page. Port preflight alone is racy and must never be treated as proof that the connected process belongs to the launcher.
- The non-disruption contract is enforced inside the main process, not only by launch scripts. OS-visible Electron actions go through an automation policy that fails closed, and repository standards reject new unguarded window-show/focus, native-dialog, and external-application call sites.
- Trusted-main and Pi runtime extensions are not loaded during non-disruptive automation. Electron exposes its window constructors as non-configurable module properties, so dynamically imported extension code cannot be brought inside the repository's static hidden-window construction boundary. Pi skills, prompts, themes, context, models, and auth metadata still load.
- Agent-run headed Electron QA requires the maintainer's explicit approval for that exact run. An agent cannot infer permission from a task needing native-UI coverage or from approval granted to an earlier run.
- `pnpm dev:debug` is a managed hidden-QA launcher. It owns the Electron child process, exclusive port-9223 lease, ephemeral profile, log forwarding, signal handling, stale-dead-process metadata recovery, and profile cleanup.
- Managed launchers serialize lease recovery and acquisition, quarantine stale leases before deletion, pass only an allowlisted child environment, and always continue through process-tree cleanup when screenshot capture fails. Windows cleanup uses `taskkill /T /F`; POSIX cleanup signals the detached process group.
- The hidden-QA profile registers the current worktree as its selected project and starts with no fabricated sessions. Feature-specific tests or QA scripts add deterministic fixtures explicitly.
- Every scripted Electron launch is non-disruptive, including E2E, CDP QA, startup measurement, and website screenshot capture. The only visible paths are ordinary `pnpm dev` and explicitly headed commands; agent use of any headed path still requires exact-run approval.
- Regression coverage proves hidden windows remain invisible and unfocused, guarded OS-UI calls fail, Playwright headed intent reaches Electron, port conflicts fail before launch, managed cleanup removes the ephemeral profile, and repository checks reject new unguarded OS-UI call sites.
- Every completed agent-run Electron QA captures representative screenshots from the hidden window, stores the evidence outside the repository, and renders the images in the final user response. QA evidence is never committed; intentional visual-regression baselines remain a separate test asset.
- CI runs hidden-window functional Electron E2E on macOS, Linux under Xvfb, and Windows. Xvfb requires both `DISPLAY` and `XAUTHORITY` in the safe Electron child environment. Native pixel baselines stay Darwin-only and are selected with the `@visual` tag; do not copy them across operating systems.
- Renderer project labels receive native filesystem paths. Derive their final segment through the shared `projectName` formatter, which handles both `/` and `\\`; splitting only on `/` exposes full Windows paths and breaks project-scoped controls.
- Playwright pointer delivery into a sandboxed iframe is not portable when the Electron window is hidden: macOS can activate a framed button while Linux/Windows silently leave its handler untouched. For framed controls, dispatch the DOM activation inside the frame, assert synchronously that the handler entered its busy state, then poll a durable boundary such as the project-scoped extension-storage row. Main-renderer controls should keep using normal Playwright pointer actions, and the fixture unit test should cover transient banner text.
- Electron 43 can stall a secure custom-protocol iframe indefinitely when its document response includes `Origin-Agent-Cluster: ?1`. Inline visualizations isolate siblings with a fresh UUID custom-protocol host per frame instead; do not restore the header without proving navigation in real Electron.
- A sandboxed custom-protocol iframe can self-navigate to a blank or failed document without delivering a reliable cancellable Electron frame-navigation event. Inline visualizations therefore pair navigation guards with a post-load host-protocol health check and replace an unresponsive frame with a safe fallback.
- A parser-blocking visualization can prevent `load` entirely, so its deadline must be armed before assigning `src`. Authenticate the injected runtime with a credential-bearing bootstrap sent from the head before fragment parsing, but do not clear the deadline until a matching ready arrives at `DOMContentLoaded`; otherwise fragment code can win a first-ready race. Keep visualization sites out of process and use a low-frequency authenticated heartbeat for later silent navigation. Expiry should remove the isolated iframe; do not send an OS kill signal to its renderer, because macOS Electron can surface that child-renderer crash as a crash of the containing Playwright page.
- A hidden screenshot failure does not authorize headed QA. The agent reports the incomplete evidence and asks for exact-run approval before using any headed fallback.
- CDP file upload can produce `File` objects without native paths; native file-path behavior needs preload/unit coverage or real OS selection QA.
- **The Windows NSIS script is only compiled when electron-builder packages Windows, which happens in the release workflow, not CI.** An installer-variant StrFunc call inside `customUnInstall` broke two consecutive releases across six days before anyone noticed, because NSIS only rejects it at compile time. `build/installer.nsh` is now compile-checked by `pnpm check:installer` inside `pnpm check`, so it fails a pull request in seconds instead of a release in minutes. Two NSIS rules worth remembering: StrFunc helpers must be declared before use, and an uninstall section can only Call `un.`-prefixed functions, so `customUnInstall` needs the `Un` variants (`${UnStrRep}`, not `${StrRep}`).

## Pi Compaction Memory

- Automatic compaction is one app-global percentage, default 80%, injected into Pi after project settings merge. Strip the injected `thresholdPercent` before Pi persists project settings; otherwise the global preference leaks into project configuration and becomes an accidental override.
- Native compaction is an explicit model-transport capability, never an inference from provider name or generic Responses support. The canonical Responses `output` is opaque durable data and must contain a valid compaction item before a new boundary is appended.
- A native checkpoint identity includes both the effective credential-resolved model endpoint and the effective compaction endpoint. Resolve auth only when an active native checkpoint needs that identity; if credential refresh is unavailable, keep read-only restoration working by reconstructing authoritative raw history. A fallback startup or model switch must never call the source model or replay its checkpoint to a different endpoint. Treat the compact endpoint as an external boundary: persist a checkpoint only when every canonical replacement item matches a supported Responses message or compaction shape, with exactly one final compaction item.
- The Pi JSONL branch stays append-only and authoritative. Incompatible targets reconstruct raw entries, trim only the oldest complete model-facing units when the target hard window requires it, and append a deduplicated reconstruction-boundary diagnostic without deleting source entries.
- Codex-like scheduling defers idle compaction: check before a new user turn, and after a tool/model step only when another model call follows. Large tool-call/result pairs are atomic recent-tail units.
- Treat Native compaction `404`, `405`, and `501` responses as standards-level evidence that the declared endpoint is unavailable and use the provider-neutral Portable mechanism. Rebuild that fallback projection from append-only raw history rather than reusing an opaque Native checkpoint preparation. Authentication, quota, cancellation, malformed output, and exhausted transient failures remain visible Native failures.
- The composer context meter follows Codex-style authoritative usage events after each valid completed provider response, including intermediate tool-use responses. It does not invent per-token usage while a provider stream is open, publish error/aborted/zero-usage responses, or combine one model's usage with another model's context window. A successful compaction marks usage unknown until the next valid response.
- Incompatible native-checkpoint reconstruction must be fitted again at the provider-call boundary with the active system prompt, serialized tool schemas, pending messages, and output allowance reserved. A fixed percentage alone can overflow the first request after switching to a smaller model.
- Compaction progress belongs in the transcript, not in a composer dock. Match Codex's running and completed copy, retain manual-versus-automatic reason through Pi session projection, and use motion only on the active label with a reduced-motion fallback.
- Keep the message queue generic during compaction. A normal send remains queued; only an explicit Steer moves that item into the transcript as a pending preview, and Pi's live run control delivers it with `sendUserMessage(..., { deliverAs: 'steer' })` after compaction finishes without cancelling or replacing the active turn.
- Standalone manual compactions are main-owned active activities even though they have no agent stream buffer. Include them in active-activity restoration, rebuild their running transcript state after renderer remounts, discard stale snapshots when a live lifecycle event wins during async initialization, and emit the normal run-completed settlement after the compaction registry entry is released.
- These changes require Pi core/provider patches, not an extension. On each Pi upgrade, regenerate both pnpm patches and re-audit generated model capability metadata, cold resume, repeated native replay, malformed native output, portable tail fit, and tool-loop scheduling.

## Renderer And Session Memory

- Renderer state that represents chat transcripts or active runs must be keyed by concrete `SessionId`, not only the active route.
- Switching away from a foreground run should demote it to background state, not reject the send promise as an error.
- Active-run UI continuity needs a renderer-owned render snapshot keyed by session id; persisted run metadata alone does not prove visible reasoning/tool rows remain continuous.
- First-message sends must bind to the concrete newly created session before async send begins; do not enqueue by current active session after users can switch projects.
- First-send worktree recovery must retain the exact submitted payload, Waggle config, and model until main reports delivery. Retry and Work locally replay that retained turn once; reading current composer preferences during recovery changes the user's request.
- Session tree/header refreshes for background sessions must not overwrite the active session tree/header.
- Session-native transcript rendering reads from the active `SessionWorkspace.transcriptPath`; preserve live tails only at active branch head.
- TanStack Router uses hash history in Electron QA; navigate to `http://localhost:5173/#/<route>`.
- TanStack Hotkeys same-target callbacks do not stop each other via `event.stopPropagation`; independent overlays need explicit topmost ordering.
- Composer slash selection is owned by Lexical: keep focus in the editor, derive the active `/query` from its collapsed selection, replace or consume only that token, and serialize skill decorator nodes as `/skill-id`. Do not route `/` through a second-input global palette.
- Waggle presets in the desktop composer are one-shot invocation metadata, not idle global mode state. A standard agent hands off through the terminating `waggle_invoke` Pi tool, and the main handler chains Waggle only after the standard result is durable.
- Workspace file UI is route-backed, but all indexing, root confinement, preview reads, optimistic-revision writes, and external-open resolution stay behind `WorkspaceFileService` in the main process.
- **React Compiler runs in the app build (`electron.vite.config.ts` -> `reactCompilerPreset()`) and, since this work, in the component test config too — but not in the node unit config, which renders nothing.** Any component that reads render data from a library-owned *mutable* instance can pass a suite that does not run the compiler and still render permanently stale in the real app: the compiler memoizes on referential identity, and the instance is mutated in place so its identity never changes. Hit for real with `@headless-tree` in the Changed-file navigator — `tree.getItems()` returned 262 items while zero rows reached the DOM. Fix is the scoped `'use no memo'` directive on the component that maps the mutable instance (an official compiler escape hatch, not a lint-ignore comment). See "The React Compiler now runs in component tests" below for the mechanism that now catches this class; for anything outside component tests, still treat a green suite as no evidence and verify in real Electron over CDP.
- Corollary: prefer libraries whose render input is a plain value over ones exposing a mutable instance, precisely because our tests cannot see the difference.

## Syntax And Workspace Editing Memory

- ADR 0028 supersedes ADR 0025. OpenWaggle owns a review-first, single-active-file workspace, not an embedded IDE. The lightweight Source view owns virtualized review, Pierre owns diffs and focused editing, and shared adapters own Markdown, structured payloads, compact snippets, intentional plain text, and ANSI output.
- File review and diff review use the same right-docked `WorkspaceTreePanel`, persisted width, and `workspaceTreeOpen` shell state. Keep workspace-file loading and Git-change metadata specialized, but do not reintroduce route-local navigator chrome or a left-side file tree. Narrow editor toolbars must reserve the primary Edit/Done actions before showing metadata so the navigator cannot intercept overflowing controls.
- External file opening follows T3 Code's explicit picker model: probe a curated set of installed editor CLIs (with macOS app-bundle fallback), launch only the selected stable editor id, and remember that choice locally. Never route workspace files through the OS default-app launcher; discovery is lazy and cached so it stays off startup and file-open paths.
- Monaco, its models, editor chunks, TypeScript worker, semantic modifier-click navigation, tabs, split panes, and editor history must not return. The production build and dependency checks enforce their absence.
- The shared syntax service is the review-surface admission and scheduling boundary. It starts at most two workers after syntax-eligible content becomes visible so a large source request cannot starve compact visible code, prioritizes visible work, bounds caches, cancels superseded requests, and quarantines repeatedly failing imported grammars. A Pierre diff or focused file edit mounts one separate, bounded worker only for that explicit surface's lifetime; do not render a multi-file `CodeView` without its worker pool. Both worker builds stay module-split so grammars load on demand. Cancellation is normal control flow and never counts as a grammar failure.
- Pierre patch parsing is synchronous even when highlighting uses its worker pool. Prepare ordinary multi-file patches in renderer tasks bounded by both file count and UTF-16 input units, publishing incremental items so the first highlighted file is not blocked by the whole change set. Offload each oversized unified patch individually in a short-lived module worker rather than sending the whole mixed-size diff, and surface parser failures ahead of loading placeholders. Retain and replay Changed-file navigation until the requested item has been prepared.
- Pierre renders highlighted rows inside the open shadow root of its `<diffs-container>` element. Readiness probes must observe that shadow root rather than relying on a light-DOM `querySelector`, and the expanded Changed-file navigator must receive large file lists through deferred rendering with offscreen row layout/paint containment so secondary tree rows cannot delay the primary loading/highlight frame.
- Pierre's working pool owns the effective render options. Passing the active Syntax theme only to `<File>` or `<CodeView>` is insufficient: initialize the worker pool and surface with the same revision-specific runtime theme, and call the pool's `setRenderOptions` when a mounted diff changes theme because `WorkerPoolContextProvider` consumes `highlighterOptions` only during its initial state creation.
- Right-sidebar performance checks must target the shared visible panel marker, not the docked shell: narrower or DPI-scaled viewports use the sheet variant, and a docked-only locator reports missing feedback even while highlighted code is visible.
- Workspace document identity includes the active working-tree root and relative path. The active file, search highlighting, syntax caches, journals, saves, and file mutations must not collide when two worktrees expose the same relative path.
- Focused file edits autosave after 500 ms through serialized, revision-checked main-process writes. `Cmd/Ctrl+S` flushes immediately. A bounded recovery journal protects only the active file until a save succeeds.
- A watcher re-read of the exact saved revision, content, encoding, and line ending must preserve the main-process document-session version. Resetting it makes the next valid edit look stale and surfaces as `Save failed`.
- The bounded main-process document-session cache can evict a file while the renderer still holds a fresh query result. Applying an edit to a missing session must re-read the disk baseline, require the cached revision to match, and restore the renderer's base version before applying its next batch.
- Text files no larger than 1 MiB may enter Focused file edit. Larger files use read-only requests of approximately 256 KiB with no force-full-edit escape hatch. The measured budgets live in `docs/specs/syntax-highlighting-performance.md` and `performance/syntax-budgets/`.
- Imported TextMate grammars execute only in killable workers. Prefer the JavaScript regex engine and load Oniguruma/WASM only when a grammar needs it.
- Recursive VS Code theme includes share one cumulative byte and JSON-value budget per theme chain. Standalone imports reuse the already-parsed root, and each unpacked extension theme declaration owns a separate budget; never reset these limits for each included file.
- Theme selections use stable resource ids while Shiki and Pierre receive revision-specific runtime names. Imports accept familiar VS Code theme JSON/JSONC, TextMate `.tmTheme`, VSIX or unpacked VS Code extensions, and native packages declaratively without executing extension code. Preserve normal and high-contrast variants so future whole-app theming can resolve the same appearance model.
- Syntax resource discovery treats only `ENOENT` as an empty installed or project library; permission and I/O failures must reach the catalog error state. Project resources get separate 8 MiB preflight and actual-read budgets, and actual reads include repeated theme dependencies plus expanded VSIX bytes. Only typed syntax-validation failures may be skipped as malformed. Keep colliding project grammars in the Settings catalog with a visible disabled diagnostic even though only the activatable subset may reach Shiki/Pierre workers.
- Local reference evidence comes from the installed T3 Code and Codex GUI bundles, not the open-source Codex TUI. See `docs/performance/syntax-reference-capture-2026-08-27.md` for versions, hashes, and the architectural findings that informed virtualization, worker count, viewport work, save cadence, and cache identity.
- Appearance packages provide semantic-token and typography defaults; global user preferences are sparse runtime overrides. Reset removes the override so a future whole-app theme can supply its own defaults. Theme catalogs use CSS-only specimens and mount exactly one tabbed live syntax preview to keep Settings responsive.
- Tailwind source discovery must not walk the repository or linked worktree Git metadata during startup. `isolatedTailwindSourcePlugin` writes one renderer-source manifest under the OS temp directory and `source(none)` points Tailwind at that file; this keeps Git worktree indirection and dependency trees off the Vite critical path while preserving hot updates.
- Renderer startup must keep optional editing and appearance work off the shell path. Do not force Vite dependency re-optimization on every launch, lazy-load Settings, and never statically import a syntax worker constructor into the shell path.
- Vite development must pre-optimize `shiki` and `shiki/wasm` and warm the renderer plus syntax-worker entrypoints. A cold first `.ts` open otherwise discovers the WASM dependency in response to the user action, reloads the renderer, and lets the four-second syntax timeout fire repeatedly. The `server.warmup` and `optimizeDeps.include` entries in `electron.vite.config.ts` keep that cost on server startup; the review surface paints a bounded viewport skeleton immediately and tokenizes off-thread before revealing source.

## Product And UX Memory

- Pi-native sidebar navigation is Projects-only. Do not add a global projectless Chats section.
- Waggle mode must run inside Pi as extension/runtime behavior, not as an OpenWaggle application loop that calls Pi once per agent turn.
- Waggle currently supports exactly two agents. Third-agent JSON edits must be rejected at core, Pi extension, shared schema, store schema, and application-service boundaries until N-agent turn policy, prompts, consensus, and UI are implemented first-class.
- Waggle and standard mode share session, branch, draft, archive, transcript, active-run, composer, settings, diff, and git semantics unless Pi imposes a narrow technical constraint.
- Composer branch/config changes are branch-scoped; child branches inherit parent config by default.
- Manual compaction mirrors Pi TUI slash-command UX: `/compact` and `/compact <custom instructions>`, not context-meter-triggered compaction.
- Provider auth UI is method-based. Keep provider-level availability separate from API-key configured state and OAuth connected state.
- Compact composer interactions stay in-row unless the maintainer explicitly asks for a larger workflow.
- Responsive composer toolbars reserve a non-shrinking primary-action group for voice, stop, and send. Secondary controls compact at the composer container boundary; they must never push the send action outside the composer.
- Worktree birth is an app-owned launch lifecycle before Pi starts. Show the full creation card only while preparing or checking out files, then persist a compact expandable `Worktree created` custom event in the transcript. Local runs and cancelled births leave no creation trace.
- The composer owns environment and ref as separate controls before the first turn. First send freezes the launch plan and collapses that setup dock; worktree creation leaves its compact trace in the transcript. The plus menu routes to existing attachment, project-file, skill, and Waggle flows rather than duplicating their state.
- User-facing filesystem paths are relative to the active Session working root or project root. Canonical absolute `WorkingPath` and `RepositoryPath` values stay internal for IPC, filesystem operations, and copy actions; first-party UI must never expose OpenWaggle's worktree storage prefix.
- Sidebar session rows are two lines at 316px width: the title owns line one, line two carries a shrinkable lead (state, phase, provenance) and a fixed tail (shortcut, timestamp). The timestamp never hides on hover; row actions overlay line one instead, because hiding it re-flowed the row under the cursor and removed information at the moment of acting on it.
- Status colour is a semantic role, never a palette class or a status-prefixed token (ADR 0021). Adding a state means naming a role, not reaching for `text-red-500`.
- The sidebar's `@theme` block must stay `@theme static`. Tailwind tree-shakes theme variables no utility references, and roles read at runtime through `var()` in inline styles (`--color-neutral`, `--color-review`, `--color-plan`) silently vanish otherwise.
- Do not show a count of uncommitted files on a session row. Every session sharing a working tree reports the same number, so it says nothing about the session, and a large number implies a severity it does not carry. Divergence (`↑n ↓n`) is the useful part.
- Provenance icons are a separate family from status icons and share no glyph with them (ADR 0020). At the size line two renders, a user reads silhouette rather than detail, so two node-graph glyphs are the same glyph.
- Sidebar view preferences (session sort, collapsed projects) persist; sidebar filters (state chip, text query) do not. A filter that subtracts sessions must not outlive the intent behind it.
- A list passed to `useSessionGitIndicators` must keep reference identity when nothing changed. The hook memoises on the array, so a freshly filtered copy every render re-runs its effect every render and spins the renderer.

## Access Modes And Authorization Memory

- Authorization mode is a live chain resolved when a request is raised, not a value copied at session
  creation (ADR 0023). `authorization_mode_override` is nullable and `NULL` means inherit. Never read
  absence as `yolo`: that pins every pre-existing session to full access and makes the user's global
  default permanently irrelevant to it.
- Session creation stores no mode. If a create path needs one, the design is wrong; resolve at the
  point of use instead.
- Request purpose is declared at the call site. Never infer it from a title, and never re-introduce
  the exact-match title sniffing that used to live in `interaction-ui-context.ts`: renaming a title
  silently changed what full access could answer and no check could see it.
- Anything reaching `ui.confirm` is a question addressed to the user and can never be auto-answered.
  Authorization has its own entry point, and a missing channel degrades to prompting.
- Of the seven confirmation points in the app, exactly two are authorization. Opening an external URL
  and the input disclosure are not, and auto-granting the disclosure saves no work because the editor
  after it still blocks.
- Full access must emit no event at all, not merely skip the prompt. The "no transcript entry, no
  counter, no log" guarantee is enforced by short-circuiting before emission.
- Grants are keyed on requester, capability and resource, and are stored in project config, following
  Codex. Arguments are excluded, and an absent resource is never a wildcard: server-level matching
  would let a server widen its own permissions by shipping a new tool.
- An arriving request adds a surface above the composer and changes nothing about it. Do not disable
  the composer, move focus, or change the placeholder, and do not bind Enter to answering a request.
  T3 Code does seize the composer; we deliberately do not.
- Notification lifetimes count window-focused time and pause on blur, following T3. A timer keyed to
  the notification array instead of to each notification id restarts every clock on every new event,
  so nothing ever expires during a busy run.
- Notifications and decisions need independent event budgets. One shared window let informational
  notices evict an authorization request and its resolution, leaving a transcript row stuck on
  "Waiting" after the decision was made.
- The notification durability rule is shared between main and renderer. Two copies drift into a
  transcript that disagrees with itself after a reload while both sides' tests stay green.
- Migration 24 is `pinned-sessions` and had already shipped. Never renumber or replace a migration id
  that users have applied.
- Rebuilding the `sessions` table is not safe: it is the parent of cascading foreign keys, and a
  rebuild under `PRAGMA foreign_keys = ON` deletes every node and pinned row with it. Add a column.
- A dev-only route must inline `import.meta.env.DEV` at the `lazy()` call. Importing the flag as a
  constant from another module leaves the dynamic import reachable and ships the chunk.
- Guard visible strings with a source scan, not `queryByText('some-id')`. Exact-match queries stay
  green when an identifier is appended to a label, which is how `pi-tui-custom` survived its own test.
  A source scan is only worth its name if it recurses and includes `.ts`: the first version walked two
  directories non-recursively with a `.tsx` filter, so it could not see nested components, other
  features, or the label maps in plain modules, and it reported green while user-facing copy named the
  runtime. Prove such a guard fails by injecting a leak before trusting it.
- An Effect Schema `Struct` DELETES keys it does not declare, and a union annotated
  `Schema.Schema<SomeUnion>` makes that invisible to the compiler when the field is optional. A field
  added to a response type but not to its schema is silently dropped at the IPC boundary. This is how
  the approval scope was lost with the whole scoped-grant feature inert and every unit test green:
  the tests answered the broker directly and never crossed the schema. Any response field needs a
  decode test through the real schema.
- The run cwd is not the project. `ensureSessionWorktreeProjectPath` returns the worktree for a
  worktree session, so anything durable keyed on it lands somewhere the rest of the app never looks:
  grants written there could not be listed or revoked in Settings. Pass the durable project root
  explicitly and name the field so the cwd cannot be handed over by accident.
- A lenient config read is wrong for a permission decision. `loadProjectConfig` logs and returns empty
  on an invalid file, and empty falls through to the global default, which ships as full access, so one
  bad field silently stopped a project from asking. Use a strict read where the answer is a permission
  and fail closed.
- `aria-live` on a conditionally mounted element announces nothing. A polite region must already be in
  the accessibility tree before its content changes, so an always-mounted, initially empty announcer is
  required. Asserting the attribute is precisely the test that stays green while nothing is ever
  spoken.
- Disabling the focused element blurs it. A busy flag that disables every control in a surface moves
  focus to `<body>`, so Escape handlers on that surface stop firing and the next Tab restarts from the
  top of the document. Return focus explicitly when the action settles.
- Project config writes are read-modify-write. Without per-path serialization two concurrent writes
  both read the pre-change file and the second rename wins, so one grant is lost while the UI reports
  both as saved. A run can raise several authorization requests at once, so this is reachable.
- SQLite has no `ADD COLUMN IF NOT EXISTS`, and the migration ledger only guards the same id. A column
  that exists under a different id fails the `ALTER` and takes boot with it, which is reachable
  whenever a migration is renumbered. Guard the column, not just the id.
- Do not rely on the browser repainting `<option>` text before a native select popup opens. The popup
  is drawn outside the DOM, so neither jsdom nor Playwright can observe what it shows, and a lost race
  can render two options with identical text. Use one label vocabulary instead.

## Tooling Memory

- Package manager: `pnpm`.
- GitHub can return a generic GraphQL error from `gh pr create` after a release branch has already been pushed. Release preparation must retry the mutation and re-query the exact same-repository release branch after every failure so it can adopt an ambiguously created PR instead of stranding the release or creating conflicting state.
- TypeScript-first tooling is preferred; do not add JavaScript configs when `.ts` is practical.
- No TypeScript `baseUrl`; preserve aliases through explicit `paths` entries.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are the target strictness posture, but enabling them in build or lint tsconfigs requires a dedicated source-modeling pass across the active Pi/session refactor; lint-only enablement can create TypeScript `error` types that surface as noisy Oxlint `typescript/no-unsafe-*` diagnostics.
- TypeScript 7 uses Oxlint with tsgolint for type-aware TypeScript rules. ESLint remains for repository-specific, TanStack, and import-cycle rules; transitive `@typescript-eslint/*` utilities come from those third-party plugins and are not OpenWaggle's TypeScript parser.
- Unit, integration, and component tests belong in nearby `__tests__/`; E2E stays under `e2e/`.
- Do not suppress Fallow complexity findings; refactor instead.
- Do not add legacy compatibility for removed pre-Pi surfaces unless explicitly requested.

### `fromPartial` hides fixture mismatches as well as expressing them

`fromPartial` from `@total-typescript/shoehorn` casts. Wrapping a whole test fixture in it
makes type errors disappear whether the partiality was intended or not: a field with an
outright wrong type (`switchToLocalMode: 'not-a-function'` where `() => void` is required)
compiled silently once the object was wrapped. Verified while building the renderer test
type guard — the guard passed with the broken fixture until the wrapper was removed.

Use it only where a large type is deliberately stubbed and the test asserts on a subset.
When a fixture is *meant* to be complete, keep it unwrapped so a missing or wrong field
is reported. Two of this repository's own fixtures were failing for exactly that reason:
required fields had been added to `SessionContextRowState` and never added to the fixtures.

### A count-based ratchet is defeated by swapping one error for another

The first version of `scripts/check-renderer-test-types.ts` compared per-file error counts
against a baseline. A deliberately broken mock in a file that already had errors kept the
total identical and passed. The check is binary per file instead: files not on
`scripts/renderer-test-type-exemptions.json` must have zero errors, and an exempt file
that becomes clean fails as a stale exemption so the list can only shrink.

### The React Compiler now runs in component tests

`vitest.component.config.ts` applies `reactCompilerPreset()` via `@rolldown/plugin-babel`,
matching `electron.vite.config.ts`. Before this, component tests exercised un-compiled
output while the app shipped compiled output, so the suite was structurally blind to
compiler-interaction defects.

Proof it now bites: deleting the scoped `'use no memo'` from `FileTree.tsx` — the directive
that fixed a navigator rendering zero rows in the app while tests passed — fails 5 tests.
Before the change, removing it failed none.

The unit config runs in `environment: 'node'` and renders nothing, so it needs no compiler.

### Two exported types with the same name in sibling modules is a live trap here

`store/sessions/types.ts` and `store/session-details/types.ts` both export
`SessionSummaryRow` with different shapes, and each module had its own
`hydrateSessionSummary`. A change meant for the session list was made to the detail-side
function: it typechecked, its own test passed, and the feature was simply absent until the
app was opened. The detail-side function is now `hydrateSessionDetailSummary`.

`pnpm check:repository-standards` fails on any *new* duplicate exported type name under
`src/`, against a checked-in `KNOWN_DUPLICATE_EXPORTED_TYPES` list that can only shrink
(resolving one without removing it from the list also fails). `packages/extension-sdk`
deliberately mirrors shared types as its public surface, so the check is scoped to `src/`.

Rules considered and rejected as noise: duplicate *declared* function names (241 existing)
and duplicate *exported* function names (14). Only the type-name variant was both low-noise
and pointed at the actual trap. Note the function I edited was not exported at all, so an
export-only rule would never have caught it — the durable catch for that half is the
integration test on the live `listSessions` path.

### SELECT column lists are invisible to the type checker

`sql<SessionSummaryRow>` asserts the row shape; it does not verify the query selects those
columns. Three queries typed that way omitted `environment_mode` and `worktree_path`, so
every session in the list reported local mode with no worktree and the per-session git
indicators were absent. Typecheck, lint and the whole suite stayed green; it was found by
opening the app.

The columns now come from `SESSION_SUMMARY_COLUMN_NAMES` in `store/sessions/types.ts`,
interpolated as a fragment by `sessionSummaryColumns(sql)`. Three layers keep it closed:
the shared fragment, a repository-standards rule rejecting an inline column list in a
`sql<SessionSummaryRow>` query, and `store/__tests__/session-summary-columns.integration.test.ts`
which drives the real SQLite path. The detail-side `session-queries.ts` is exempted by name:
its `SessionSummaryRow` is a different type with `message_count` and table aliases.

Note the detail worth remembering: dropping a column fails the integration test but produces
**zero** typecheck errors. Types cannot see into a SQL string.

### Working-tree vs repository paths are branded (WorkingPath / RepositoryPath)

`src/shared/types/brand.ts` defines `WorkingPath` and `RepositoryPath`. Working-tree reads
and mutations (`getGitStatus`, `commitGit`, `getGitDiff`, `stageAllGitChanges`,
`revertAllGitChanges`, vcs-status, stacked actions, branch checkout/create) take a
`WorkingPath`; repository-level lists (branches, worktrees) take a `RepositoryPath`. Both
are erased strings at runtime, so IPC serialization is unaffected.

`resolveSessionWorkingDir` is the ONLY producer of a `WorkingPath` (in local mode it
rebrands the checkout — same string, correct role); `useRepositoryPath` produces the
`RepositoryPath`. So a working-tree mutation can only be fed from the session→tree rule,
and passing a repository/project path to one is a compile error. `git-path-brands.unit.test.ts`
pins this with `@ts-expect-error` on every wrong pairing — if a brand stops being enforced
the directive goes unused and the typecheck fails.

Branch checkout/create take BOTH a WorkingPath (git runs in a tree) and a RepositoryPath
(whose branch list to refresh) — equal only in local mode, which is the only place checkout
is reachable. The store's `checkoutBranch`/`createBranch` were previously handed one path
named `workingPath` and used it for both; the branding surfaced that conflation.

### The renderer test type exemption list is empty; keep it that way

`scripts/renderer-test-type-exemptions.json` is `[]`. Every renderer test file typechecks
under `tsconfig.renderer-tests.json`, enforced by `pnpm typecheck:tests` (part of
`pnpm check`), which is binary per file: any test file with a type error fails. The
dominant fix while clearing the original 330 was annotating fixture factory return types
(`ChatTextPart`, `UIMessage`, `SessionNode`, `MessageChatRow`, `ChatPanelSections`, etc.)
so a literal like `type: 'text'` or `role: 'assistant'` is checked against the interface
instead of widening to `string`. Do NOT use `fromPartial` to silence a whole-object
mismatch — it casts and hides real errors.

### A measuring instrument that reads innerText measures itself

A probe that polled `log.innerText` every 8ms to detect a rendered transcript reported roughly 1,000ms for every session switch, suspiciously constant. `innerText` forces synchronous layout, so on a 50,000px subtree the poll loop was the cost being reported. A `MutationObserver` on the same element put the real figure at 221-267ms.

Two symptoms mark this mistake: a number that barely varies across different inputs, and a blocked-time total that does not add up to the wall clock. When the timings look suspiciously flat, suspect the instrument before the application. Use `MutationObserver`, `PerformanceObserver` or a CDP trace, none of which read layout.

### A row is only as clickable as its handler is wide

The two-line sidebar rows put the click handler on the title text inside a 316x48 row, which left 70% of every row dead to clicks. It read as broken navigation rather than as a small target: clicks did nothing, so people clicked repeatedly.

Measure a hit area instead of assuming it. Sampling `document.elementFromPoint` across a row's bounding box, then reporting which control each point resolves to, turns "feels wrong" into "140 of 200 points hit nothing" and afterwards into "3 of 200". The fix is the stretched-link pattern, `after:absolute after:inset-0` on the existing control, with real controls lifted to `relative z-10`.

jsdom has no hit testing, so a component test passes whether or not the fix is present. This class of bug can only be guarded end to end, with a click at a coordinate.

### Electron E2E launches ignore a running dev app, but a dirty tree blocks checkouts

`OpenWaggleApp.launch` sets `OPENWAGGLE_DISABLE_SINGLE_INSTANCE=1`, so a running `pnpm dev` instance does not steal E2E launches. Two things do bite:

`npx playwright test` does not build. Running it directly tests the previous `out/`, which produces failures that look like broken source. Use `pnpm test:e2e`, or run `pnpm build` first. The `*:quick` E2E scripts now enforce this mechanically: `out/build-meta.json` records the HEAD a build came from, and a quick script refuses to run when HEAD moved (rebase, pull) — a stale build fails loudly instead of as phantom test failures.

`git worktree` operations can leave worktree backlinks dangling after nested git-fixture tests run; `git worktree repair <path>` from the main checkout fixes them. Git hooks export `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, so hook scripts that invoke the test suite must unset those first or git-spawning fixtures fail with "this operation must be run in a work tree".

The dev server rewrites `src/renderer/src/routeTree.gen.ts` (import ordering only, no route change). Any script that checks out commits in sequence fails on every checkout while that file is dirty. Stop the dev server before such a loop.

### Focus draws nothing, by decision

`:focus` and `:focus-visible` set `outline: none` and `box-shadow: none` app-wide, and no component adds a ring, glow or shadow on focus. This is a maintainer decision, not an oversight: do not reintroduce a focus indicator as a fix for a lint rule, an audit finding or an accessibility report. The trade-off is recorded in `docs/reviews/sidebar-remodel-review.md`, including that the app does not meet WCAG 2.2 SC 2.4.7 as a result.

`focus:opacity-100` is not an indicator and stays: it reveals hover-only controls so the keyboard can reach them at all.

### A focused row keeps its focus, so a later keypress paints its focus ring

Clicking a sidebar row leaves it focused. Chromium re-evaluates `:focus-visible` on the currently focused element when the interaction modality changes, so the next key press of any kind paints the keyboard focus indicator on a row the user clicked minutes earlier. Pressing the screenshot shortcut is enough to make it appear in the screenshot.

The consequence that outlives the ring: anything hidden behind `group-focus-within:*` on a row stays hidden for as long as that row holds focus, not just while the pointer is over it. A roll-up pip hidden that way vanished on click and stayed gone.

### Reserved shortcuts have to be declared where the conflict check looks

`Mod+F` and `Mod+1` to `Mod+9` are registered directly by sidebar hooks rather than through `shortcutBindings`, so the settings conflict check could not see them and a user could bind a command onto one. The result was two live handlers and a console warning from the hotkey library with nothing in the UI to explain it. `RESERVED_SHORTCUT_KEYS` in `src/shared/types/shortcuts.ts` is where a directly-registered combination gets declared so the check can find it.

### The menu role and its keyboard model are one decision

`role="menu"` with `role="menuitemradio"` children tells a screen reader to use arrow keys. Declaring it on a panel of plain buttons produces a menu that is operable by Tab and Enter but announces a model that does not exist, which is worse than announcing nothing. `useMenuKeyboard` in `src/renderer/src/shared/hooks/` holds the model and `Popover` switches it on with the role, so the two cannot be declared separately. Items are found in the DOM rather than registered by each call site, because a menu's items are arbitrary children.
