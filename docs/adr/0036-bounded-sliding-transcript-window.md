# A Bounded Sliding Transcript Window

Status: accepted (supersedes the windowing decision and consequences of ADR 0022)

## Context

ADR 0022 opened a transcript at its newest 40 rows and reached further back with a "Load earlier" control, 100 rows at a time. The window recorded how many leading rows were hidden as a plain count, set once on mount and reset only on a Session switch.

Real-Electron QA on a seeded 400-message Session (September 2026) showed the count is unsafe whenever the row list changes shape within one Session:

- Switching from a 400-message branch to a 60-message branch left exactly one row visible under "Load earlier messages (104 above)". ADR 0022 had accepted branch carry-over as a performance-only consequence; it is a correctness bug.
- A window mounted before history hydrated computed zero hidden rows and then mounted the entire history.
- Pressing "Load earlier" kept `scrollTop` under `[overflow-anchor:none]`, so the row the reader was on moved 16,129px down and the view landed on the oldest newly revealed row.
- The control counted rows (fold rows, status rows), not messages: "427 above" on a 400-message Session.
- Scroll restore saved a pixel offset; after an expansion the same offset landed on a different message.

Production-build measurements bound the cost of mounted rows: streaming stayed within frame budget with 142 rows mounted (p95 frame 9-10ms, no long tasks), while per-token React work grew with mounted rows (about 1,030 to 2,600 re-rendered components per commit from 40 to 140 rows). Making older history load automatically turns expansion into a common path, which ADR 0022 named as the condition for revisiting its approach.

## Decision

**The transcript renders a bounded sliding window of rows identified by row key, never by index count.**

- The window opens at the newest rows and loads older rows automatically as the reader approaches the top, preserving the reader's visual position (the anchored row keeps its on-screen offset across the insertion).
- The window is bounded at roughly 160 mounted rows. When it grows past the bound, rows far below the viewport are unmounted and are restored as the reader scrolls back down.
- The window's identity is its first row's key. When that row no longer exists in the row list, the window resets to the newest rows instead of slicing an unrelated list.
- The top of the window shows a small "Loading earlier messages…" row while older rows load; loading starts about one viewport before the top. The row doubles as a focusable "Load earlier messages" button for keyboard users. Each batch makes one polite announcement counting messages, not rows. There is no "N above" counter.
- The start of a Session shows a quiet "Start of session" marker with its creation date.

**Reading position is restored per Session and branch as an anchor, not a pixel offset.**

- The saved position is the key of the row at the top of the viewport plus its offset within the viewport, stored per (Session, branch).
- Returning rebuilds the window around the anchor, within the bound, and puts the anchored row back at the same offset, including rows deep in older history.
- A reader who left pinned to the bottom returns pinned to the bottom.
- A missing anchor (first visit, compaction replaced the row, branch gone) opens at the newest end.
- Switching branch applies the same rules to the target branch; no window state carries across branches.

No virtualization dependency is adopted. Mutable-instance virtualizers are a known React Compiler hazard in this codebase (see MEMORY.md, `@headless-tree`), and dynamic-height streaming rows with stick-to-bottom are their hardest integration case.

## Related transcript presentation decisions

These ship with the window change because they share its render and scroll boundaries.

**A Session switch is one commit.** Header, transcript area, and composer change to the target Session together. The Welcome screen renders only when no Session is selected or the selected Session is loaded and has no messages; "not loaded yet" never renders it. While a target Session hydrates, the transcript area stays quietly empty; after about 300ms a subtle message-shaped skeleton fades in. The previous Session's transcript is never shown for the target Session.

**Height changes never move the row the reader is looking at.** This refines ADR 0034's presentation without changing what folds.

- Settle fold while pinned to the bottom: the folded work collapses over about 180ms while the terminal answer stays fixed on screen; reduced motion collapses instantly, still anchored.
- Settle fold while the reader is scrolled inside the settling turn: the turn settles expanded, recorded in the existing per-Session fold state, with its fold row available to collapse it.
- Settle fold while the reader is elsewhere: instant, with the reader's anchored row held in place.
- Any manual disclosure (turn fold, tool-call details, thinking, changed-files card): the toggled row stays under the pointer and stick-to-bottom is suspended for that size change, so expanding the last turn while pinned does not throw the reader to the end.

**Sending anchors the new turn, then hands over to live following.** On every send the user's message settles near the top of the viewport with reserved space below, and the reply streams into that space. When the turn outgrows the viewport or tool activity begins, the view switches to following the end. Scrolling up at any point stops auto-scroll. The reserved space never outlives a turn taller than the viewport. T3 Code anchors only a thread's first message; anchoring every send is a deliberate difference.

## Consequences

The window and every scroll rule live in one controller (`transcript-viewport-controller.ts`) that reads layout through a small geometry interface, so the rules are unit-tested without a browser. The React side (`TranscriptViewport`, `useTranscriptWindowRange`, `useTranscriptCommitLayout`, `useTurnSettlePresentation`) re-applies the controller before paint after every commit and resize. The controller's mode is mirrored on the scroller as `data-transcript-mode` for tests and diagnosis.

Row keys are unique per transcript (`chatRowKeys`); a repeated key is suffixed by occurrence, because an unreachable duplicate would break both the window and the anchor.

A browser clamp is not a reader. Shrinking content makes the browser clamp `scrollTop` to the end, which fires a scroll event; resting exactly at the end therefore always rejoins the live end, and only an upward move inside the near-bottom band keeps a reader detached.

The persisted copy of a just-completed turn replaces its optimistic user message under a new id. Fold state is keyed by that id, so the fold survives through an alias derived from the live message list (`turn-fold-aliases.ts`). Row identity still changes across that swap, which remounts the turn's rows once; the anchor recovers because the geometry is unchanged.

Per-token work no longer scales with the mounted rows' content. Unchanged messages, the row render context, and the message-resource index keep their identity across streamed tokens. Measured on a production build with 42 mounted rows while streaming: 527 re-rendered components per commit before, 183 after, and message bubbles and Markdown no longer re-render.

Measured in real Electron (production build) after the change:

| Check | Before | After |
| --- | --- | --- |
| Branch switch 400 → 60 messages | 1 row visible | newest 40 rows |
| Load earlier, reader's row displacement | 16,129px | held (row moves only by the scroll distance) |
| Mounted rows while scrolling to the start of 400 messages | unbounded | ≤160, no long tasks |
| Restore after switching away from deep history | different message | same row, same offset |
| Welcome screen while an unvisited Session loads | painted for ~75ms | never |
| Composer growth by 8 lines, content hidden | 156px | 0px |

Cmd+F finds only mounted rows, as it did under ADR 0022.
