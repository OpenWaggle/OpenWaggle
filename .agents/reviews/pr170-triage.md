# PR #170 review triage

Source: three independent reviewers (`.agents/reviews/pr170-{backend,renderer,contract}.txt`),
run against the merged branch. Deduplicated. Status legend: [ ] open, [x] fixed, [?] needs decision.

## Blockers

- [ ] B1 MCP/task-runtime session creation bypasses authorization-mode resolution.
      `openwaggle-mcp-session-derivation.ts:78`, `openwaggle-mcp-session-lifecycle.ts:44`,
      `openwaggle-mcp-task-runtime.ts:89` call `sessions.create()` with no `authorizationMode`,
      so the store default `'yolo'` wins and the project/global default is ignored.
      `resolveSessionAuthorizationMode` is private to `session-details-handler.ts:41`.
- [ ] B2 A mid-run mode change does nothing. `run-lifecycle.ts:110` snapshots the mode into the
      UI context at run start; `sessions:set-authorization-mode` only writes the DB row.
      Violates two locked bullets: switching to YOLO must resolve the pending request, and
      switching to Ask must govern the rest of the run.

## Majors

- [ ] M1 `confirmPurpose` (`interaction-ui-context.ts:84`) classifies authorization vs input by
      exact-matching four English title literals produced in two other files. No shared
      constant, no test linking producers to classifier. All three reviewers flagged it.
- [x] M2 DECIDED: reclassify so both always prompt. In YOLO, `Open MCP elicitation URL?` is auto-granted, so an MCP server can trigger
      `shell.openExternal()` on a server-supplied URL with no consent, and the form-elicitation
      disclosure (server + requested schema) is skipped before the user types into an editor.
- [x] M3 DECIDED: live inherit chain. No inherit state today: project/global defaults are snapshotted at creation, so changing them
      never affects existing sessions, and a project override cannot be cleared from the UI
      (`GeneralSection.tsx:216`, `project-config.ts:173` ignores `undefined`).
- [ ] M4 `AgentNotificationStack.tsx:88` sorts by timestamp only, then caps at 3, so three later
      `info` notices evict an active `error`. Contract requires severity-first ordering.
- [ ] M5 Auto-dismiss timers are keyed to the `notifications` array identity, so every new event
      restarts every visible `info` timer; under a stream `info` never expires.
- [ ] M6 Overflow `info` notices beyond the visible 3 are never marked dismissed, so they pop
      back into view after the visible ones expire.
- [ ] M7 `info` notifications consume the shared 30-entry live event window
      (`useAgentChat.stream-events.ts:21`), evicting authorization request/resolution pairs; the
      Ask-mode transcript row then vanishes or stays stuck on "Waiting".
- [ ] M8 Authorization message is rendered in a plain `<p>` with no `whitespace-pre-wrap`, but
      every MCP consent body is `.join('\n')`, so Server/Tool/Arguments collapse into one
      run-on paragraph.
- [ ] M9 Visible authorization message embeds raw protocol JSON (`JSON.stringify(arguments)`,
      requested schema, whole sampling request), against the no-raw-JSON bullet.
- [ ] M10 `AgentInteractionComposerPrompt` has no `role`/`aria-live`/accessible name/focus
      management; its error is a bare `<p>`. This is the only way to unblock a paused run.
- [ ] M11 The `Select`/`TextInput`/`Textarea` in that prompt have no accessible name — exactly
      the requests YOLO must never auto-answer.
- [x] M12 DECIDED: OpenWaggle owns built-in prompts; status widgets get one run-level mount;
      delete the dead panel and its tests. `AgentInteractionsPanel` is unmounted from `ChatPanel` and now referenced only by
      tests, so the inline extension interaction surface and `ExtensionAgentLoopStatusWidgets`
      no longer render for `confirm`/`select`/`input`/`editor`. (Dialog placement still works.)
- [ ] M13 Zero tests for `AgentNotificationStack`, `AgentInteractionComposerPrompt`,
      `SessionAuthorizationModeMenu`, and the Settings `AgentAccessSection`.

## Minors and nits

- [ ] N1 `SessionDetail.authorizationMode` optional + run-path fallback to `yolo` fails open.
- [ ] N2 Durability predicate duplicated in main persistence and renderer projection.
- [ ] N3 `factoryName`, `source: 'pi-ui'`, `renderer.kind: 'pi-tui-custom'` shipped in the
      renderer payload.
- [ ] N4 `ExtensionAgentLoopFallback.tsx:100` shows a raw interaction UUID and raw state token.
- [ ] N5 `AgentInteractionCard.tsx:37` prints the raw `kind` discriminant as the subtitle.
- [ ] N6 `role="alert"` applied to historical resolved custom interactions in the transcript.
- [ ] N7 `extraCount` ("+N queued") excludes pending `custom` interactions shown right below it.
- [ ] N8 `submit()` clears busy on success and sets error after unmount, allowing double-submit
      and swallowing genuine IPC failures.
- [ ] N9 `dismissedIds` is unbounded and shared across sessions, so old warnings resurface on
      session switch.
- [ ] N10 `ConfirmActions`/`SelectActions`/`InputActions`/`EditorActions` duplicate the existing
      `AgentInteraction*Controls`.
- [x] N11 FIXED: `import.meta.env.DEV` inlined at the `lazy()` call so Rollup drops the branch.
      Verified with a clean `pnpm build`: no mockup chunk, zero references in the entry file.
- [ ] N12 `interactionEyebrow` labels an `info` notify as "Warning notification" if one ever
      reaches the row; the invariant is only enforced upstream.
- [ ] N13 No `CHECK (authorization_mode IN (...))` constraint; a bad value coerces to `yolo`.
- [ ] N14 `CURRENT_SESSION_TABLE_STATEMENT` is unreferenced and already stale (missing
      `environment_mode` and the three `worktree_*` columns).
- [ ] N15 Missing durability test for `level: 'error'` and for a non-notify request/resolution.
- [ ] N16 Leak guards use exact-match `queryByText('pi-tui-custom')`, which stays green if the
      old `Custom interaction · pi-tui-custom` label returns.
- [ ] N17 The prototype production gate has no test (`import.meta.env.DEV` is always true in
      vitest).
- [x] N18 DONE: all eight deleted, replaced by one static mockup. Was 1,771 lines of six notification prototypes live in `src/renderer/src/routes/`;
      the design is decided, so five variants are dead weight.
- [ ] N19 `routeTree.gen.ts` was re-emitted with reordered routes and no route change.

## Already resolved during the merge

- [x] Duplicate `ALTER TABLE ADD COLUMN authorization_mode` in both a numbered migration and the
      boot-time guard: the numbered migration is gone, `pinned-sessions` keeps id 24, and the
      PRAGMA-guarded guard in `database-service.ts` is now the single mechanism.

## Decisions taken in the grilling session

Recorded in `CONTEXT.md` under Language, Relationships, and Flagged ambiguities.

1. A session's Authorization mode is a live override, not a value copied at creation. Empty means
   inherit. The effective mode resolves when a request occurs, so changing a project or global
   default reaches existing sessions that hold no override. Both the composer selector and Project
   Settings need an explicit "use default" choice, which requires a real clear path through
   `setProjectPreferences`.
2. Request purpose is declared where a request is raised, never inferred from its wording. YOLO
   answers a request only when the agent asks to act itself inside this workspace and session. Of
   the seven `ui.confirm` sites, only `Allow MCP tool call?` and `Allow legacy MCP sampling?` are
   auto-granted. External navigation and disclosure always prompt, in every mode.
3. OpenWaggle owns the prompt for confirm, select, input and editor. Extensions keep the dialog,
   the transcript row, status widgets, and custom interactions. Status widgets move to a single
   run-level mount in the composer control row.
4. Notifications follow T3 Code. They float in a corner stack, clear of the composer, most severe
   in front, collapsed to a peek and expanded on hover. Info and warning leave after 5 seconds of
   focused time, errors stay until dismissed, and the clock only advances while the window is
   focused so nothing expires unwatched. This reverses the earlier N1 choice on purpose.
5. Requests never expire. Only the user or cancelling the run ends one.
