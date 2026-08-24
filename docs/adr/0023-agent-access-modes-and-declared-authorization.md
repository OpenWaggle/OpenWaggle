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
- A scoped grant is keyed on the requester's stable id, its capability, and the resource. The display name travels with the grant so Settings can name it, but takes no part in matching. For a tool call that is the server label, `mcp.tool-call`, and the tool name; for sampling, the server label and `mcp.sampling`. Arguments are excluded. An absent resource matches only another absent resource and is never a wildcard.
- Three scopes exist: once, this session, and persistent. Session grants live in memory. Persistent grants are written to project config and are listed and revocable in Settings, naming the exact requester, capability and destination. Revocation applies from the next request and never retroactively.
- An arriving request adds a surface above the composer and changes nothing about it. The draft, caret, placeholder, enabled state and the Enter key all survive. Requests never time out.
- Agent notifications float in a corner stack clear of the composer, ordered by severity. Information and warnings leave after five seconds of window-focused time; errors stay until dismissed. Information leaves no transcript record; a warning or error leaves exactly one.
- No key is bound to a grant action. A remappable shortcut moves focus to a pending request and Escape returns the caret. Answering returns the caret too, falling back to the composer when nothing was remembered, so a decision never leaves focus on the document body.
- Both the composer control and Settings name the mode in the same vocabulary, in every state. When a session inherits, the control names the effective mode and marks it inherited rather than showing a bare "Default".
- A blocking request and an arriving notice are announced through a live region that is always mounted and starts empty, never by putting `aria-live` on the surface itself.

## Alternatives rejected

- **Snapshotting the mode at session creation**, which the first implementation did. It is simpler and needs no nullable column, but tightening a global or project default then appears to work while every existing session keeps its old mode. A permission control that fails in the permissive direction on stale data is worse than one that asks too often.
- **Inferring purpose from the confirmation title**, which the first implementation also did, by exact-matching four English strings. Renaming a title silently changed what full access could answer, and neither typecheck, lint nor the suite could see it.
- **A dedicated SQLite table for grants.** Codex persists approvals into config, keyed on server and tool name, and grants are user-authored policy rather than projected session state. Config also makes them reviewable and editable by hand.
- **Keying grants on the requester's display name.** It reads more naturally in config and was how the first version worked. It has one harmless failure and one unsafe one: renaming a server drops its grants, which merely asks again, but giving a different server config a name a previous one used silently hands it every grant the old one held. Codex keys on a connector id for the same reason.
- **Keying grants on call arguments.** It looks more precise and is less safe: it splits one intent across every argument combination, producing prompt fatigue, and lets an attacker-controlled value decide whether a grant applies.
- **Server-level grants for tool calls.** One approval would then cover every other tool on that server, including tools the server adds in a later version. A grant must not widen when the thing it trusts changes shape.
- **Full access answering every confirmation.** Of the seven confirmation points in the application, five are not authorization: opening an external URL at a destination a third party chose, a disclosure that exists to name who wants the user's data, a completion check for an external flow, and two destructive preset confirmations. Auto-answering the disclosure saves no work at all, because the editor that follows still blocks; it only removes the explanation.
- **Seizing the composer during an approval, as T3 Code does.** It buys a one-keystroke approval, at the cost of destroying a sentence in progress. Reaching the decision by a deliberate shortcut is slower and cannot lose work.
- **Composer-adjacent notifications.** Chosen first from a rendered prototype, then reversed on purpose, so that everything docked to the composer is something the user must answer.
- **Compact mode labels in the composer (`YOLO`, `Ask`).** They fit the row better and were reversed for two reasons. `Ask` is the contraction the domain language rules out, and it names no approval at all. The mechanism also relied on Chromium repainting `<option>` text between focus and the native popup opening; had that race been lost while a session inherited full access, the popup would have shown the same word twice with no way to tell inherit from override, and no jsdom or Playwright assertion could observe it because the popup is drawn outside the DOM.
- **`aria-live` on the request ribbon and the notification stack.** Both are mounted together with their content, and a live region added in the same commit as its text is not announced by VoiceOver. The attribute assertions passed while nothing was ever spoken, which is the failure mode a guard is supposed to prevent.

## Consequences

- The session column is nullable and read as inherit. Anything that writes it must distinguish "no override" from "full access".
- A new capability must be added to a closed set and declared at its call site, so it cannot arrive unrecognised and be matched against a grant the user never gave.
- Because full access emits nothing, there is deliberately no audit trail of automatically granted work. Its visibility comes from the normal activity and result presentation, which is what Codex and T3 Code both do.
- The durability rule for notifications is shared between the main process and the renderer, because two copies drift into a transcript that disagrees with itself after a reload while each side's tests stay green.
- A keyboard user needs two steps to approve: reach the request, then choose. That is the accepted price of never binding a key to a grant.
- The response schema, not just the response type, has to declare every field. Effect Schema deletes undeclared keys while the union's type annotation keeps that invisible to the compiler, which is how the approval scope was silently dropped at the IPC boundary with the whole grant slice inert and every unit test green. Decode tests now cross that boundary.
- Every purpose in the taxonomy has a producer. A purpose that nothing declares makes the rule about it unverifiable, which is what happened when external navigation and disclosure existed only in the glossary while both call sites fell back to user input.
- Authorization state is keyed on the durable project root, never the run cwd. A worktree session runs elsewhere, and keying grants on the cwd wrote them where Settings could not list or revoke them.
- Project config writes are serialized per project, because each one is read-modify-write and a run can raise several requests at once.
