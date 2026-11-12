# Access modes and authorization

Authorization: the live mode chain, grants keyed on requester and resource, which prompts
are authorization, notification budgets for requests, caller ceilings, and root Session
catalog-wide reach (ADR 0042).
Load when touching authorization requests, project grants, `session-control-run-authorization`
or `access-cli*`.

## Access Modes And Authorization Memory

- Authorization mode is a live chain resolved when a request is raised, not a value copied at session
  creation (ADR 0023). `authorization_mode_override` is nullable and `NULL` means inherit. Never read
  absence as `yolo`: that pins every pre-existing session to full access and makes the user's global
  default permanently irrelevant to it.
- Session creation stores no mode. If a create path needs one, the design is wrong; resolve at the
  point of use instead.
- Request purpose is declared at the call site. Never infer it from a title, and never re-introduce
  the exact-match title sniffing that used to live in `interaction-ui-context.ts`: renaming a title
  silently changed what full access could answer and no check could see it.
- Anything reaching `ui.confirm` is a question addressed to the user and can never be auto-answered.
  Authorization has its own entry point, and a missing channel degrades to prompting.
- Of the seven confirmation points in the app, exactly two are authorization. Opening an external URL
  and the input disclosure are not, and auto-granting the disclosure saves no work because the editor
  after it still blocks.
- Full access must emit no event at all, not merely skip the prompt. The "no transcript entry, no
  counter, no log" guarantee is enforced by short-circuiting before emission.
- Grants are keyed on requester, capability and resource, and are stored in project config, following
  Codex. Arguments are excluded, and an absent resource is never a wildcard: server-level matching
  would let a server widen its own permissions by shipping a new tool.
- An arriving request adds a surface above the composer and changes nothing about it. Do not disable
  the composer, move focus, or change the placeholder, and do not bind Enter to answering a request.
  T3 Code does seize the composer; we deliberately do not.
- Notification lifetimes count window-focused time and pause on blur, following T3. A timer keyed to
  the notification array instead of to each notification id restarts every clock on every new event,
  so nothing ever expires during a busy run.
- Notifications and decisions need independent event budgets. One shared window let informational
  notices evict an authorization request and its resolution, leaving a transcript row stuck on
  "Waiting" after the decision was made.
- The notification durability rule is shared between main and renderer. Two copies drift into a
  transcript that disagrees with itself after a reload while both sides' tests stay green.
- The run cwd is not the project. `ensureSessionWorktreeProjectPath` returns the worktree for a
  worktree session, so anything durable keyed on it lands somewhere the rest of the app never looks:
  grants written there could not be listed or revoked in Settings. Pass the durable project root
  explicitly and name the field so the cwd cannot be handed over by accident.
- A lenient config read is wrong for a permission decision. `loadProjectConfig` logs and returns empty
  on an invalid file, and empty falls through to the global default, which ships as full access, so one
  bad field silently stopped a project from asking. Use a strict read where the answer is a permission
  and fail closed.
- Project config writes are read-modify-write. Without per-path serialization two concurrent writes
  both read the pre-change file and the second rename wins, so one grant is lost while the UI reports
  both as saved. A run can raise several authorization requests at once, so this is reachable.
- `withCallerCeiling` (`application/session-control-run-authorization.ts`) clamps a starting Run's
  override to the caller's ask-for-approval ceiling only when the Run's `intent.callerId` is that
  caller: its own message, or its own Follow-up that its resume delivers. Resuming in front of
  someone else's Follow-up leaves it alone; that Run is bounded by its writer's boundary
  (`session-agent-run-ceiling.ts`) when it starts.
- `openwaggle mcp serve --profile <name>` used to be a label (`mcp:<name>`) on owner authority:
  a revoked or unknown profile still served the owner's Sessions (#350). Now a server is either
  `--owner` (the old transient authority, refused under `OPENWAGGLE_AGENT_RUN=1`) or `--profile`,
  which sends the profile name and credential plus its grants as `transientAuthority`. The
  authenticator accepts that pair only from an MCP client, stores it as `profileNarrowing`, and
  returns a placeholder authority with no capability and no target, so any path that skips
  `refreshNamedProfileCaller` fails closed. The refresh re-reads the profile and then
  `narrowNamedProfileCaller` intersects: capabilities and ceiling exactly; targets as profile
  projects inside the server's workspaces plus the existing Sessions both scopes list (a scope is
  a union, so the intersection is materialised per connection; MCP opens one per call). The
  caller id stays `profile:<id>`, so revocation still stops queued work, but durable checks keyed
  on the caller id (Follow-up delivery, run reach) see the whole profile; that is why a profile
  server refuses `--authorization-ceiling`. `openwaggle_hive` advertises only the operations whose
  base capabilities (`openwaggle-mcp-session-operation-grants-v2.ts`) were granted; a new
  operation must be added to that table. Server-side conformance is
  `bun run test:mcp:server-conformance`, part of `bun run test:mcp:conformance`.

## Filed under "Session Host authority and subscriptions are live boundaries"

A root Session agent's catalog-wide reach (ADR 0042) is decided by one function,
`sessionAgentRunReachesEveryProject` (`adapters/session-agent-run-project-reach.ts`), called by
`resolveSessionToolAgentCaller` when the tool is called and by `sessionAgentBlockReason` when a
queued Follow-up is delivered. It needs both the Session's own authority
(`rootSessionReachesEveryProject`: a root from the local user or a catalog-wide profile, origin read
from the caller id) and the Run's initiator (`session_runs.intent_json.callerId`, followed through up
to eight other Sessions, counted by distinct Session so Follow-up round trips between two roots do not exhaust it early, and at most 256 Runs, about 128 round trips; limits apply to the whole initiator tree; `walkRunInitiators` in `application/run-initiator-walk.ts` reads each Run once and is order-independent). Without the initiator check, a project-scoped CLI profile could message a desktop
Session and have it act in every project. Input into a running catalog-wide Run (steer, promote,
request/approval respond) from a narrower caller is refused in `local-session-run-input-reach.ts`
(`runInputWidensReach` on the authorization target port). A Follow-up the desktop user adopted
(`queue-adopt`) keeps its original writer in `intent.authorCallerId` as provenance only: reach and
ceiling read `callerId`, because adopting is the user choosing to send it as their own. Its
attachment rows stay owned by the author: every resolve or release of a Follow-up's attachments
(Run dispatch, Run-end release, promotion resolve and release) uses
`followUpAttachmentOwner(intent)` = `authorCallerId ?? callerId` (`message-aggregate.ts`); using
`callerId` failed promotion of an adopted Follow-up with `attachment_resolution_failed`. Every
needs-attention path also pauses the queue (`applyFollowUpAuthorizationState` with no pause reason,
profile revocation with `profile-revoked`), so `adoptFollowUp` resumes the queue in the same
mutation when it is paused with no reason or `profile-revoked`, and no item still needs attention;
`requested`, `parent-limit` (the adopted item starts past agents' capacity instead), run-failed and
host-lost stay paused. `queue-adopt` is a delivering
operation, so an idle Session then starts its head through `deliverAfterQueueDecision` (head
authorization, parent limit, Host ceiling; a refused admission re-pauses) and the outcome is
`started-run`. Clients gate `queue-adopt` (and every command) by the shared
`requiredLocalSessionCommandRevision`; `local-session-client.ts` keeps no copy of the rules.
`queue-list` `source` is `{ callerId, sessionId?, sessionTitle?, profileName? }`: `sessionTitle`
is the agent Session's title when the lister may see it (desktop user: any; profile or agent: by
`authorizedSessionScope`, archived and other projects included), never its id replaced. A Session agent's Authorization ceiling is
also clamped by its Run's initiator (`session-host/session-agent-run-ceiling.ts`, used by the tool
caller and `getSessionCallerAuthorizationBoundary`); an unidentifiable initiator counts as
ask-for-approval. An agent-requested Waggle's Run id is `waggle-of-<classicRunId>` (`requestedWaggleRunId`) so these checks can find its classic Run, and it inherits that Run's authorization context through `runIfRequested({ authority })`. Anything that needs the Waggle's durable Run (report source, spawn parent, reach, ceiling) reads `durableSessionRunId(runId)`. `queue-adopt` (desktop user only) needs `sessions:queue` and `sessions:authorization`. Reports are content,
not commands: the Host labels them but does not track information flow. Session agents with catalog-wide
scope may launch or create only in projects already in the catalog (`session-tool-project-catalog.ts`).

Native Session capabilities constrain OpenWaggle tools and the Session Host API. They are not an
OS sandbox against arbitrary commands from another process running as the same user. A hostile or
YOLO shell needs a separate account, container, or operating-system sandbox for containment.
