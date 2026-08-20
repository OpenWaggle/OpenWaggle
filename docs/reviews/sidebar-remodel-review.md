# Independent review of the sidebar remodel

Three reviewers ran against `feat/pinned-sessions` in separate `pi` sessions on Bedrock (`eu.anthropic.claude-opus-5`), each given a read-only brief and no knowledge of the others:

- **docs** — check every factual claim in the documentation against the implementation
- **impl** — check the implementation against ADR 0020, ADR 0021 and the approved prototype CSS, and hunt for correctness and performance defects
- **a11y** — compute real contrast ratios, check keyboard operability, and judge whether the new tests would fail if the behaviour regressed

They produced roughly thirty findings. This records what was fixed and what was accepted, with the reason.

## Fixed: correctness

**A Pinned badge and its shortcut could disagree.** Found independently by two reviewers. Badges were indexed over the *rendered* rows while `Mod+1..9` resolved over the *unfiltered* list, so with a state chip or a text query active, `⌘2` opened a session other than the one wearing the `⌘2` badge. A `position` is now assigned over the whole section before filtering, and the badge reads it. Three unit tests cover the numbering, including the filtered case.

**Two tier tables disagreed about `waggle-running`.** `useSessionRowStatus` had its own tier resolver that treated a Waggle run as quiet, while `ROW_STATE_META` treated it as in flight. So a Waggle row never receded and never showed its phase, which defeats the point of storing the phase at all, while the project heading counted it as in flight. One session, described two ways. The duplicate resolver is deleted; `sidebar-row-state` is the single authority for tier, label and colour.

**An empty branch name was announced as "On branch " with nothing after it.** The builder guarded on `!== null` while only the hook trimmed. Now guarded on content in both places.

## Fixed: accessibility

**Contrast was measured against the wrong background.** ADR 0021 measured every role against the resting row, `#1a1d22`. A row is also hovered (`#262b33`) and selected (`#2b313a`), and the binding constraint is the lightest. Measured there, two roles failed for text:

| role | resting | hover | selected |
| --- | --- | --- | --- |
| `--color-error` | 4.49 | 3.78 | 3.48 |
| `--color-info` | 4.59 | 3.87 | 3.56 |

`--color-info` now has an AA-safe partner, `--color-info-text: #60a5fa` at 5.15:1 on the worst case, alongside the existing `--color-error-text`. Both roles keep the hue they were chosen for and still clear the 3:1 non-text bar for icons and borders.

**The whole second line failed AA.** It was `--color-text-muted`, which measures 3.33 resting and **2.58 on a selected row**, and every part of the line inherited it: the timestamp, the project label, the shortcut badge. It is now `--color-text-tertiary` at 4.52 on the worst case. This one predates the remodel, but the remodel made it the base of a line on every row, so it counted as ours.

**Chips and pips painted text with the icon role.** Each tints its own background from the same hue, so active chip text measured 3.76:1 (info) and 3.81:1 (error). They now paint text from the label role, which is what it exists for, and the pip tint went from 14% to 18% to hold the border.

**A project's roll-up vanished the moment the pointer arrived**, with no keyboard equivalent, so pointer and keyboard disagreed about what a heading contained. Now swapped on hover *and* focus-within.

**`role="menuitemradio"` had no `role="menu"` ancestor.** Invalid ARIA, and the checked state my own E2E asserts was not reliably announced. `Popover` accepts a `role` and both sort menus declare `menu`.

## Fixed: design parity and tokens

The last raw palette class in the sidebar, `text-amber-400` on an interrupted branch run, drew the same meaning as the row above it in a different hue. It now uses `--color-warning`.

Prototype metrics corrected: the status glyph to 13px, the Pinned grip slot to the same 14px leading slot as every other row so pinned titles align with project titles, the shortcut badge to the prototype's padding, and the project heading's new-session action to a plus rather than a pencil.

## Fixed: documentation

**The docs advertised a Terminal indicator that cannot occur.** Terminals are keyed by project path, and nothing records which session opened one, so the count is always zero. Documenting it broke the exact rule ADR 0020 sets for `Globe`. Removed from the user-facing table, and ADR 0020 now records terminal alongside cloned-from as data the app does not yet have rather than claiming a source that exists.

ADR 0021 also said `--color-review` and `--color-plan` are read through `var()` at runtime; they have no consumer at all, which the same ADR concedes two paragraphs later. Only `--color-neutral` justified `@theme static`. Corrected, and the count of states carrying colour corrected from nine to eight.

Smaller corrections: the state icon leads line one rather than sitting beside the word on line two; dragging to reorder pins only works in Manual sort; the persistence list omitted the Pinned sort and the pins themselves; and `session-git-indicator.ts` cited ADR 0021 for the changed-file-count removal, which ADR 0021 says nothing about.

## Fixed: tests that could not fail

The hover test asserted `group-hover` CSS, and the component config loads no stylesheet, so re-introducing the exact regression its docstring cited would have left it green. It now asserts the structural guarantee that makes the behaviour possible, the timestamp living outside the hover-revealed container, and names the E2E test that owns the visual claim.

Two chip tests duplicated another assertion or re-asserted their own `beforeEach`; removed. The blank-branch test passed `null` rather than `''`, duplicating its neighbour and masking the defect above.

## Accepted, with reasons

**Pre-existing defects outside this work.** Each is real and none is caused by the remodel, so fixing them here would widen a sidebar branch into an app-wide accessibility change with no review of its own:

- `ContextMenu` portals with no focus trap, no `role="menu"`, no arrow keys and no focus restore. It is the only route to mark-as-unread, clone, archive and delete.
- `Button`'s focus ring measures 2.14:1, below the 3:1 non-text bar, for every non-unstyled variant.
- The model-selector search input removes its focus outline with no replacement.
- `--color-text-muted` (3.33), `--color-accent-dim` (4.46) and `--color-thinking-text` (4.28) miss 4.5:1 wherever else they carry text.
- A repeated `completed` status after a visit can flip a seen row back to an unseen "Done".

These belong in their own issue. The token findings are already recorded on issue #148.

**The sidebar is not resizable.** The prototype ships a resize handle with a persisted width. The goal objective puts search and resize out of scope; search was implemented because the maintainer asked for pixel parity and the field is visible in the design, but a resize handle plus a persisted width is a behaviour, not a visual, and it stays out until asked for.

**`format.ts` floors minutes where the prototype rounds**, so 119 minutes reads `1h` here and `2h` there. Accepted: flooring is the more honest reading of elapsed time, and it matches the existing `formatRelativeTime` the rest of the app uses.

**Line heights are hardcoded** (`h-[18.13px]`, `h-4`) rather than derived from the font size. Accepted deliberately: fixed line boxes are what make every row exactly 48px whatever it carries, and intrinsic heights produced 54px and 52px rows in the same list.

**Two tests assert the absence of a cloned-from and a remote indicator** and therefore cannot fail today. Kept as guards: both would fail the moment someone rendered a glyph for a state the product cannot be in, which is the rule ADR 0020 exists to enforce.

**The E2E spec was one long test without `test.step`, and covered no chips.** Both now addressed, though not because the review persuaded me: the maintainer looked at the suite and pointed out that a run showing zero chips proves nothing about them.

`e2e/sidebar-filters.e2e.test.ts` covers the chips, the pips, the search field and Escape in twelve named steps. It is possible because an interrupted run is the one non-idle row state that can be seeded from the database, so a real chip appears without faking a live agent event. The original spec keeps its geometry and restart claims.

## Second round: four reviewers on the whole branch

Run after the branch had merged `origin/main`, with one brief each: correctness, architecture, accessibility, and whether the tests and documentation tell the truth. Same tool and model as the first round.

### Fixed, and each was a live bug

**Escape was cancelled for the whole application.** The sidebar registered Escape through `useHotkeys` with `preventDefault: true`, and `@tanstack/react-hotkeys` calls `preventDefault` and `stopPropagation` on every match *before* the callback runs, so the check for "is the filter field focused" gated nothing. Chromium will not close a native `<dialog>` once a document-level listener has cancelled the key, so `CommitMessageDialog`, whose only dismissal is that native path, stopped closing. Found independently by two reviewers, one of whom ran the library to confirm the ordering. Now routed through the existing `useEscapeHotkey`, enabled only while the field holds focus.

**A saved scroll position retried forever.** `applyPendingRestore` returned "retry" whenever the content had not yet grown to the remembered offset, and `scheduleRestoreRetry` rearmed every 96ms with no cap. A capped transcript window can never reach an offset saved from a taller transcript, so the timer ran for the life of the session, rewriting `scrollTop` and clearing the auto-scroll flag on every pass. Scrolling up was undone within 96ms. The restore now gives up when the reachable extent stops growing, and the regression test leaves a pending timer behind without the fix.

**Reordering pinned sessions had no keyboard route.** Manual order made the row a drag source and offered nothing else. That fails WCAG 2.2 SC 2.1.1 Keyboard and SC 2.5.7 Dragging Movements, and the grip is `aria-hidden`, so a screen reader user had no signal that reordering existed at all. Move up and Move down now sit in the row's context menu, which opens from the keyboard.

**The draft row measured 2.58:1.** Its second line and its "Draft" word both used `--color-text-muted` on `--color-bg-active`. Moved to `--color-text-tertiary` at 4.52:1. `--color-text-muted` clears 4.5:1 against nothing in this palette and should never carry text.

**The transcript window remembered its size, not its start.** Every new row pushed an old one out, so the topmost mounted row unmounted on each arrival and, with `[overflow-anchor:none]` on the scroller, the view jumped under a reader who had scrolled up. It also grew a "Load earlier messages (1 above)" control on a session read from its first message, which is a lie about the transcript.

**The stretched click target made every tooltip in a row unreachable.** A pseudo-element is hit-tested as part of the element that owns it, so pointer events anywhere in the row resolve to the title control, which had no `title` and no ancestor with one. The branch name, which `SessionProvenanceIndicators` states lives in the tooltip, could not be read there. The row now carries one composed description built from the same facts the icons announce.

**Load earlier lost focus and shouted.** The control unmounts on the last press, dropping focus to `document.body`, and inserting 100 rows into a `role="log"` queued an announcement per row. Focus now moves to the top of the transcript and one polite message reports the count.

**The QA seed script had four defects.** `--replace-qa` alone made `Number('--replace-qa')`, so it seeded empty transcripts and reported "NaN messages" while exiting successfully; the cleanup predicate matched `QA session%`, a title the script never writes, so the flag was a no-op; running it twice failed on a duplicate `session_nodes.id`; and it hardcoded macOS paths plus one contributor's project folder.

### Accepted, with reasons

**Two provenance glyphs still render nothing.** `cloned-from` and `terminal` have complete tested render paths gated on data that never arrives. One reviewer argued for deleting them. Kept, because ADR 0020 draws the line at whether the product *has* the capability: a session genuinely is cloned from another and genuinely owns terminals, and nothing records either. The TODOs name the migration.

**The row state rule is written twice**, in `useSessionRowStatus` and `useSidebarRowStates`, so chips and rows agree only because two copies match. A real duplication and a fair hit against the "one authority" claim in `MEMORY.md`. Not fixed here because collapsing them changes what every row subscribes to, which is a refactor with its own regression surface, and this branch is already large. Recorded as a follow-up rather than pretended away.

**`role="menu"` without the keyboard model.** The sort menus announce menu semantics but are plain buttons: no roving tabindex, no arrow keys, no focus move on open. The reviewer is right that this now promises a keyboard model that does not exist. Left as is in this branch and raised as a follow-up, because the honest fix is either to implement the pattern in the shared `Popover` or to change the role, and both reach past the sidebar.

**Dragging a pinned row while a filter is active** resolves neighbours from the visible subset, so a drop can reposition a pin relative to rows the user cannot see. The stored key stays valid. A follow-up.

**`Mod+F` and `Mod+1` to `Mod+9` are invisible to the shortcut conflict check** in settings, so rebinding a command onto one of them produces two handlers and a console warning with nothing in the UI to explain it. A follow-up.

**`Mod+F` is dropped while the sidebar is inert** in the settings view. A follow-up.

**Switching conversation branch does not reset the transcript window**, so an expansion carries across branches of one session. Performance only. Noted in ADR 0022 rather than fixed.

**Turn diff controls on turns older than the window are unreachable** until the reader presses Load earlier. A consequence of windowing worth stating, now in ADR 0022.
