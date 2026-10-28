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
- A reader who left pinned to the bottom returns pinned to the bottom. A reader who left a held turn that had overflowed returns to its sent message, at the offset it was held at.
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

**Sending holds the new turn near the top until it reaches the bottom of the viewport.** On every send the user's message settles near the top of the viewport with reserved space below, and the reply streams into that space. The message's bottom sits no lower than `max(viewport / 3, 240px)`, so a message taller than that limit minus the 24px preferred top is held partly scrolled off, and its reply stays in view. Starting a tool call does not release the hold. What happens when the turn's content crosses the bottom of the viewport depends on the turn:

- A turn that is doing work at that moment (tool calls, a Waggle turn) is followed from there. The view moves only by the overshoot of the commit that crossed the bottom, toward newer content.
- A plain answer stays held and continues below the fold, and the scroll-to-bottom button shows that output is still arriving. If work starts after it crossed, it stays held: following then would throw a reader mid-answer to the end. Only a turn that fits again and crosses again while working is followed.

Scrolling up at any point stops auto-scroll, and a reader who scrolled away is never pulled back. Scrolling down to the live end follows again. A reader who scrolls inside the turn keeps the reserved space, which tracks the turn's height, so the end of the transcript does not move under them. While the space remains, the end of it is the held turn, and returning there holds the turn again rather than following. The space goes away only with the turn's message itself (a refused send, or compaction). While a turn is held, the window is bounded like a follower's, so the reply mounts under the message instead of being capped. A settling fold under a held turn collapses the way it does for a follower. When the optimistic message is replaced by its persisted copy under a new id (at the end of the run), the hold moves to the copy. The copy is found by position, as the user row right after the row that precedes the message (tracked while the message is mounted, since a finished run's refresh can re-key that row), never as the latest user row. Taking the latest user row picked a steer delivered during the run, or the previous turn's message once a refused or queued send withdrew its row. A steer or Follow-up after the message stays inside the held turn, and work is judged over the whole turn. Re-placing the hold on a steer pinned the steer while the running output grew above it, out of view. The same applies to a Follow-up after a plain answer that spilled below the fold: it continues below the fold without being followed until the reader scrolls down. A send anchors its own optimistic message, not merely the latest user row. The chat panel records the latest user message when the send begins (`PendingSend`), and the viewport holds the first optimistic message after it. The send can commit before its optimistic row does, a new Session's view can mount with the row already present, the previous turn's message can be persisted in between, and reconciliation keeps optimistic ids on persisted messages. A pending send is kept per Session outside React state, and a draft's first send moves to the Session it creates: the chat panel remounts for the new Session's route. That Session's view remounts again once its branch is known, so the send stays pending until a view with a known branch has held it. Leaving the Session ends it. A send from a capped window first shows the newest rows, then anchors on the next commit.

This follows the Codex desktop app's agent thread (`ChatGPT.app` 26.924, `local-conversation-thread-*.js`):

- A send places a response spacer and enters a `static` follow mode.
- When work starts (`prework`), it moves to `prework_watch`.
- If the turn's content crosses the viewport bottom while the spacer remains, it switches to `prework_follow`, which clears the spacer and follows.
- A turn without prework stays `static`.

There are two deliberate differences. Codex classifies text before tools as `commentary`, which counts as prework, and returns a turn that never overflowed to `static` for its final answer. Pi has no commentary/final split, so here a turn with an early tool call and a long final answer is followed, and text before a later tool call is held like a plain answer.

T3 Code anchors only a thread's first message and follows once the turn overflows, whatever it contains. Anchoring every send and holding plain answers are further deliberate differences.

An earlier version released the hold as soon as a tool call started, while the turn was still short. That dropped the reserved space in one commit, the browser clamped the scroll position, and the sent message jumped down the screen mid-reply.

## Consequences

The window and every scroll rule live in one controller (`transcript-viewport-controller.ts`), with the held sent turn's policy in `SentTurnHold` (`transcript-sent-turn.ts`). Both read layout through a small geometry interface, so the rules are unit-tested without a browser. The content column is at least as tall as the viewport; the geometry measures content as the rows above the end space, never that slack, or a held turn near the top of a short Session looked taller than it was and the browser clamped it down the screen. The React side (`TranscriptViewport`, `useTranscriptWindowRange`, `useTranscriptCommitLayout`, `useTurnSettlePresentation`) re-applies the controller before paint after every commit and resize. The controller's mode is mirrored on the scroller as `data-transcript-mode` for tests and diagnosis.

Row keys are unique per transcript (`chatRowKeys`); a repeated key is suffixed by occurrence, because an unreachable duplicate would break both the window and the anchor.

A browser clamp is not a reader. Shrinking content makes the browser clamp `scrollTop` to the end, which fires a scroll event. Resting exactly at the end therefore always rejoins it: the live end, or a held turn when its reserved space ends there. Only an upward move inside the near-bottom band keeps a reader detached.

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

## Amendment: the bound covers transferred rows too (v1 performance, October 2026)

The window bounded the rows that mount, but every read still moved the whole branch: the Session tree carried every node's message and raw JSON, the workspace carried that tree plus the transcript path again, and a Session open read the tree three or four times. A 12-message Session moved about 720 KB per open; an 80-message Session with long answers moved 13 MB.

- The tree the desktop window reads carries structure and a 160-character `preview` per node, never content (`SessionTreeNode`). Only agent-loop audit nodes keep their content, because their cards hang off the path. The tree filter matches the full text on the Host (`sessions:search-tree`): each node's own content and metadata JSON plus its transcript search text, so tool arguments, tool output, model ids and labels match as they did when the window filtered full nodes.
- A workspace read returns the newest window of the selected path (at least 200 entries, `transcriptWindow { startIndex, pathLength }`), always a suffix ending at the selected node. Reaching the top of the loaded rows reads the next page from the Host; a saved reading position older than the loaded rows reads a window that reaches its node (`includeNodeId`), so the anchor rules above are unchanged.
- Entries the window already holds come back without content while the Session's node mutation revision is unchanged (`cached`, `contentOmitted`), and a Session detail read with a cursor returns only the messages appended after the caller's (`messagesDelta`). The revision is read before the nodes it labels, so held content is never newer than its label.

This ships with Local Session revision 29. Measured on hidden packaged-style builds: a 12-message open 720 KB → 77 KB, the 80-message open 13.2 MB → 0.40 MB (first open 15.4 → 2.5 MB).

### The detail is bounded too, and an open reads each part once

The paged workspace did not make a long Session open faster. On the generated medium profile (a 3,600-message Session) the integrated build took 976 ms from the click to the last message, against 434 ms on beta.27. The transcript waits for both the workspace and the Session detail. The detail still carried every message of the active path, 11.4 MB, so a single read took 450–640 ms: the Host split it into base64 frames, the main process parsed it, and the renderer cloned it. One open also read the detail twice, the workspace three times and the tree once more.

- A detail read can be bounded: `SessionDetailCursor.maxMessages` returns at most that many of the newest messages, and `messagesWindow { startIndex, pathLength }` says where they start (same shape as `transcriptWindow`). The cursor's `messageCount` counts the path's messages through the caller's last one, so the delta rules above are unchanged. More appended messages than the bound come back as the newest window instead of a delta. The desktop window holds the newest 400 messages per Session (`SESSION_DETAIL_MESSAGE_WINDOW`), above the workspace's first page of 200 entries so every message the transcript shows at first is held. Older history comes from the workspace pages. Where the detail stood in for the whole history, the code now reads `messagesWindow.pathLength` (the sidebar message count) and the loaded workspace path (persisted Waggle attribution).
- Detail reads of one Session never overlap. A read asked for while one is in flight runs after it, with the cursor it leaves, and every call asked for in the meantime shares that read.
- Opening a Session writes its read receipt. The Host used to publish that as an ordinary `session-list-changed`, and every window then read the open Session's detail and workspace again. Commands that change only a Session's catalog entry (a pin, a read receipt) now publish `catalogOnly: true`: windows refresh the entry and nothing else, and semantic discovery is not woken.
- The detail read that opens an uncached Session no longer refreshes the tree after it lands, because the view reads the workspace, which carries the tree. A tree read waits 100 ms (`SESSION_TREE_READ_GRACE_MS`) and is skipped when a workspace read starts in that time. The route shows a workspace that is already shown or being read without reading it again (`showSessionWorkspace`). Refreshes after a change still read.
- Indexing a historical Session's resources (`sessions:resources:backfill`) used to start with the open. Each slice reads the Session's history on the Host. It now starts once the renderer is idle after the transcript has painted, and each slice waits for an idle period.

One open now moves one bounded detail (1.3 MB) and one workspace (2.4 MB) instead of two 11.4 MB details, three workspaces and a tree. Measured on packaged builds with `pnpm perf:session-open` (medium profile, 10 interleaved opens per build, same machine):

| Build | Click → last message (median) | IPC bytes per open |
| --- | --- | --- |
| beta.27 | 438 ms | 166.6 MB |
| integrated, before this change | 694 ms | 30.7 MB |
| this change | 340 ms | 3.8 MB |

The harness's median includes Playwright's click and the app's boot work. Opened 1.5 s after launch instead, the first open takes about 200 ms (beta.27 430 ms), and opening it again after another Session about 150 ms (beta.27 310 ms).
