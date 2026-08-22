# PR #170 review triage

Source: three independent reviewers (`.agents/reviews/pr170-{backend,renderer,contract}.txt`),
run against the merged branch. Deduplicated. Status legend: [ ] open, [x] fixed, [?] needs decision.

## Blockers

All 47 findings are closed. Each line records the commit that closed it.

- [x] B1 (f4d09524 creation stores no mode, so no path can land on yolo by omission) MCP/task-runtime session creation bypasses authorization-mode resolution.
      `openwaggle-mcp-session-derivation.ts:78`, `openwaggle-mcp-session-lifecycle.ts:44`,
      `openwaggle-mcp-task-runtime.ts:89` call `sessions.create()` with no `authorizationMode`,
      so the store default `'yolo'` wins and the project/global default is ignored.
      `resolveSessionAuthorizationMode` is private to `session-details-handler.ts:41`.
- [x] B2 (f4d09524 resolved at request time; grantPendingAuthorizationsForSession on switch to YOLO) A mid-run mode change does nothing. `run-lifecycle.ts:110` snapshots the mode into the
      UI context at run start; `sessions:set-authorization-mode` only writes the DB row.
      Violates two locked bullets: switching to YOLO must resolve the pending request, and
      switching to Ask must govern the rest of the run.

## Majors

- [x] M1 (78eb4bf4 title sniffing deleted; purpose declared at the call site) `confirmPurpose` (`interaction-ui-context.ts:84`) classifies authorization vs input by
      exact-matching four English title literals produced in two other files. No shared
      constant, no test linking producers to classifier. All three reviewers flagged it.
- [x] M2 (78eb4bf4 external navigation and disclosure stay on plain confirm) DECIDED: reclassify so both always prompt. In YOLO, `Open MCP elicitation URL?` is auto-granted, so an MCP server can trigger
      `shell.openExternal()` on a server-supplied URL with no consent, and the form-elicitation
      disclosure (server + requested schema) is skipped before the user types into an editor.
- [x] M3 (f4d09524 + 22fd4f26 live chain, nullable override, Use default in Settings and composer) DECIDED: live inherit chain. No inherit state today: project/global defaults are snapshotted at creation, so changing them
      never affects existing sessions, and a project override cannot be cleared from the UI
      (`GeneralSection.tsx:216`, `project-config.ts:173` ignores `undefined`).
- [x] M4 (39d97933 severity-first ordering) `AgentNotificationStack.tsx:88` sorts by timestamp only, then caps at 3, so three later
      `info` notices evict an active `error`. Contract requires severity-first ordering.
- [x] M5 (39d97933 per-notice clocks keyed by id) Auto-dismiss timers are keyed to the `notifications` array identity, so every new event
      restarts every visible `info` timer; under a stream `info` never expires.
- [x] M6 (39d97933 every notice owns a clock, including overflowed ones) Overflow `info` notices beyond the visible 3 are never marked dismissed, so they pop
      back into view after the visible ones expire.
- [x] M7 (39d97933 independent notify and decision budgets) `info` notifications consume the shared 30-entry live event window
      (`useAgentChat.stream-events.ts:21`), evicting authorization request/resolution pairs; the
      Ask-mode transcript row then vanishes or stays stuck on "Waiting".
- [x] M8 (8615aa37 + ecd1c9b9 pre-wrapped, capped Details in the ribbon and the transcript row) Authorization message is rendered in a plain `<p>` with no `whitespace-pre-wrap`, but
      every MCP consent body is `.join('\n')`, so Server/Tool/Arguments collapse into one
      run-on paragraph.
- [x] M9 (8615aa37 payload behind Details, never in the label) Visible authorization message embeds raw protocol JSON (`JSON.stringify(arguments)`,
      requested schema, whole sampling request), against the no-raw-JSON bullet.
- [x] M10 (71cd3a63 polite live region, named region, error announced via role=alert) `AgentInteractionComposerPrompt` has no `role`/`aria-live`/accessible name/focus
      management; its error is a bare `<p>`. This is the only way to unblock a paused run.
- [x] M11 (71cd3a63 accessible names on select, input, editor and their actions) The `Select`/`TextInput`/`Textarea` in that prompt have no accessible name — exactly
      the requests YOLO must never auto-answer.
- [x] M12 (0f112685 status widgets mounted once per run; dead panel deleted) DECIDED: OpenWaggle owns built-in prompts; status widgets get one run-level mount;
      delete the dead panel and its tests. `AgentInteractionsPanel` is unmounted from `ChatPanel` and now referenced only by
      tests, so the inline extension interaction surface and `ExtensionAgentLoopStatusWidgets`
      no longer render for `confirm`/`select`/`input`/`editor`. (Dialog placement still works.)
- [x] M13 (multiple: 10 notification, 7 ribbon, 8 accessibility, 7 mode menu, 8 Settings component tests) Zero tests for `AgentNotificationStack`, `AgentInteractionComposerPrompt`,
      `SessionAuthorizationModeMenu`, and the Settings `AgentAccessSection`.

## Minors and nits

- [x] N1 (f4d09524 fail closed to ask-for-approval) `SessionDetail.authorizationMode` optional + run-path fallback to `yolo` fails open.
- [x] N2 (4ea2b7ca shared durability predicate) Durability predicate duplicated in main persistence and renderer projection.
- [x] N3 (0f112685 factoryName removed from the payload and the type) `factoryName`, `source: 'pi-ui'`, `renderer.kind: 'pi-tui-custom'` shipped in the
      renderer payload.
- [x] N4 (0f112685 raw UUID and state token replaced with a human label) `ExtensionAgentLoopFallback.tsx:100` shows a raw interaction UUID and raw state token.
- [x] N5 (0f112685 raw kind discriminant replaced with the user-facing title) `AgentInteractionCard.tsx:37` prints the raw `kind` discriminant as the subtitle.
- [x] N6 (0f112685 role=alert only while pending) `role="alert"` applied to historical resolved custom interactions in the transcript.
- [x] N7 (8615aa37 counts every blocking request) `extraCount` ("+N queued") excludes pending `custom` interactions shown right below it.
- [x] N8 (8615aa37 busy latches on success) `submit()` clears busy on success and sets error after unmount, allowing double-submit
      and swallowing genuine IPC failures.
- [x] N9 (39d97933 dismissals reset with the session key) `dismissedIds` is unbounded and shared across sessions, so old warnings resurface on
      session switch.
- [x] N10 (8615aa37 select, input and editor reuse the shared controls) `ConfirmActions`/`SelectActions`/`InputActions`/`EditorActions` duplicate the existing
      `AgentInteraction*Controls`.
- [x] N11 (4ea2b7ca mockups deleted; clean build emits no chunk) FIXED: `import.meta.env.DEV` inlined at the `lazy()` call so Rollup drops the branch.
      Verified with a clean `pnpm build`: no mockup chunk, zero references in the entry file.
- [x] N12 (this commit: the row renders nothing for an informational notice) `interactionEyebrow` labels an `info` notify as "Warning notification" if one ever
      reaches the row; the invariant is only enforced upstream.
- [x] N13 (4ea2b7ca CHECK constraint on the override column) No `CHECK (authorization_mode IN (...))` constraint; a bad value coerces to `yolo`.
- [x] N14 (f4d09524 one canonical sessions statement; slice(1) coupling removed) `CURRENT_SESSION_TABLE_STATEMENT` is unreferenced and already stale (missing
      `environment_mode` and the three `worktree_*` columns).
- [x] N15 (4ea2b7ca error level and a decision pair covered) Missing durability test for `level: 'error'` and for a non-notify request/resolution.
- [x] N16 (0f112685 + this commit source scan replaces exact-match text guards) Leak guards use exact-match `queryByText('pi-tui-custom')`, which stays green if the
      old `Custom interaction · pi-tui-custom` label returns.
- [x] N17 (4ea2b7ca route test asserts no throwaway design key survives) The prototype production gate has no test (`import.meta.env.DEV` is always true in
      vitest).
- [x] N18 (0e9b9718 + 4ea2b7ca prototypes and then the mockup deleted) DONE: all eight deleted, replaced by one static mockup. Was 1,771 lines of six notification prototypes live in `src/renderer/src/routes/`;
      the design is decided, so five variants are dead weight.
- [x] N19 (verified: routeTree.gen.ts has no diff against origin/main) `routeTree.gen.ts` was re-emitted with reordered routes and no route change.

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

## Agreed scope: full implementation in this MR

Decided after the grilling session. No deferrals, no follow-up PR.

### Slice 1. Authorization resolution core
- Extract `resolveSessionAuthorizationMode` into a shared application module and call it from all
  four session-creation paths, including the three MCP/task-runtime ones (blocker B1).
- Make `authorization_mode` nullable, `NULL` meaning inherit, and resolve session then project then
  global at request time rather than at creation (M3).
- Resolve the mode when a request is raised, not once per run, and settle a pending authorization
  request when the session switches to YOLO (blocker B2).
- Make the mode required on `SessionDetail` or fail closed, never open (N1).

### Slice 2. Scoped authorization grants
- New migration (id 25) and table keyed on project, requester, capability, and resource.
- Matching requires all four to agree; a grant satisfies a request without prompting in Ask mode.
- IPC to list, create and revoke; Settings surface listing every grant with a revoke action.
- `Allow…` menu offers session scope and project scope, and the project option names the exact
  requester, capability and destination it is about to grant.

### Slice 3. Request purpose
- Declare purpose at each of the seven `ui.confirm` call sites; delete the title sniffing (M1).
- YOLO auto-grants only the authorization purpose. External navigation and disclosure always
  prompt, in every mode (M2).

### Slice 4. Notifications, T3 model
- Move the stack out of the composer into a floating corner viewport, thread-scoped.
- Severity ordering, per-notice timers keyed by id, focused-time clock that pauses on blur,
  info and warning leave after 5s, errors persist (M4, M5, M6, N9).
- Separate the notification feed from the interaction event window so info notices can no longer
  evict authorization events (M7).
- Return `null` at the render boundary for an info notify (N12).

### Slice 5. Approval ribbon
- B3 ribbon above the composer, with composer draft continuity enforced by test.
- `Details` disclosure carrying the payload with `whitespace-pre-wrap` (M8, M9).
- One transcript row per request, updating in place, with the queued counter (N7).
- Queue chip naming what it waits on.

### Slice 6. Extension boundary
- One run-level mount for status widgets; delete `AgentInteractionsPanel` and its three tests (M12).
- Drop `factoryName`, `pi-ui` and `pi-tui-custom` from the renderer payload (N3).
- Remove the raw UUID and state token from the fallback (N4), the raw `kind` subtitle (N5), and
  scope `role="alert"` to pending only (N6).

### Slice 7. Accessibility
- Polite live region, accessible names on every control, remappable focus chord through the
  shortcut registry, and no key bound to a grant action (M10, M11).

### Slice 8. Tests and cleanup
- Component tests for the notification stack, the ribbon, the session mode menu and the Settings
  section, including the draft-continuity invariants (M13).
- Migration test from an older database, grant matching tests, purpose classification tests tying
  each call site to its declared purpose.
- Fix assertions that cannot fail (N16), cover the production route gate (N17), add the error-level
  durability case (N15).
- Shared durability predicate (N2), CHECK constraint (N13), dead `CURRENT_SESSION` statement (N14),
  duplicated control components (N10), submit busy and error handling (N8), routeTree churn (N19).
- Delete the mockup files.
