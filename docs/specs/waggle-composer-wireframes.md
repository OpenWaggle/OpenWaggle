# Waggle Composer Wireframes

> Historical design exploration. These wireframes are not the current composer contract. Current composer behavior is governed by the implemented React components and the active user guide.

_Status: draft_
_Date: 2026-04-22_
_Purpose: low-fidelity visual exploration for branch-scoped Waggle mode in the Pi-native session/tree model._

## Locked assumptions

These wireframes assume the following decisions are already locked:

- Waggle is branch-scoped
- Child branches inherit Waggle config by default
- Waggle can be toggled on/off without changing session/tree model
- Waggle v1 is two-agent only
- Waggle v1 is sequential only
- Waggle config is edited through a simple visible composer control, not `/`
- Once a Waggle run starts, config is locked until completion/stop
- If Waggle is enabled on a branch but idle, the composer still shows persistent visible Waggle state/control
- Waiting-for-user is a first-class runtime state
- Replying while waiting-for-user resumes the same Waggle run unless the user turns Waggle off first

---

# 1. Standard branch composer

## Intent
Baseline. No Waggle enabled on this branch.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ model picker ]                                            [ context 86% ] │
│                                                                              │
│  Ask OpenWaggle…                                                             │
│                                                                              │
│                                           [ attachments ] [ tools ] [ send ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Notes
- Composer reflects branch state
- No Waggle affordance shown as active here
- This is the control state a branch returns to when future mode is Standard

---

# 2. Waggle-enabled branch composer — idle

## Intent
This branch is set to Waggle mode for future sends, but no Waggle run is currently active.

## Option A — inline chip in top utility row

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ model picker ] [ Waggle: Pair Review · 6 turns ▾ ]       [ context 86% ] │
│                                                                              │
│  Ask OpenWaggle…                                                             │
│                                                                              │
│                                           [ attachments ] [ tools ] [ send ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Option B — dedicated mode chip near send controls

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ model picker ]                                            [ context 86% ] │
│                                                                              │
│  Ask OpenWaggle…                                                             │
│                                                                              │
│  [ Waggle · Pair Review · 6 turns ▾ ]         [ attachments ] [ tools ] [ send ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Notes
- Chip is always visible while branch mode is Waggle
- Chip opens branch-scoped Waggle config
- Config is editable because no run is active yet
- This UI should make it obvious that the current branch is in Waggle mode before send

---

# 3. Waggle config popover / inline editor

## Intent
Minimal v1 editor for branch-scoped Waggle configuration.

```text
                ┌──────────────────────────────────────┐
                │ Waggle for this branch               │
                │                                      │
                │ Preset: [ Pair Review            ▾ ] │
                │ Max turns: [ 6 ]                    │
                │                                      │
                │ Agent A: GPT-5 · Reviewer           │
                │ Agent B: Claude Sonnet · Builder    │
                │                                      │
                │ [ Turn off Waggle ]   [ Done ]      │
                └──────────────────────────────────────┘
```

## Notes
- Keep v1 narrow: preset + max turns + read-only summary of agents if preset-backed
- Can expand later to richer custom team editing
- This edits the current branch only
- No effect on other branches

---

# 4. Waggle-running composer — config locked

## Intent
Waggle run is currently active on this branch.

## Option A — chip shows locked/running state

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ model picker ] [ Waggle running · Pair Review · 6 turns 🔒 ] [ context ] │
│                                                                              │
│  Waggle is working…                                                          │
│                                                                              │
│                                [ stop ]                         [ disabled ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Option B — user can still type, but config remains locked

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ model picker ] [ Waggle running · Pair Review · 6 turns 🔒 ] [ context ] │
│                                                                              │
│  Message…                                                                    │
│                                                                              │
│                                           [ attachments ] [ stop ] [ send ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Notes
- Main question here is whether the composer is disabled while a Waggle turn sequence is in progress, or remains interactive
- Independent of that, config must remain locked during the active run
- Stop is distinct from turning Waggle off for future turns

---

# 5. Waggle waiting-for-user composer

## Intent
Waggle has paused explicitly because it needs user input.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ model picker ] [ Waggle paused · waiting for your input 🔒 ]  [ context ] │
│                                                                              │
│  Answer to continue this Waggle run…                                         │
│                                                                              │
│                                           [ attachments ] [ stop ] [ send ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Notes
- Composer should feel normal and usable
- User message is rendered in the normal transcript chronology after send
- Sending resumes the same Waggle run
- Config remains locked because this is still the same active run

---

# 6. Waggle finished composer — config unlocked again

## Intent
A Waggle run ended; the branch remains in Waggle mode for future sends unless user turns it off.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ model picker ] [ Waggle: Pair Review · 6 turns ▾ ]       [ context 71% ] │
│                                                                              │
│  Continue with Waggle on this branch…                                        │
│                                                                              │
│                                           [ attachments ] [ tools ] [ send ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Notes
- Returns to idle Waggle state
- Config editable again
- Branch still remembers Waggle for future runs unless user changes it

---

# 7. Minimal transcript/header relationship

## Intent
Show how composer state and transcript state may align visually without overdesigning yet.

```text
Header:   Session name  /  Branch name                     [ branch sidebar toggle ]

Transcript:
  User
  Agent A turn
  Agent B turn
  Agent A turn
  Waiting-for-user marker

Composer:
  [ Waggle paused · waiting for your input 🔒 ]
```

## Notes
- Header carries session/branch identity
- Transcript carries turn-by-turn attribution
- Composer carries current branch future-mode / active-run state
- These three surfaces must stay semantically aligned

---

# 8. Visual questions to decide from these wireframes

## Structural
1. Where should the Waggle chip live when idle?
   - top utility row
   - bottom control row near send
2. Should the composer be disabled during an active Waggle run?
3. How much of the agent pairing should be visible in the idle chip?
4. Is preset-first enough for v1, or must users edit both agents inline in the popover?

## State clarity
5. What exact text should distinguish:
   - enabled but idle
   - running
   - waiting-for-user
   - finished/unlocked
6. Should the lock icon appear only while running/waiting, or always when non-editable?

## Density
7. Should the chip stay a single line always?
8. Can max turns be shown compactly enough without clutter?

---

# 9. Recommended next visual decisions

After reviewing these wireframes, decide next:

1. chip placement: top row vs bottom row
2. whether composer remains interactive while Waggle is actively running
3. how much config summary the idle chip should show
4. whether v1 config is preset-first only or also supports direct team editing in the popover
