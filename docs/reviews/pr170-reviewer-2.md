# Review: renderer, merge-conflict resolutions and accessibility (PR #170)

Independent reviewer agent (pi on Bedrock, `eu.anthropic.claude-opus-5`), read-only against
the merged branch. Findings verbatim; the tool transcript that produced them is not kept.
Disposition for every finding is in [`pr170-findings.md`](./pr170-findings.md).

### Finding 1

SEVERITY: major
   FILE: src/renderer/src/features/chat/components/AgentNotificationStack.tsx:100-119
   WHAT: The auto-dismiss timers are keyed to the `notifications` array identity, so
 every new interaction event and every dismissal tears down and restarts the pending
 3.2 s timers for all still-visible info notifications.
   WHY IT MATTERS: `info` is contractually ephemeral, but with a burst of
 notifications each survivor gets a fresh full delay (3.2 s → 6.4 s → 9.6 s …), so
 ephemeral toasts linger above the composer for as long as the agent keeps emitting
 interaction events.
   FIX: Drive dismissal per interaction id instead of per array: keep a `Map<string,
 timeoutId>` in a ref (or a child component per notification that owns its own
 `useEffect([interactionId])`), and only schedule a timer for ids that do not already
 have one.

### Finding 2

SEVERITY: major
   FILE: src/renderer/src/features/chat/components/AgentNotificationStack.tsx:73-92
   WHAT: Only the newest `MAX_VISIBLE_NOTIFICATIONS` (3) get timers; overflow `info`
 notifications are hidden but never marked dismissed, so they pop back into view once
 the visible three expire.
   WHY IT MATTERS: An info notification can appear, vanish, and then reappear seconds
 later long after it was relevant — the opposite of ephemeral, and it re-steals
 composer space during an active run.
   FIX: Expire by age rather than visibility — compute the dismissal deadline from
 `event.timestamp` (e.g. treat `info` older than `INFO_DISMISS_DELAY_MS` as already
 dismissed) so overflowed notifications age out while hidden.

### Finding 3

SEVERITY: major
   FILE:
 src/renderer/src/features/chat/components/AgentInteractionComposerPrompt.tsx:269-299
   WHAT: The authorization/input prompt renders as a plain `<section>` with no
 `aria-live`/`role`, no accessible name, no focus management, and its error message
 is a bare `<p>`.
   WHY IT MATTERS: This is the surface that replaced the transcript approval card and
 is now the only way to unblock a paused run; a screen-reader or keyboard-first user
 gets no announcement that the agent is waiting and no route to the controls other
 than blind tabbing.
   FIX: Wrap the body in `role="group"` + `aria-labelledby` pointing at the `<h3>`,
 add `aria-live="assertive"` (or `role="alert"`) on the eyebrow/title region, give
 the error `<p>` `role="alert"`, and move focus to the primary action (or the
 section) when a new `interactionId` mounts.

### Finding 4

SEVERITY: major
   FILE:
 src/renderer/src/features/chat/components/AgentInteractionComposerPrompt.tsx:99,139,
 171
   WHAT: The `Select`, `TextInput` and `Textarea` inside the prompt have no
 `aria-label`/`aria-labelledby`; neither primitive derives a name from the
 surrounding `<h3>`.
   WHY IT MATTERS: `select`/`input`/`editor` requests are exactly the ones YOLO must
 NOT auto-answer, so these unlabelled controls are the mandatory path for every
 genuine user-input request; a screen reader announces "combo box"/"edit text" with
 no context.
   FIX: Pass `aria-label={interaction.title}` (or `id`/`htmlFor` against the title
 element) on each control; the same gap exists in the older
 `AgentInteraction*Controls` and should be fixed once in a shared wrapper.

### Finding 5

SEVERITY: minor
   FILE: src/renderer/src/routes/-chat-route-views.tsx:29-33
   WHAT: The dev-only prototype is referenced by a module-scope `lazy(() =>
 import('./-notification-prototype'))`, so Rollup still emits the chunk in production
 — verified: `pnpm build` produces
 `out/renderer/assets/-notification-prototype-DjEVl3od.js` (99.4 kB) and `index-*.js`
 contains a live `__vitePreload` reference to it.
   WHY IT MATTERS: ~1 900 lines of throwaway prototype UI ship in every release
 artifact; the runtime gate is sound (`notificationPrototypeAvailable()` folds to
 `return false`, so it cannot render), but the payload and the reachable-looking
 `__vite__mapDeps` entry are pure dead weight.
   FIX: Put the `lazy()` behind the compile-time constant so the branch is statically
 eliminated, e.g. `const LazyNotificationPrototypeRouteView =
 NOTIFICATION_PROTOTYPE_ROUTES_ENABLED ? lazy(...) : null` and render only when
 non-null — or move the prototype files out of `src/renderer/src/routes/` entirely.

### Finding 6

SEVERITY: minor
   FILE:
 src/renderer/src/features/settings/components/sections/GeneralSection.tsx:216-241
   WHAT: The "Current project default" select has no "Use global default" option, and
 `setProjectPreferences` ignores `undefined` (src/main/config/project-config.ts:173),
 so once a project override is set it can never be cleared from the UI.
   WHY IT MATTERS: The locked precedence contract is session > project > global; a
 user who accidentally pins a project to `Ask for Approval` is stuck with it for that
 project forever, including for every new session created there.
   FIX: Add an explicit "Use global default" option that clears the override (needs a
 nullable/`clear` path through `setProjectPreferences`), and drop the misleading `??
 settings.defaultAuthorizationMode` fallback in `value` so "no override" is visually
 distinct.

### Finding 7

SEVERITY: minor
   FILE:
 src/renderer/src/features/settings/components/sections/GeneralSection.tsx:56-90
   WHAT: `useProjectAuthorizationDefault` calls `api.getProjectPreferences(...)`
 without the `typeof api.x !== 'function'` guard that every sibling hook in the same
 file uses, and the existing `GeneralSection.component.test.tsx` api mock does not
 stub it.
   WHY IT MATTERS: The suite is green only because the default `settings.projectPath`
 is `null`; any test or preload shape that supplies a project path throws
 `api.getProjectPreferences is not a function` inside the effect and takes the whole
 Settings tab down.
   FIX: Add the same capability guard as `useAppVersion`/`useUpdateStatus`, and add
 `getProjectPreferences`/`setProjectPreferences` to the test mock.

### Finding 8

SEVERITY: minor
   FILE:
 src/renderer/src/features/settings/components/sections/GeneralSection.tsx:132-241
 (and AgentNotificationStack.tsx, AgentInteractionComposerPrompt.tsx,
 SessionAuthorizationModeMenu.tsx)
   WHAT: None of the four new user-facing access-mode / notification surfaces has a
 test: no component test for `AgentNotificationStack`,
 `AgentInteractionComposerPrompt`, or `SessionAuthorizationModeMenu`, and
 `GeneralSection.component.test.tsx` was not extended for `AgentAccessSection`.
   WHY IT MATTERS: The three highest-risk behaviours in this PR — info auto-dismiss
 timing, one-prompt-at-a-time selection, and mode persistence/rollback — are entirely
 unverified, which is why the timer bugs above survived a green suite.
   FIX: Add component tests with fake timers for the info-dismiss window and overflow
 behaviour, a prompt test covering "interaction disappears mid-flight" and the `+N
 queued` counter, and a `GeneralSection` test for global/project mode persistence.

### Finding 9

SEVERITY: minor
   FILE:
 src/renderer/src/features/chat/components/AgentInteractionComposerPrompt.tsx:255-266
   WHAT: `submit()` clears `busyInteractionId` in `.finally()` even on success, and
 `setError` fires after the interaction has usually been removed from
 `agentInteractions` (the component unmounts), so a failed response can be silently
 swallowed and a successful one briefly re-enables the buttons.
   WHY IT MATTERS: A user can double-submit an authorization decision in the window
 between resolve and list update, and a genuine IPC failure on an already-removed
 interaction shows no error at all.
   FIX: Keep `busy` latched after success (only clear it on failure), and surface the
 response error through the toast/store rather than component-local state that dies
 with the unmount.

### Finding 10

SEVERITY: minor
   FILE:
 src/renderer/src/features/chat/components/AgentInteractionComposerPrompt.tsx:319
   WHAT: `extraCount` counts only prompt interactions (`isPromptInteraction`), so
 pending `custom` interactions are excluded from the "+N queued" badge even though
 they occupy the same composer stack below.
   WHY IT MATTERS: The badge understates how much is blocking the run, and the user
 sees a card that is not accounted for by the counter directly above it.
   FIX: Count all non-`notify` pending interactions, or label the badge to match what
 it counts.

### Finding 11

SEVERITY: minor
   FILE:
 src/renderer/src/features/extensions/components/ExtensionAgentLoopFallback.tsx:99-10
 3
   WHAT: The custom-interaction fallback still renders the raw interaction UUID
 (`{interaction.id}`) and the internal state token in a visible `<dl>`, in both the
 composer fallback and the transcript row.
   WHY IT MATTERS: The locked contract forbids raw internal identifiers in visible
 labels; this PR de-Pi-ified the prose two lines above but left the UUID, so the
 de-branding pass is incomplete.
   FIX: Drop the `Interaction`/`State` rows (or hide them behind a dev-only details
 disclosure) and keep only the human-readable explanation plus the "Reject
 interaction" action.

### Finding 12

SEVERITY: minor
   FILE: src/renderer/src/features/chat/components/AgentInteractionCard.tsx:37
   WHAT: `InteractionHeader` prints the raw discriminant (`interaction.kind`, always
 the literal `custom` on this path) as the card subtitle under a generic "Interaction
 pending" heading.
   WHY IT MATTERS: Same contract clause as above — a raw internal kind token is
 user-visible, and "Interaction pending / custom" carries no product meaning.
   FIX: Replace with `agentLoopInteractionTitle(interaction)` (already yields "Custom
 interaction") and delete the raw `kind` line.

### Finding 13

SEVERITY: minor
   FILE:
 src/renderer/src/features/extensions/components/ExtensionAgentLoopFallback.tsx:87
   WHAT: The custom-interaction fallback uses `role="alert"` unconditionally, and
 `AgentLoopInteractionEventRow.tsx:296-310` renders that same fallback for
 *historical* resolved custom interactions in the transcript.
   WHY IT MATTERS: Screen readers interruptively announce every historical "renderer
 unavailable" card whenever the transcript re-renders or the session is reopened.
   FIX: Only apply `role="alert"` when the interaction state is `pending`; use a
 plain region for the transcript/read-only rendering.

### Finding 14

SEVERITY: minor
   FILE: src/renderer/src/features/chat/components/AgentInteractionsPanel.tsx:27
   WHAT: `AgentInteractionsPanel` is no longer rendered anywhere in the app (removed
 from `ChatPanel.tsx`); its only remaining references are its own component test and
 the `AgentLoopExtensionSurfaces` harness.
   WHY IT MATTERS: Dead production code kept alive by tests gives false coverage
 confidence — the tests that were updated in this PR
 (`AgentInteractionsPanel.component.test.tsx`) now assert behaviour no user can
 reach.
   FIX: Delete the component and its test, and rewrite the
 `AgentLoopExtensionSurfaces` harness against
 `AgentCustomInteractionComposerFallback` / `AgentInteractionComposerPrompt`, which
 are the real surfaces.

### Finding 15

SEVERITY: minor
   FILE:
 src/renderer/src/features/chat/components/AgentInteractionComposerPrompt.tsx:55-181
   WHAT: `ConfirmActions`/`SelectActions`/`InputActions`/`EditorActions` are
 near-verbatim copies of the existing
 `AgentInteractionConfirmControls`/`SelectControls`/`InputControls`/`EditorControls`,
 differing only in button order and labels.
   WHY IT MATTERS: Four duplicated control pairs will drift (the a11y gap above
 already exists in both copies, and cancel-vs-confirm ordering already differs
 between them).
   FIX: Parameterise the existing `AgentInteraction*Controls` with the label/ordering
 variants the prompt needs and delete the duplicates.

### Finding 16

SEVERITY: minor
   FILE: src/renderer/src/features/chat/components/AgentNotificationStack.tsx:99
   WHAT: `dismissedIds` grows monotonically for the lifetime of the window and is
 shared across all sessions (the stack is not remounted per session), and
 `warning`/`error` entries stay pinned above the composer until manually dismissed or
 evicted from the 30-event live window.
   WHY IT MATTERS: Switching away from a session and back re-surfaces old warnings
 above the composer even though they already have a durable transcript notice; the
 set is also unbounded, if small.
   FIX: Prune `dismissedIds` to the ids still present in `events`, and give
 `warning`/`error` a longer-but-finite lifetime in the stack (or key the stack by
 `activeSessionId`) so the transcript remains the durable record.

### Finding 17

SEVERITY: nit
   FILE: src/renderer/src/routeTree.gen.ts:12-165
   WHAT: The generated route tree was re-emitted with a different route ordering
 (`_chat`/`settings`/`skills` and `sessions.$sessionId`/`settings.$tab` swapped) with
 no route added or removed.
   WHY IT MATTERS: Pure churn in a generated file inside a merge commit makes it
 harder to tell whether the conflict resolution changed routing; it also suggests the
 committed artifact was produced by a different generator run than main's.
   FIX: Regenerate on top of the merged tree and confirm the only diff is
 intentional, or leave the file byte-identical to main.
