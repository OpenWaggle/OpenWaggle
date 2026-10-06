# Stop the Session Host from the command line

Status: accepted

Date: 2026-09-29

## Context

ADR 0030 makes the Session Host start on demand and exit on its own after an idle grace period. Until now nothing could ask it to exit sooner. People asked for this when replacing an installation, clearing a stuck Host, or checking that nothing runs in the background. The only options were to wait for the idle timer or to kill the process, and killing it marks every active Run `interrupted-by-host-loss`.

The Host already drains itself before an upgrade handoff: it refuses new work, lets active work finish, then exits. That drain refused every command, including the ones that end work. A Run waiting on an approval could then never be answered, so the drain never finished.

## Decision

- **A new command contract.** `local-host-v1` has one operation, `stop`. It needs Local Session protocol revision 19 and the `host:stop-v1` capability. `openwaggle host stop` sends it.
- **Only the local user may stop the Host.** Named access profiles, agent Sessions tools, MCP gateways and the desktop app's own caller are refused with `capability_denied`. (ADR 0047 later adds an update stop, `purpose: 'update'`, with a deadline after which the Host interrupts Runs still active. The desktop app may send only that stop; the CLI sends it as `openwaggle host stop --update`.) The contract is excluded from every agent and MCP tool surface.
- **Stopping is a graceful drain.** The Host refuses new requests at once and exits when its active Runs, running Actions, exports and other owned work end. As in an upgrade drain, a Follow-up already queued behind an active Run still starts when that Run ends: the Run's lease carries it. Pausing queues on stop was tried and rejected, because a paused queue also holds back Follow-ups sent after the next Host starts and settles Worker Delegations on an intermediate result. The stop report tells the user to pause a queue to stop sooner. The response reports the Runs and Actions it waits for. `host stop --wait` polls until that Host exits, or until a different Host instance answers, which means a client already started a new one.
- **A draining Host still accepts commands that end or unblock work.** These are reads, interrupts, answers to questions and approvals, pausing a queue, cancelling an export, a compaction or a Waggle Run, stopping an Action or a Workspace setup, reading an Action's output, the desktop app's read-only requests (the list that may be replayed after a transport failure, less the reads that start MCP servers or load Pi resources: MCP capabilities, context usage, the model catalog, and Agent definition plans), and further stop requests. The desktop app can therefore still load a Session to answer its approval. Waits, including searches that wait for fresh results, are refused: they are reads that can hold the Host open for many minutes. Everything that starts work is refused for that request alone, with the retryable code `host_draining` and a message that says the Host is stopping. Each admitted command holds the Host open until its response has been written. This applies to every drain, so an upgrade handoff can no longer hang on an unanswerable approval either.
- **Queued events are flushed before the listener closes.** A client watching the last Run receives its settlement before the connection ends.
- **The revision window stays at one.** Revision 19 only adds a contract, but the Host still negotiates only its current revision, as it has since revision 17 (ADR 0035). Negotiation carries a single capability tuple. Supporting revision 18 alongside it would need per-revision capabilities, which is a separate change. An older client meets the existing `incompatible_protocol` and `host_upgrade_pending` paths, and an active older Host is never killed. `host stop` against an older Host sends nothing; it reports the pending handoff, and with `--wait` it waits for that handoff.

## Consequences

`openwaggle host stop` gives a supported way to empty the background process without losing Runs. A Host held by a long-running Action or an unanswered approval still waits. The command says so and names what to do: pause the queue, interrupt the Run, or stop the Action. There is no forced stop; killing the process remains the only way to skip the drain, with its documented host-loss outcome. The desktop app starts a new Host the next time it needs one.
