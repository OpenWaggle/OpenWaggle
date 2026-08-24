# Review round 2: renderer, UX contract, accessibility, test quality (PR #170)

Branch `pi/approval-modes-notifications` @ `03cbb5fd` vs `origin/main` (`b987cb82`).
Read-only review. No file in the repository was modified; no git write command was run.

Verified green before reviewing: `vitest run -c vitest.component.config.ts src/renderer/src/features/chat src/renderer/src/features/settings` → 64 files, 318 tests passed.

## What holds up

Checked against `CONTEXT.md` and ADR 0023, these invariants are genuinely implemented, not just asserted:

- **Composer draft continuity (1).** `AgentInteractionComposerPrompt` is a sibling rendered above `<Composer>` in `ChatComposerStack.tsx:214-218`; nothing in the request path touches `mode.disabled`, `mode.placeholder` or the send gate. The only composer disabling left is the pre-existing branch-summary path. Covered by a component test *and* by `e2e/access-modes.e2e.test.ts:99` which types a draft, injects a real `agent:event`, and re-asserts draft, enabled state and `document.activeElement`.
- **Notifications never dock to the composer (3).** `useAgentChat.stream-events.ts:98` drops `notify` before it can enter the pending-interaction list, so a notice structurally cannot become a ribbon. The stack is anchored in `ChatPanel.tsx:22-30`, outside `[data-chat-composer-form]`, and the e2e asserts non-containment rather than trusting the class list.
- **Focus-aware dismissal clock (3).** `NotificationDismissClock` (`AgentNotificationStack.tsx:88-146`) is keyed per notice id, counts only `document.hasFocus() && visibilityState === 'visible'` time, and is mounted for overflowed notices too. The unit tests exercise pause-on-blur, resume-on-focus, and the "a new notice must not restart another notice's clock" regression; those tests can fail.
- **Info vs warning/error durability (3).** One shared rule in `src/shared/utils/agent-notification-durability.ts`, applied at both the projection and the render boundary, with the render boundary defended by `useBuildChatRows.agent-loop.unit.test.ts` and `AgentLoopInteractionEventRow.component.test.tsx`.
- **No retroactive revocation, stated in the UI (6).** `AgentAccessSection.tsx:150-152` says "Revoking stops future use. It does not recall work already done.", asserted by test.
- **Stack ordering (3).** Severity-first ordering is a pure function with real unit tests plus an e2e that reads `data-notification-level` order.
- **No key bound to a grant (ADR).** `request.focus` is wired for real (`useWorkspaceLifecycle.ts:114-117`) and only moves focus; `focusPendingRequest` returns `false` when nothing is pending so the chord falls through.
- **Live notices are not resurrected on reload.** The stack is fed `sections.agentInteractionEvents` (live stream state only); persisted history goes down the separate `mergeInteractionEvents` transcript path. Reopening a session therefore cannot replay old error toasts. Good, and easy to have got wrong.

Also confirmed not a defect: the Tailwind v4 arbitrary values in `AgentNotificationStack.tsx:246` compile correctly — I ran them through the workspace's `tailwindcss@4.3.3` and `w-[calc(100%---spacing(8))]` emits `width: calc(100% - calc(var(--spacing) * 8))`.

---

## Defects, ranked

### 1. SEVERITY: major — the composer control shows mode names that CONTEXT.md tells you to avoid

**FILE:** `src/shared/types/agent-authorization.ts:19-22`, consumed at `src/renderer/src/features/chat/components/SessionAuthorizationModeMenu.tsx:108` and `:147`

**WHAT:** The branch adds a second label vocabulary, `AGENT_AUTHORIZATION_MODE_SHORT_LABELS = { yolo: 'YOLO', 'ask-for-approval': 'Ask' }`, and the composer control renders *only* that vocabulary while closed. `CONTEXT.md:223-225` defines the term as **Ask for Approval** with `_Avoid_: Ask mode, manual mode, confirmation mode`; `CONTEXT.md:215-217` defines **YOLO (Full access)** with `_Avoid_: YOLO mode`. The brief's invariant 5 is "two labels only".

**WHY IT MATTERS:** In the steady state — control closed, which is 100% of the time the user is not actively changing it — the one surface that reports the session's access mode says "Ask". Alone, that is a verb, not a mode name: it does not say approval is required, and it is the exact contraction the domain language rules out. A user glancing at the composer to check whether the agent can act unattended reads a word the product's own vocabulary rejects. The branch's own test locks the violation in: `SessionAuthorizationModeMenu.component.test.tsx:41` asserts `queryByRole('option', { name: 'YOLO (Full access)' })` is *absent* while closed.

**FIX:** Delete `AGENT_AUTHORIZATION_MODE_SHORT_LABELS` and render `AGENT_AUTHORIZATION_MODE_LABELS` in both states, which also deletes the whole `choosing` state machine (`SessionAuthorizationModeMenu.tsx:78,104-110,124-149`). If width is the real constraint, buy it by dropping the redundant `Access` prefix at `:135` — the label already carries the meaning — not by renaming the mode.

---

### 2. SEVERITY: major — answering a request throws keyboard focus to `<body>`

**FILE:** `src/renderer/src/features/chat/components/AgentInteractionComposerPrompt.tsx:36-44` (with `AgentAuthorizationRibbon.tsx:176-198`)

**WHAT:** `submit()` sets `busy` synchronously, and every control in the ribbon is `disabled={busy}`. Disabling the currently focused element blurs it, so `document.activeElement` becomes `<body>` the instant the user presses Enter or Space on "Allow once", "Continue without", or a scope choice. Nothing restores it: `restoreFocusBeforeRequest()` is only called from the two Escape handlers (`AgentAuthorizationRibbon.tsx:169-173`, `AgentInteractionComposerPrompt.tsx:71-75`). `busy` is deliberately latched, so the ribbon then unmounts with focus already gone.

**WHY IT MATTERS:** This is the failure mode the whole design exists to prevent. ADR 0023 promises "a remappable shortcut moves focus to a pending request and Escape returns the caret", and "reaching the decision by a deliberate shortcut is slower and cannot lose work". A keyboard user who uses `Cmd+Shift+A`, decides, and presses Enter is dumped at the top of the document mid-sentence: Escape no longer works (the ribbon no longer has focus, so its `onKeyDown` never fires), and the next Tab restarts from the document start. The declared two-step approve becomes two steps plus a hunt back to the composer. Screen-reader users additionally lose all context — no announcement, focus on body.

**FIX:** In `useResponseSubmission.submit`, restore focus once the response settles:
```ts
onRespond(interaction, response)
  .then(() => { restoreFocusBeforeRequest() })
  .catch(...)
```
and make `restoreFocusBeforeRequest` (`pending-request-focus.ts:41-45`) fall back to the composer input when no return target was remembered (the user tabbed in rather than using the shortcut), e.g. `document.querySelector('[data-chat-composer-form] [aria-label="Message input"]')`.

---

### 3. SEVERITY: major — the `Allow…` scope menu cannot be dismissed, and Escape makes it worse

**FILE:** `src/renderer/src/features/chat/components/AgentAuthorizationRibbon.tsx:60-110` (Escape handler at `:169-173`)

**WHAT:** `AllowScopeMenu` opens on click and closes only by clicking the trigger again or picking an item. There is no outside-click handler, no blur handler, and no Escape handling of its own. Escape *does* fire — and bubbles to the section handler, which calls `event.stopPropagation()` and moves focus back to the composer while leaving the menu mounted and open. The menu is `absolute … bottom-full z-20`, so it floats over the transcript.

**WHY IT MATTERS:** The component's own docstring states the intent: "`Allow…` holds the scopes rather than putting them in the button row, so a standing approval is never one stray click away". The result is the opposite. The user opens the menu, changes their mind, presses Escape, gets their caret back and starts typing — and a menu whose second item is *"Always allow list_issues for github-issues in myproject"* is still on screen, still armed, and now unrelated to where the user's attention is. One stray click writes a persistent grant into project config. The same menu also breaks the ARIA menu pattern it declares (`role="menu"` / `role="menuitem"` with no arrow-key handling and no focus move into the menu), so a screen-reader user is told a menu opened and then gets no menu behaviour.

**FIX:** Smallest correct change is local to `AllowScopeMenu`: add `onKeyDown` on its wrapper that closes on Escape and stops propagation (so the ribbon's focus-return does not also fire on the same keystroke), plus `onBlur` on the wrapper closing when `relatedTarget` is outside it. If the ARIA menu semantics are not going to be implemented, drop `role="menu"`/`role="menuitem"` and let it be a group of buttons, which is what it actually is.

---

### 4. SEVERITY: major — no test exercises any authorization decision

**FILE:** `src/renderer/src/features/chat/components/__tests__/AgentInteractionComposerPrompt.component.test.tsx:126-140`; missing `src/renderer/src/features/chat/lib/__tests__/agent-authorization-ribbon-model.unit.test.ts`

**WHAT:** Nothing on this branch clicks a decision control and asserts the response. The ribbon tests assert only that "Continue without", "Allow…" and "Allow once" *exist*. `git show origin/main:.../AgentInteractionsPanel.component.test.tsx` did assert `onRespond` payloads (`{ kind: 'confirm', accepted: true }`, `accepted: false`, custom `value: null`); that file was deleted and the payload assertions were not carried over. `allowScopeChoices`, `ribbonTargetLine`, `isAuthorizationRequest` and `queuedRequestCount` in `agent-authorization-ribbon-model.ts` have no unit test at all — `grep -rln allowScopeChoices src/ e2e/` matches only the two source files. The e2e stops at `toBeVisible()` on the buttons.

**WHY IT MATTERS:** The untested surface is the one that hands out capabilities. Every one of these regressions ships green today: swapping `accepted: true`/`false` between "Allow once" and "Continue without"; dropping `scope` from the menu payload so "Always allow …" silently degrades to once-only; emitting `scope: 'project'` from the session choice so a one-session approval is written to project config permanently; or `allowScopeChoices` naming the wrong `target`/`requester` in the label, so the user consents to something other than what is granted. A permission UI whose decision paths have no assertions is the highest-value gap in the branch.

**FIX:** One component test that clicks each of the three controls and asserts the exact payload (`{kind:'confirm',accepted:false}`, `{kind:'confirm',accepted:true}`, `{kind:'confirm',accepted:true,scope:'session'}`, `…scope:'project'`), plus a unit test for `allowScopeChoices` covering the `projectName === null` branch and `ribbonTargetLine` with and without `resource`.

---

### 5. SEVERITY: major — both live regions are inserted together with their content, so neither is reliably announced

**FILE:** `src/renderer/src/features/chat/components/AgentAuthorizationRibbon.tsx:165`, `AgentInteractionComposerPrompt.tsx:65`, `AgentNotificationStack.tsx:242-249`

**WHAT:** `aria-live="polite"` is set on the `<section>` that is itself conditionally mounted, and on the `<output>` that renders only when `notifications.length > 0`. A polite live region has to exist in the accessibility tree *before* its content changes; a region added to the DOM in the same commit as its text is not announced by VoiceOver (the primary macOS target) and is inconsistent on NVDA. Note the branch already gets this right elsewhere by accident: the error paragraph uses `role="alert"` (`AgentAuthorizationRibbon.tsx:203`), which browsers *do* announce on insertion.

**WHY IT MATTERS:** ADR 0023 and `CONTEXT.md` both promise a blocking request "announces itself politely". As written, a screen-reader user gets no announcement at all that the run has stopped and is waiting on them, and no announcement when an error notice arrives — the two moments where silence is most costly. It also means the polite-vs-assertive design decision was never actually exercised.

**WHY THE TESTS DON'T CATCH IT:** `AgentRequestAccessibility.component.test.tsx:96-108` and `AgentNotificationStack.component.test.tsx:168-172` assert the *attribute value*, which is exactly the assertion that stays green when the announcement never happens. The e2e does the same (`access-modes.e2e.test.ts:155`).

**FIX:** Mount one always-present, always-empty announcer — `<p role="status" className="sr-only" />` in `ChatComposerStack` and one in `ChatPanel` — and write the request title / notice message into it when one arrives. Keep the visual `<section>`/`<output>` free of `aria-live` so the content is not double-announced.

---

### 6. SEVERITY: minor — hovering a notice does not pause its dismissal clock

**FILE:** `src/renderer/src/features/chat/components/AgentNotificationStack.tsx:88-146` and `:247-248`

**WHAT:** `expanded` (hover) only changes layout. The clock pauses on window blur but not on hover.

**WHY IT MATTERS:** The stated principle is "a notice cannot expire unwatched", and hovering is the strongest possible signal of being watched. A warning read at 4.6s vanishes under the pointer as the user reaches for Dismiss, and there is no history for it in the stack. Every comparable implementation (including the `ui/toast.tsx` the file cites) pauses on hover.

**FIX:** Lift the hover state into a `paused` prop on `NotificationDismissClock` and fold it into the existing `sync()` predicate — the pause/resume machinery is already there.

---

### 7. SEVERITY: minor — overflowed notices are pointer-only

**FILE:** `src/renderer/src/features/chat/components/AgentNotificationStack.tsx:247-248`, `:266-270`

**WHAT:** The stack expands on `onMouseEnter`/`onMouseLeave` only, and "N more behind" is inert text. There is no keyboard or touch route to expand, and no accessible name tying the count to a control.

**WHY IT MATTERS:** With four or more notices — realistic, since Ponytail-style extensions notify per `session_start` — a keyboard-only user can see that notices exist and cannot reach them except by dismissing the front three one at a time. Errors are precisely the ones that persist, so they are precisely the ones that queue up.

**FIX:** Make the count a `<button aria-expanded={expanded}>{hiddenCount} more behind</button>` that toggles `expanded`, and add `onFocus`/`onBlur` alongside the existing mouse handlers.

---

### 8. SEVERITY: minor — the guard against leaked internal identifiers scans almost nothing

**FILE:** `scripts/__tests__/renderer-visible-identifiers.unit.test.ts:25-30`

**WHAT:** `RENDERER_UI_DIRECTORIES` is two directories, read with a non-recursive `readdirSync` filtered to `.tsx`. So it does not see: any subdirectory (`features/chat/components/**`), any `.ts` file that produces user-facing strings (`agent-authorization.ts`, `shortcuts.ts`, `agent-authorization-ribbon-model.ts`, `notification-stack-model.ts`), or any other feature — including `features/settings`, which is where this branch's own new UI lives.

**WHY IT MATTERS:** The guard is presented as enforcing invariant 4 repo-wide, and it cannot. Concrete proof from this very branch: the "Pi" leak it had to fix in `src/shared/types/shortcuts.ts:100` ("Show or hide the Pi session tree") is invisible to the guard, and `src/renderer/src/features/settings/.../ConnectionsSection.tsx:79,97,106,120` still renders "Loading Pi providers…", "Pi did not report any API-key providers.", "Connect with Pi OAuth" to users today. (Those strings are pre-existing, not introduced here — the defect is that a green guard now implies they don't exist.)

**FIX:** Walk recursively (`readdirSync(dir, { recursive: true })`), include `.ts`, and add `src/renderer/src/features/settings`, `src/renderer/src/shared/ui`, and `src/shared/types` to the directory list. Expect it to go red; that is the point.

---

### 9. SEVERITY: minor — a failed revoke is silent

**FILE:** `src/renderer/src/features/settings/components/sections/AgentAccessSection.tsx:106-122`

**WHAT:** `handleRevoke` catches into `logger.warn` and nothing else. `onRevoked` is not called, so the list is not reloaded and the row stays.

**WHY IT MATTERS:** Revoking is a security action. On failure the user sees the spinner end, the row still listed, and no explanation — indistinguishable from "the click didn't register", and the natural response is to assume it worked and move on. The composer's equivalent action does surface failures via `showToast` (`session-authorization-mode-action.ts:20-22`); Settings does not, for the mode selects either (`:205`, `:223`).

**FIX:** Local `error` state rendered next to the row (mirroring the ribbon's `role="alert"` paragraph), or route these three catch blocks through the same toast the composer uses.

---

### 10. SEVERITY: minor — saved approvals can be painted under the wrong project

**FILE:** `src/renderer/src/features/settings/components/sections/AgentAccessSection.tsx:60-85`

**WHAT:** `useProjectAuthorizationGrants` has no cancellation flag, unlike its sibling `useProjectAuthorizationDefault` (`:26-58`), which does it correctly. A slow `listAuthorizationGrants(A)` resolving after the user switched to project B calls `setGrants` with A's grants.

**WHY IT MATTERS:** The card is headed "Saved approvals" for the current project and each row offers Revoke bound to `projectPath` (B). A stale paint invites revoking a grant that is listed but does not belong to the project shown — a wrong-target destructive action on a permissions list.

**FIX:** Copy the `let cancelled = false` / cleanup pattern from the hook directly above it.

---

### 11. SEVERITY: minor — the composer's inherited mode goes stale

**FILE:** `src/renderer/src/features/chat/components/SessionAuthorizationModeMenu.tsx:24-50`

**WHAT:** `useProjectDefault` fetches the project override once per `projectPath`. The global default is read live from the store, but a change to the *project* default in Settings does not invalidate it, so `effective` (`:96`) keeps reporting the old mode until the component remounts.

**WHY IT MATTERS:** ADR 0023's central decision is that the mode is a live override chain resolved at request time, and this control's own comment says showing anything other than the mode in force "would hide which mode is in force, which is the one thing this control exists to say". Change a project to Ask for Approval in Settings, return to an inheriting session, and the composer still reads YOLO while the run will ask. The run behaves correctly; the label lies.

**FIX:** Key the fetch on a store-level revision that `setProjectPreferences` bumps, or move it to a TanStack query invalidated by the project-preferences mutation (the repo already uses TanStack Query for this class of read).

---

### 12. SEVERITY: minor — a working prompt is captioned "Waiting for a renderer"

**FILE:** `src/renderer/src/features/extensions/components/ExtensionAgentLoopFallback.tsx:78-82`, used at `:152`

**WHAT:** `interactionStateLabel('pending')` returns "Waiting for a renderer" and is used by both branches: the *unavailable custom* card (correct) and the *standard primitive* fallback (wrong), which renders enabled action buttons immediately above that caption.

**WHY IT MATTERS:** The standard fallback exists specifically so the interaction is answerable. Telling the user it is waiting for a renderer, directly under the buttons that answer it, reads as "these buttons are broken" and invites them to wait instead of act. `ExtensionAgentLoopSurface.component.test.tsx:181` only asserts the string for the custom card, so the misuse is unguarded.

**FIX:** Pass the caption in, or split the helper: "Waiting for a renderer" for the custom-unavailable card, "Waiting for you" at `:152`.

---

### 13. SEVERITY: minor — the interaction title is now rendered twice, and a test pins the duplication

**FILE:** `src/renderer/src/features/extensions/lib/extension-agent-loop-surface-model.ts:177`; test at `ExtensionAgentLoopSurface.component.test.tsx:147`

**WHAT:** `surfaceLabel` for the `interaction` surface changed from `Interaction · <customType>` to `value.interaction.title` — the same string the fallback card already renders as its `<h4>` (`ExtensionAgentLoopFallback.tsx:134`). The test now asserts `expect(screen.getAllByText('Select an issue')).toHaveLength(2)`.

**WHY IT MATTERS:** Two consequences. Visually, the container label and the card heading say the same words one above the other. In test terms, `toHaveLength(2)` asserts an implementation artefact: de-duplicating the heading — an improvement — turns the test red, and the assertion tells a future reader that the duplication is required. Removing the raw `customType` was right; reusing the title for the container label was not the only way to do it.

**FIX:** Return a distinct container label (`'Interaction'`, matching the neighbouring `'Transcript summary'` and `'Run status'` cases) and assert the heading via `getByRole('heading', { name: 'Select an issue' })`.

---

### 14. SEVERITY: minor — "binds no key to a grant action" tests naming, not behaviour

**FILE:** `src/renderer/src/features/chat/components/__tests__/AgentRequestAccessibility.component.test.tsx:113-127`

**WHAT:** The test greps `SHORTCUT_COMMANDS` for `/allow|grant|approve|authorize/i` and expects `[]`. The sibling test asserts `DEFAULT_SHORTCUT_BINDINGS['request.focus']` equals a literal that lives ten lines away in the same module.

**WHY IT MATTERS:** The invariant is "no keystroke can grant a capability". A command named `request.accept`, `request.confirm` or `ribbon.primary` satisfies this test while violating the invariant outright. It reads as a strong safety guard and is a spelling check.

**FIX:** Assert the property that matters: that no entry in the `hotkeys` array built in `useWorkspaceLifecycle.ts:78-118` resolves to a callback that submits an interaction response — or, more cheaply, that `focusPendingRequest` is the only callback registered for any command matching `/^request\./`, together with the existing test that `focusPendingRequest` leaves `onRespond` uncalled.

---

### 15. SEVERITY: minor — the whole short-label mechanism is unverifiable where it runs

**FILE:** `src/renderer/src/features/chat/components/SessionAuthorizationModeMenu.tsx:104-149`; tests at `SessionAuthorizationModeMenu.component.test.tsx:26-60`; e2e at `access-modes.e2e.test.ts:79-96`

**WHAT:** The design relies on Chromium repainting `<option>` text between `mousedown`/`focus` and the platform select popup opening. The component test asserts DOM option text after `fireEvent.mouseDown`; the e2e asserts `toBeAttached()` after `select.focus()`. Neither can observe what the native popup actually renders, since Chromium draws it outside the DOM.

**WHY IT MATTERS:** There is a real ambiguity if the repaint loses the race: while inheriting `yolo`, the inherit option reads `"YOLO"` and the yolo option reads `"YOLO (Full access)"`, so a popup painted pre-update shows **"YOLO" twice** with no way to tell inherit from override. The tests cannot see this and will report success either way. Fixing defect 1 removes the mechanism and this risk together.

**FIX:** Ship defect 1's fix (one label set, no `choosing` state). If the short labels are kept for some reason, the claim needs a real-app check via `pnpm dev:debug`, not a jsdom assertion.

---

## Categories with nothing to report

- **Composer draft continuity (invariant 1).** No defect found. Structurally additive, tested at unit and e2e level.
- **Notification placement and lifetime rules (invariant 3).** Placement, severity ordering, focus-aware clock and the info/warning/error durability split are all correct; my findings 5–7 are about announcement and reachability, not the rules themselves.
- **"Use default" really clears the override (invariant 5, second half).** Both controls pass `null` end to end — `SessionAuthorizationModeMenu.tsx:113-121` → `chat-store-actions.ts:117-131`, which correctly *deletes* the field from the optimistic copy rather than storing a mode, and `AgentAccessSection.tsx:213-227` → `setProjectPreferences(path, { authorizationMode: null })`. Both are covered by tests that would fail if `null` were dropped.
- **Non-retroactive revocation wording (invariant 6).** Present and tested.
- **Internal identifiers in visible text (invariant 4), in the surfaces this branch touched.** The removals in `AgentInteractionCard.tsx`, `ExtensionAgentLoopFallback.tsx` and `extension-agent-loop-surface-model.ts` are real; no interaction id, session id, `pi-tui-custom`, kind discriminant or raw JSON reaches a label in the files under review. My finding 8 is about the guard's reach, not about a live leak in the new code.

I did not review the main process, IPC, config persistence, or migrations; that is reviewer A's scope. Two renderer-adjacent things I noticed but did not treat as defects: `ribbonEyebrow` (`agent-authorization-ribbon-model.ts:39-44`) has an `authorization` branch that is unreachable because authorization requests take the other component path — dead code, not a bug; and `AgentAccessSection.tsx` hardcodes 16 hex colours (`#e7e9ee`, `#9098a8`, `#111418`, `#1e2229`) instead of the semantic roles the chat UI uses. The second matches its neighbour `GeneralSection.tsx` and only one Colour scheme ships today, so it has no user-visible consequence yet; it does put the new section outside the Design token contract, and worth cleaning while the file is new.

## VERDICT

**Request changes — do not merge as is.**

The architecture is right and the hard parts are done well: the override chain is resolved live, notifications are structurally prevented from docking to the composer, the durability rule is shared rather than duplicated, and the composer-continuity guarantee is real and tested in a real Electron window. That is the expensive part and it holds.

What blocks merge is smaller than that and concentrated:

1. **Defect 4** — the decision path that hands out capabilities has no test asserting any payload. For a permissions feature that is not a gap I can wave through; a swapped boolean or a dropped `scope` is invisible to the entire suite.
2. **Defect 2 and 3** — the keyboard route to a decision is broken at both ends: answering dumps focus to `<body>`, and the standing-approval menu cannot be dismissed and is left open and armed by the very key that returns the caret. Both contradict explicit ADR promises, and the second undercuts the stated reason the menu exists.
3. **Defect 1** — the composer label is not the agreed term, and the branch's own CONTEXT.md rules out the word used.

Defect 5 I would accept as a fast follow-up if the announcer landed in the same release; the others are small, local changes. Defects 6–15 are all fine as follow-ups.
