---
status: accepted
---

# Parents show their running Workers

Date: 2026-11-09

Supersedes in part: [ADR 0059](0059-the-hive-groups-workers-by-who-acts-next.md), its rule that only Needs you reaches the person outside the Hive panel. Amends: [ADR 0062](0062-the-session-host-decides-desktop-notifications.md), when Ready to read fires for a root Session.

A Queen that delegates and ends her turn looks idle everywhere: her sidebar row has no glyph, her header says only `Queen`, and the rail dot lights only for Needs you. The person could not tell whether the Hive was still running or had finished without opening the Hive panel. Ready to read fired when her own Run ended, so the person was told to read a Session that was only waiting for its Workers, and again after each Worker result the Host woke her for. The decision, made with the maintainer, is to let every parent Session show whether anything below it is still running, as plainly as a Session shows its own Run.

## Decision

- **Running Workers are Runs, not Delegations.** A parent's **Running Workers** are the Workers below it, at any depth and pinned or not, with an active or connecting Run. A Worker whose Delegation is `working` but has no Run is not running, and queued Follow-ups count only once their Run starts. User-facing text says "running", never "working", which names the Next actor group.
- **Every parent, not only the Queen.** A Worker that spawned Workers gets the same treatment for the Workers below it, so the rule holds when a Worker becomes a root later.
- **The row says Working, then Done.** A parent's sidebar row shows the ordinary `Working` state and spinner while it or any Worker below it runs, and **Done below** (the ordinary `Done`) once the last Run there ended after the person last visited that Session. Visiting the Session clears it; visiting a Worker does not. A failed last Worker Run still reads as Done on the parent, because that Worker reaches the person through Needs you or waits for its parent. A parent whose own Run failed keeps its own state.
- **Counts follow the rows.** The sidebar's filter chips and project pips count rows by the state each row shows. A collapsed project's pip counts its visible rows, so a parent whose Workers run counts once as Working and its hidden Workers add nothing. A status filter lists Workers flat (ADR 0051), so the Working chip counts the parent and each running Worker, exactly the rows its filtered list shows. The parent's own attention states win over Running Workers: a parent that needs input, failed or was interrupted shows that, and only its header and rail dot say its Workers run.
- **The open Session says why.** The header's identity line reads `Queen · n Workers running` (or `Worker · n Workers running`) while any run, and clicking it opens the Hive panel. The Hive rail dot shows running in the rail's running colour; Needs you still wins. Neither takes the attention colour, and the header offers no stop control.
- **The Host counts.** Each parent's Session summary carries its running-Worker count and when the last Run below it ended, computed by the Session Host over the whole subtree. A Run start or settlement on any Worker publishes a list change for every ancestor. The renderer never sums the statuses it happens to have loaded, so a Worker on an unloaded page still counts.
- **Ready to read waits for the work.** For a message the person sent while nothing below the root Session ran, Ready to read fires once, when the Hive is settled: the root is not running, no Worker below it runs, and no Hive wake is coming for any Session in it. That moment is the root's last Run (often a wake) completing, or the last Worker Run settling when no wake follows. For a message sent while Workers were already running, its reply notifies when that Run completes, and the original request still notifies later. A Hive wake Run is never such a question. The held notification lives in Host memory (`ready-to-read-after-workers.ts`). Needs you and Failed or interrupted never wait. A root Run the person stopped, or one whose failure notifies them, drops the held one; a Run an agent started or stopped does not. A Hive wake takes its origin from the Run it acts for, so a wake for a failures-only Scheduled task stays silent. A wake that is expected but has not started 30 seconds after the rest of the Hive settled is treated as not coming, unless it is an agent-made Session's wake and Active Workers is full. That limit counts agents' work only and never defers a wake of the person's own Session (ADR 0030 amendments), so their Queen's notification never waits on other Hives.

## Considered Options

- **A per-Worker dot strip on the Queen's row.** It answered what each Worker was doing, which the Hive panel already answers, and it stopped fitting at about five Workers.
- **Count by Delegation state.** A Worker whose Run ended without submitting would keep its parent spinning forever.
- **Count in the renderer.** The sidebar pages Sessions, so an unloaded Worker would let its parent read Done while it still ran.
- **Queen only.** Simpler, but a parent Worker would look idle while its own Workers ran, and the rule would need rewriting once a Worker can become a root.
- **Notify on every root Run.** A delegating Queen notified the person before any work was done and once per Worker result after that.

## Consequences

Every Run transition on a Worker now writes a list change for each of its ancestors. Hive depth has no product limit, so the cost grows with depth, not with the number of Workers. A Queen's Ready to read can arrive hours after her last reply, and a reply she wrote between Worker results does not notify unless the person asked for it. A Host restart forgets a held Ready to read; a wake that completes afterwards with nothing running still notifies.
