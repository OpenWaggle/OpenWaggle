# A Transcript Opens From Its Newest End

Status: accepted (performance)

A session's transcript renders its newest 40 rows, with a control that reaches further back 100 rows at a time. The window resets to the newest rows whenever the open session changes.

## Context

Switching sessions took over a second. Measured on a 400 message session in the running app:

| | Before | After |
| --- | --- | --- |
| Rows mounted | 401 | 42 |
| DOM nodes in the transcript | 7,202 | 724 |
| Content height in a 580px viewport | 50,216px | ~5,350px |
| First paint, dev build | 749-849ms | 142-173ms |
| Settled, dev build | 1,235-1,313ms | 221-267ms |
| Settled, packaged build | not measured | 35-66ms |

Both figures come from the same instrument, a `MutationObserver` on the transcript, so they compare like with like. An earlier attempt polled `innerText` instead and reported roughly 1,000ms for every switch; that number was the measurement forcing synchronous layout on a 50,000px subtree, not the application. Instruments that touch layout are not usable for measuring layout.

The unbounded read is older than the sidebar remodel. `session-queries.ts` selects a session's nodes with no `LIMIT`, and does so identically at `2bed9ed0`, before that work started.

Pi's own clients both cap the same thing. T3Code loads the last 10 user turns and fetches 20 more per request, sized so that "first paint on the heaviest observed threads stays around 100K gzipped", and virtualises what remains. Codex pages history at 100 items with a 400 item scan limit.

## Decision

Window in the renderer, at 40 rows, expanding by 100.

The component that owns the window is keyed by session id, so a switch remounts it and the window returns to the newest rows. An effect would have reset it one paint too late, after the previous session's larger window had already been built.

## Alternatives rejected

**`content-visibility: auto` on every row.** Tried first, because it is one declaration and needs no state. Measured live by injecting it into the running app: blocking time halved, from 1,140-1,324ms to 620-734ms, and a 600ms task remained. Containment skips layout and paint for offscreen rows but React still mounts all 401 of them, so it cannot fix a mounting cost. Not adopted, and not needed once the window is small.

**A virtualisation dependency.** Would handle an expanded window better than a plain list, but the window is 40 rows and the measured result is already 35-66ms in a packaged build. Adding a dependency for an unmeasured gain is the wrong order of operations. Worth revisiting only if a load-earlier expansion becomes a common path rather than a rare one.

**Paginating the SQL query and the IPC contract.** The obvious symmetry with T3Code and Codex, and still wrong here. SQLite reads 400 local rows in milliseconds; the second was spent in React. Paginating the read would add a contract, a cursor and a class of ordering bug for a gain no measurement showed. The full row set continues to cross IPC.

## Consequences

The scroll hooks keep receiving the **full** row count, not the windowed one. They use it to notice that a conversation grew, and a count pinned at 40 would hide the arrival of a new message and break sticking to the bottom.

Anything that needs to reach an arbitrary message by id must expand the window first. Nothing does today: the only id-addressed element is `data-user-message-id`, which has no reader outside the transcript itself.

A person who wants the start of a long session presses a control instead of scrolling to it. That is the price, and it buys a switch that lands in well under a tenth of a second on a packaged build.
