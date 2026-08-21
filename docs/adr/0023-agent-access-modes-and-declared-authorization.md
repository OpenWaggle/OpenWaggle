# Agent Access Modes And Declared Authorization

Status: accepted

Ponytail calls `ui.notify()` on every `session_start`. OpenWaggle turned each notification into an `agent_interaction_request` plus a synthesised `agent_interaction_resolved`, persisted both, and rendered them as two audit cards, replacing the real message with the literal word "Notification". The visible defect was noise, but the cause was that OpenWaggle had no model of why an agent was interrupting: a notification, a question, and a request for permission were one undifferentiated pipe, so nothing could be presented, automated, or remembered differently.

## Decision

- Two authorization modes exist. `YOLO (Full access)` is the default. `Ask for Approval` is the alternative. Nothing user-facing names the runtime.
- The mode is a live override chain, not a value copied at session creation. Precedence is session override, then project default, then global default, resolved when a request is raised. Absence at a level means inherit and never means full access. A session that was never overridden therefore follows a later change to its project or global default.
- Session creation stores no mode at all. A stored override only ever comes from an explicit user choice, which is what removes creation-time resolution from every path rather than adding it to the ones that lacked it.
- When no level can be read, resolution fails closed to `Ask for Approval`.
- Request purpose is declared where a request is raised, never inferred from its wording. The purposes are authorization, user input, disclosure, and external navigation. Authorization is the only purpose an access mode may answer.
- Authorization has its own entry point rather than a flag on the generic confirm, so anything reaching `ui.confirm` is a question addressed to the user and cannot be auto-answered. A UI context that lacks the OpenWaggle channel degrades to prompting.
- Full access short-circuits before any event is emitted, so an auto-granted call produces no prompt, no transcript entry, no counter and no log.
- A scoped grant is keyed on requester, capability, and resource. For a tool call that is the server label, `mcp.tool-call`, and the tool name; for sampling, the server label and `mcp.sampling`. Arguments are excluded. An absent resource matches only another absent resource and is never a wildcard.
- Three scopes exist: once, this session, and persistent. Session grants live in memory. Persistent grants are written to project config and are listed and revocable in Settings, naming the exact requester, capability and destination. Revocation applies from the next request and never retroactively.
- An arriving request adds a surface above the composer and changes nothing about it. The draft, caret, placeholder, enabled state and the Enter key all survive. Requests never time out.
- Agent notifications float in a corner stack clear of the composer, ordered by severity. Information and warnings leave after five seconds of window-focused time; errors stay until dismissed. Information leaves no transcript record; a warning or error leaves exactly one.
- No key is bound to a grant action. A remappable shortcut moves focus to a pending request and Escape returns the caret.

## Alternatives rejected

- **Snapshotting the mode at session creation**, which the first implementation did. It is simpler and needs no nullable column, but tightening a global or project default then appears to work while every existing session keeps its old mode. A permission control that fails in the permissive direction on stale data is worse than one that asks too often.
- **Inferring purpose from the confirmation title**, which the first implementation also did, by exact-matching four English strings. Renaming a title silently changed what full access could answer, and neither typecheck, lint nor the suite could see it.
- **A dedicated SQLite table for grants.** Codex persists approvals into config, keyed on server and tool name, and grants are user-authored policy rather than projected session state. Config also makes them reviewable and editable by hand.
- **Keying grants on call arguments.** It looks more precise and is less safe: it splits one intent across every argument combination, producing prompt fatigue, and lets an attacker-controlled value decide whether a grant applies.
- **Server-level grants for tool calls.** One approval would then cover every other tool on that server, including tools the server adds in a later version. A grant must not widen when the thing it trusts changes shape.
- **Full access answering every confirmation.** Of the seven confirmation points in the application, five are not authorization: opening an external URL at a destination a third party chose, a disclosure that exists to name who wants the user's data, a completion check for an external flow, and two destructive preset confirmations. Auto-answering the disclosure saves no work at all, because the editor that follows still blocks; it only removes the explanation.
- **Seizing the composer during an approval, as T3 Code does.** It buys a one-keystroke approval, at the cost of destroying a sentence in progress. Reaching the decision by a deliberate shortcut is slower and cannot lose work.
- **Composer-adjacent notifications.** Chosen first from a rendered prototype, then reversed on purpose, so that everything docked to the composer is something the user must answer.

## Consequences

- The session column is nullable and read as inherit. Anything that writes it must distinguish "no override" from "full access".
- A new capability must be added to a closed set and declared at its call site, so it cannot arrive unrecognised and be matched against a grant the user never gave.
- Because full access emits nothing, there is deliberately no audit trail of automatically granted work. Its visibility comes from the normal activity and result presentation, which is what Codex and T3 Code both do.
- The durability rule for notifications is shared between the main process and the renderer, because two copies drift into a transcript that disagrees with itself after a reload while each side's tests stay green.
- A keyboard user needs two steps to approve: reach the request, then choose. That is the accepted price of never binding a key to a grant.
