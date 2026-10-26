---
status: accepted
---

# The Hive groups Workers by who acts next

Date: 2026-10-26

Supersedes in part: [ADR 0051](0051-workers-live-in-a-hive-panel-not-the-sidebar.md), its grouping by Delegation state ("Needs you, Review, Active, Done") and the state names of its two amendments (#356, #377). The panel, the tree, paging, the row menu and everything else in ADR 0051 stand.

The Hive panel grouped Workers by Delegation state, and its "Needs you" (later "Needs attention") group held `revision_requested`, where the Worker is revising for its parent, and `needs_attention`, which the Host sets when a Worker Run fails and which is aimed at the parent agent. It stayed set after the Worker resumed. A Worker really blocked on the person, with a parked approval or question, was not in the group at all, and the sidebar, rail dot and Session Summary used the same rule. The person was told to act on things only an agent could, and not told about the one thing only they could. The decision, made with the maintainer in #380, is to group by **who acts next**, and to let only what the person must unblock reach them.

## Decision

- **One rule, the Next actor.** `hiveNextActor` (`src/shared/domain/hive-next-actor.ts`) answers `user`, `parent`, `worker` or `none` for a Hive member, with the reason a row shows. In order: a parked approval or question is `user`; an accepted or cancelled Delegation is `none`; `needs_attention` is `parent` while the parent will pick the Worker up (an active Run, or Follow-ups its running queue will deliver) and `user` (**Stuck — no agent will pick it up**) when it will not; `ready_for_review` and `waiting` are `parent`; `revision_requested` and `working` are `worker`. The renderer and the Session Host both call it.
- **Group by next actor.** The panel's grouped view, **By next actor** (was "By state"), lists **Needs you** (Waiting for your approval · Waiting for your answer · Stuck — no agent will pick it up), **Waiting for ⟨parent⟩**, one group per parent (Ready for review · Run failed, ⟨parent⟩ notified · Asked ⟨parent⟩ for help · Finished its turn), **Working** (Working · Revising · Connecting), **Closed** (Accepted · Cancelled), and `Archived · n`. A Queen with her own parked request is listed under Needs you. The tree uses the same labels, and a collapsed parent rolls up only its Needs you count and a muted Waiting count.
- **Only Needs you reaches the person outside the panel.** The rail dot, the Queen's sidebar line (`n need you`, with a muted `n waiting for ⟨Queen⟩` and no dot), and the Session Summary count only Needs you. OpenWaggle shows no desktop notifications or Dock badge for a Hive today, so there is nothing else to gate. Parent agents keep receiving every orchestration update.
- **Labels clear when the situation ends.** The Host records why a Delegation is `needs_attention` in `delegation_contracts.attention_cause` (migration 74): `run_failed`, written with a `session-host` transition row when a Worker Run fails, or `worker_request`, when the Worker sets it itself. A new Run on the Worker, from any source, clears `run_failed` when it activates: back to `revision_requested` if the failure interrupted a revision, to `working` otherwise. The parent's agent delivering anything (a Follow-up, a message or a started Run, steering, a promotion or a replacement) clears `worker_request`, as does the Worker setting itself back to `working`; a revision request needs `ready_for_review`, so it never meets this state. Each clear is a transition row. A Run-start clear publishes a list change for the parent and the Worker; a delivery clear rides on the delivery's own state change for the Worker. "Stuck" is derived at read time from the parent's Run and queue, never stored, so it follows the parent live and a Host restart reads the same answer. The failure stays in the transcript, the Delegation history and the parent's orchestration updates.
- **Agents read the same answer.** The Hive tool, CLI and MCP keep today's Delegation states and add `nextActor` to every Session summary and Delegation that carries one (`list`, `search`, `read`, `delegations_list`, `delegations_read`), computed in the Host with the same function and the Host's parked requests. It is additive, and query responses are not decoded exactly, so the Local Session protocol revision stays 27.

## Considered Options

- **Keep state groups and rename them.** The #356 amendment did that, and the group still mixed the parent's work with the person's.
- **Return `needs_attention` to its previous state at every Run start.** A Worker's own request for help would vanish the moment anything ran, though its parent never answered; the two causes clear on different events.
- **Store "stuck".** It changes whenever the parent starts or ends a Run or its queue changes, so a stored value would need a write on every parent transition and could disagree with the parent after a crash.

## Consequences

A `revision_requested` Worker no longer lights the rail dot; a Worker whose Run fails while its parent is running waits for the parent rather than the person, and becomes Stuck only once the parent is idle with nothing queued. The settlement rule #364 added, that a Worker's own `needs_attention` survives the settlement of the Run that set it, now reads the stored cause. A mutation's outcome is stored for idempotent replay, so it does not carry `nextActor`; read the Session or Delegation for it.
