# Review: contract conformance and test quality (PR #170)

Independent reviewer agent (pi on Bedrock, `eu.anthropic.claude-opus-5`), read-only against
the merged branch. Findings verbatim; the tool transcript that produced them is not kept.
Disposition for every finding is in [`pr170-findings.md`](./pr170-findings.md).

### Finding 1

SEVERITY: blocker
   FILE: src/main/openwaggle-mcp-session-derivation.ts:78,
 src/main/openwaggle-mcp-session-lifecycle.ts:44,
 src/main/openwaggle-mcp-task-runtime.ts:89 (with
 src/main/store/session-details/session-creation.ts:32,54)
   WHAT: Three session-creation paths call `sessions.create({...})` without
 `authorizationMode`, so the store falls back to a hardcoded `'yolo'` instead of
 resolving the project/global default.
   WHY IT MATTERS: A user who sets the global or project default to `Ask for
 Approval` still gets full-access sessions for every MCP-derived, MCP-lifecycle, and
 task-runtime session — the precedence rule is silently bypassed in favour of the
 less safe mode.
   FIX: Extract `resolveSessionAuthorizationMode` out of
 `session-details-handler.ts:41` into an application-level helper and call it from
 all four creation sites; make `CreateSessionInput.authorizationMode` required (or
 default it from `SettingsService`, not from a literal) so a new creation path cannot
 silently pick `'yolo'`.

### Finding 2

SEVERITY: blocker
   FILE: src/main/adapters/pi/agent-kernel/run-lifecycle.ts:110 and
 src/main/ipc/session-details-handler.ts:174-179
   WHAT: `authorizationMode` is snapshotted into the run's UI context once at run
 start, and `sessions:set-authorization-mode` only writes the DB row — it neither
 re-resolves the live run nor settles the pending interaction.
   WHY IT MATTERS: Violates two locked bullets directly: "Changing a session to YOLO
 (Full access) resolves its pending Authorization request automatically" (the pending
 prompt just sits there) and "changing to Ask for Approval governs subsequent
 requests" (the rest of the in-flight run keeps auto-granting after the user switched
 to Ask).
   FIX: Make the UI context read the mode through a getter (`() =>
 currentModeForSession(sessionId)`) instead of a captured value, and have the IPC
 handler, on a switch to `yolo`, resolve pending `confirm` interactions whose
 `purpose === 'authorization'` for that session via the broker
 (`submitAgentLoopInteractionResponse` with `accepted: true`).

### Finding 3

SEVERITY: major
   FILE: src/main/adapters/pi/agent-kernel/interaction-ui-context.ts:84-95
   WHAT: Authorization vs. confirmation classification is four hardcoded English
 title literals, duplicated by value from `mcp-tool-execution.ts:42`,
 `mcp-client-interactions.ts:86,115,214`, with no shared constant and no test
 asserting the two sides stay in sync.
   WHY IT MATTERS: Renaming or localising any of those titles silently disables YOLO
 auto-grant for that capability (user gets prompts in a mode that promises none), and
 any future authorization confirm added elsewhere silently gets `purpose:
 'confirmation'` and is never auto-granted — while a benign confirm that happens to
 reuse a title would be auto-granted.
   FIX: Move the purpose into the call contract instead of inferring it: add an
 `AUTHORIZATION_CONFIRM_TITLES` const (or better, a `purpose` field on an
 OpenWaggle-owned confirm wrapper) exported from one module and imported by both the
 MCP call sites and `confirmPurpose`, plus a unit test that asserts every MCP
 authorization call site classifies as `'authorization'`.

### Finding 4

SEVERITY: major
   FILE: src/renderer/src/features/chat/components/AgentNotificationStack.tsx:88-91
   WHAT: `visibleNotifications` sorts purely by `timestamp` descending and then
 truncates to `MAX_VISIBLE_NOTIFICATIONS = 3`; severity is never part of the
 ordering.
   WHY IT MATTERS: Breaks "A Live notification banner fronts the most severe active
 notice and stacks additional notices behind it" — three later `info` notices push an
 active `error` out of the visible set entirely, so the user loses the error banner
 (`error`/`warning` never auto-dismiss, so this is not self-correcting).
   FIX: Sort by a severity rank first (`error` > `warning` > `info`) and by timestamp
 only within a rank, and exclude already-shown-and-expired `info` from competing for
 the three slots.

### Finding 5

SEVERITY: major
   FILE: src/renderer/src/features/chat/hooks/useAgentChat.stream-events.ts:21,136
 with src/renderer/src/features/chat/lib/build-agent-loop-interaction-rows.ts:44-48
   WHAT: Every notification — including ephemeral `info` — is pushed into the same
 `INTERACTION_EVENT_LIMIT = 30` live event window (two entries each: request + notify
 ack), and `appendInteractionEventRows` silently drops a resolution whose request has
 been evicted.
   WHY IT MATTERS: 15 info notifications are enough to evict all authorization
 request/resolution events from the live window; the Ask-mode row then either
 disappears or is stuck showing "Waiting" even though the decision was made — i.e.
 "exactly one transcript entry which updates in place" fails precisely when
 notifications are noisy, and `info` (which is supposed to leave no trace) is what
 destroys the history.
   FIX: Filter `notify`+`info` out of `addInteractionEvent` (it is only needed by the
 banner, which can use its own short list), and make `appendInteractionEventRows`
 synthesise a row from an orphan resolution instead of dropping it.

### Finding 6

SEVERITY: major
   FILE:
 src/renderer/src/features/chat/components/AgentInteractionComposerPrompt.tsx:291 and
 src/renderer/src/features/chat/components/AgentLoopInteractionEventRow.tsx:260
   WHAT: The authorization message is rendered in a plain `<p>` with no
 `whitespace-pre-wrap`, but every MCP consent body is built with `.join('\n')`
 (`mcp-tool-execution.ts:43-49`, `mcp-client-interactions.ts:87-93,116-124,215-227`).
   WHY IT MATTERS: The `Server:` / `Tool:` / `Arguments:` / scope lines collapse into
 a single run-on paragraph in both the new prompt and the new transcript row, so the
 request does not "identify its action, requester, exact target, and effect in
 user-facing language" — the user is asked to grant access to text they cannot parse.
   FIX: Add `whitespace-pre-wrap` to both message paragraphs, or give
 `AgentLoopConfirmInteraction` a structured `details: readonly {label, value}[]` and
 render a definition list instead of a newline-joined blob.

### Finding 7

SEVERITY: major
   FILE: src/main/adapters/pi/mcp-tool-execution.ts:45,
 src/main/adapters/pi/mcp-client-interactions.ts:118,226
   WHAT: The visible authorization message embeds raw protocol JSON —
 `JSON.stringify(input.arguments, null, 2)`, `reviewText(requestedSchema)`, and
 `reviewText(input.request)` (the whole sampling request).
   WHY IT MATTERS: Contradicts the locked bullet "no raw internal identifiers (…
 response JSON) in any visible label" and the glossary requirement that an
 Authorization request speaks "user-facing language"; combined with the finding above
 it is one unbroken JSON blob inside the prompt.
   FIX: Render the payload behind a collapsed `<details>`/expand in the prompt (a
 code block, not the label), and keep the label itself to server, capability, and
 target. If the raw payload is deliberately kept for informed consent, record that
 exception in CONTEXT.md so the contract and the code agree.

### Finding 8

SEVERITY: major
   FILE: src/renderer/src/features/chat/components/ChatPanel.tsx:24 (removal) and
 src/renderer/src/features/chat/components/AgentInteractionsPanel.tsx
   WHAT: `AgentInteractionsPanel` was unmounted from `ChatPanel` and is now
 referenced only by three test files. It was the sole mount point for inline
 `ExtensionAgentLoopSurface` (interaction surface) and the only mount point in the
 app for `ExtensionAgentLoopStatusWidgets`; the replacement composer stack routes
 only `kind === 'custom'` through `AgentInteractionCard`.
   WHY IT MATTERS: Extensions can no longer render an inline interaction surface or a
 status widget for `confirm`/`select`/`input`/`editor` interactions — a silent
 regression of "An Interactive agent-loop contribution returns user feedback to the
 pending interaction" — and `AgentInteractionsPanel.component.test.tsx`,
 `AgentInteractionsPanel.status-widgets.component.test.tsx`,
 `AgentLoopExtensionSurfaces.component.test.tsx` still pass green while covering zero
 shipped code.
   FIX: Either mount the extension interaction/status surfaces for all pending
 interaction kinds from `ChatComposerStack` (not just `custom`), or delete
 `AgentInteractionsPanel` plus its three tests and re-point the
 status-widget/extension-surface coverage at the component that actually renders
 them.

### Finding 9

SEVERITY: major
   FILE: src/renderer/src/features/chat/components/__tests__/ (no file)
   WHAT: There is no test of any kind — component, unit, or e2e — for
 `AgentNotificationStack`, `AgentInteractionComposerPrompt`,
 `SessionAuthorizationModeMenu`, or `GeneralSection`'s `AgentAccessSection`; `grep
 -rln` over the test tree returns nothing for all four.
   WHY IT MATTERS: The entire user-visible surface of this PR is unverified.
 Specifically untested branches: severity ordering and the 3-slot cap; `info`
 auto-dismiss vs. `warning`/`error` persistence; manual dismiss; `Allow once` /
 `Continue without` vs. `Confirm` / `Cancel` label switching on `purpose`;
 `Authorization requested` vs. `Confirmation requested` eyebrow; the `+N queued`
 counter; `onRespond` rejection surfacing an error; the `saving` guard and no-op
 guard in the mode menu; project-override write/read and the "no project override
 yet" copy.
   FIX: Add component tests for those four, driving the `purpose` and `level`
 discriminants explicitly and asserting label text (not element counts).

### Finding 10

SEVERITY: minor
   FILE:
 src/renderer/src/features/chat/components/__tests__/AgentLoopInteractionEventRow.com
 ponent.test.tsx:38-42, AgentInteractionsPanel.component.test.tsx:222-225,
 AgentCustomInteractionComposerFallback.component.test.tsx:33-35
   WHAT: The "no internal identifier leaked" guard is
 `queryByText(OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE)`, which by
 default matches only a text node whose entire content equals `pi-tui-custom`; the
 companion assertion is `getAllByText('Custom interaction')).toHaveLength(3)`.
   WHY IT MATTERS: Reintroducing the old label `Custom interaction · pi-tui-custom`
 would leave both assertions green — the exact-match query would not fire, and the
 count would still be 3. The tests would pass if the regression they exist to prevent
 came back.
   FIX: Use `queryByText(new RegExp(PI_TUI_CUSTOM_INTERACTION_TYPE))` (or `{ exact:
 false }`) and additionally assert
 `expect(container.textContent).not.toMatch(/pi-ui|pi-tui|\bPi\b/)`; replace the
 magic length counts with assertions on specific roles/headings.

### Finding 11

SEVERITY: minor
   FILE: src/renderer/src/routes/__tests__/-route-search.unit.test.ts:33-62
   WHAT: The new tests assert that `prototype`/`variant` survive parsing, but
 `NOTIFICATION_PROTOTYPE_ROUTES_ENABLED = import.meta.env.DEV` is always `true` under
 vitest, so only the dev branch is exercised.
   WHY IT MATTERS: The production gate — the thing that keeps 1,771 lines of
 prototype UI unreachable in a shipped app — has no coverage; if
 `parseNotificationPrototype` lost its guard the suite would stay green.
   FIX: Stub `import.meta.env.DEV` (or inject the flag) and add a case asserting
 `parseChatRouteSearch({ prototype: 'notifications', variant: 'B1' })` returns `{}`
 when the flag is off; likewise assert `RETAINED_CHAT_SEARCH_PARAMS` omits them.

### Finding 12

SEVERITY: minor
   FILE:
 src/renderer/src/features/extensions/components/ExtensionAgentLoopFallback.tsx:100-1
 06
   WHAT: The custom-interaction fallback renders `Interaction: {interaction.id}` (a
 raw UUID) and `State: {interaction.state}` (raw enum token) as visible labels.
   WHY IT MATTERS: The PR cleaned `pi-tui-custom` and "Pi TUI" out of this same card
 but left a raw internal identifier and an internal state token in it, so the "no raw
 internal identifiers in any visible label" bullet is still not satisfied for this
 surface.
   FIX: Drop the id row (or hide it behind a copy-for-support affordance) and map
 `state` through a user-facing label map (`pending → Waiting`, `submitted →
 Answered`, `cancelled → Dismissed`).

### Finding 13

SEVERITY: minor
   FILE: src/main/application/agent-run/__tests__/agent-loop-events.unit.test.ts:8-54
   WHAT: The durability test covers `info` (false), `warning` (true), and the notify
 ack (false), but never `level: 'error'`, and never a non-notify request/resolution
 pair.
   WHY IT MATTERS: "warning or error creates exactly one Durable notification notice"
 is only half proven; the `event.interaction.level !== 'info'` condition would still
 pass this test if it were narrowed to `=== 'warning'`.
   FIX: Add `error` and a `confirm` request/resolution pair (both `true`) to the same
 test.

### Finding 14

SEVERITY: minor
   FILE:
 src/renderer/src/features/settings/components/sections/GeneralSection.tsx:161-167,22
 6
   WHAT: The project select falls back to `settings.defaultAuthorizationMode` for
 display when no override exists, and there is no "Use global default" option, so
 once a project override is written it can never be removed.
   WHY IT MATTERS: The precedence chain is one-way in the UI — a user who sets a
 project override cannot return the project to "inherit global", so a later change to
 the global default silently has no effect for that project.
   FIX: Add an explicit `Use global default` option that calls
 `setProjectPreferences` with the key cleared, and teach
 `setProjectPreferences`/`parseProjectPreferences` to delete `authorizationMode` when
 passed `null`.

### Finding 15

SEVERITY: minor
   FILE: src/renderer/src/features/chat/components/AgentNotificationStack.tsx:103-119
   WHAT: The auto-dismiss effect depends on `notifications`, which is recomputed
 whenever `events` or `dismissedIds` changes, so every new interaction event or
 dismissal restarts the 3.2 s timer of every visible `info` notice.
   WHY IT MATTERS: Under a stream of notifications, `info` notices never reach their
 dismissal deadline and stop being ephemeral in practice.
   FIX: Key the timers off stable `interactionId`s in a ref-held map created once per
 id, rather than re-creating all timers on every `notifications` identity change.

### Finding 16

SEVERITY: minor
   FILE:
 src/renderer/src/features/chat/components/AgentLoopInteractionEventRow.tsx:59
   WHAT: `interactionEyebrow` for a `notify` interaction returns `'Error
 notification'` or, for anything else, `'Warning notification'` — an `info` notify
 would be rendered as a warning.
   WHY IT MATTERS: The "no durable history for info" guarantee is enforced only
 upstream in `build-agent-loop-interaction-rows.ts`; if a persisted or replayed
 `info` event ever reaches this row it is mislabelled as a warning, which is worse
 than not rendering it.
   FIX: Return `null` from `InteractionEventRow` for `level === 'info'` so the
 invariant is enforced at the render boundary too, and add a component test for it.

### Finding 17

SEVERITY: nit
   FILE: src/main/services/database-schema.ts:39-46 and
 src/main/services/database-service.ts:35-45
   WHAT: `CURRENT_SESSION_SCHEMA_STATEMENTS` (which now carries the
 `authorization_mode` column) is no longer referenced by any production code path —
 only by `SESSION_SCHEMA_BEFORE_AUTHORIZATION_MODE_STATEMENTS.slice(1)` in the same
 file — and `ensureSessionAuthorizationModeColumn` re-does migration 24 on every
 boot.
   WHY IT MATTERS: Two sources of truth for the sessions table plus an unconditional
 `PRAGMA table_info` on every startup; the exported "current" schema is dead and will
 drift from what migrations actually produce.
   FIX: Drop the `authorization_mode` column from `CURRENT_SESSION_TABLE_STATEMENT`
 (or delete the now-unused export) and remove `ensureSessionAuthorizationModeColumn`
 now that migration 24 owns the column.

### Finding 18

SEVERITY: nit
   FILE: src/renderer/src/routes/-notification-prototype*.tsx (8 files, 1,771 lines)
   WHAT: Six notification design prototypes plus shared parts are committed into the
 production route directory, wired into `-chat-route-views.tsx` behind
 `import.meta.env.DEV && protocol === 'http:'`.
   WHY IT MATTERS: Prototype code in `src/renderer/src/routes/` is indistinguishable
 from shipped routes to future readers and to the architecture lint boundaries; the
 design decision is already made, so five of the six variants are permanent dead
 weight.
   FIX: Delete the discarded variants (or move the survivor's exploration under
 `fixtures/`/`docs/`), and drop the `prototype`/`variant` search params from
 `ChatRouteSearch` once they are gone.
