# Review round 2: main process, authorization semantics, persistence, IPC (PR #170)

Branch `pi/approval-modes-notifications` @ `03cbb5fd` vs `origin/main` (`b987cb82`).
Read-only review. No file in the repository was modified; no git write command was run.
`pnpm typecheck` is green; the four authorization/migration unit test files pass (33 tests).

Two claims below are backed by scripts I ran against the branch's own code (kept in `/tmp`, outside
the repo):

- `/tmp/scopeproof.ts` — decodes a real confirm response through the real IPC schema.
- `/tmp/prefproof.ts` — reads a project settings file through the real `getProjectPreferences`.

---

## 1. BLOCKER — the approval scope is stripped at the IPC boundary, so no grant is ever kept

**FILE:** `src/shared/schemas/agent-loop-interaction.ts:19` (`confirmResponseSchema`), consumed at
`src/main/ipc/agent-handler.ts:190`

**WHAT:** `AgentLoopConfirmResponse` gained `scope?: 'once' | 'session' | 'project'`
(`src/shared/types/agent-loop-interaction.ts:100`), and the ribbon really sends it
(`AgentAuthorizationRibbon.tsx:100` → `useAgentChat.ts:81` → `agent:respond-interaction`). The
schema the main process decodes that payload with was never updated:

```ts
const confirmResponseSchema = Schema.Struct({
  kind: Schema.Literal('confirm'),
  accepted: Schema.Boolean,
})
```

Effect Schema's default `onExcessProperty: "ignore"` **removes** undeclared keys from the decoded
output. Proof against the branch's own schema:

```
$ npx tsx --tsconfig tsconfig.node.json /tmp/scopeproof.ts
decoded response: {"kind":"confirm","accepted":true}     # sent: {..., scope: "project"}
```

So in `requestAuthorization` (`agent-authorization-request.ts:107`) `response.scope` is always
`undefined`, `persistDecision` never runs, and `settlePending` also broadcasts the stripped response
to the transcript.

Why nothing caught it: `agentLoopResponseSchema` is *annotated* `Schema.Schema<AgentLoopInteractionResponse>`
and `scope` is optional, so the lie typechecks; the unit tests
(`agent-authorization-request.unit.test.ts:73`) call `submitAgentLoopInteractionResponse` directly and
never cross the schema; the e2e test asserts the ribbon renders but never clicks `Allow…`.

**WHY IT MATTERS:** "Allow for this session" and "Always allow … in this project" silently do
nothing. Every kept approval degrades to once-only, the user is re-prompted for the same MCP tool on
every call forever, `.openwaggle/settings.json` never gains an `authorizationGrants` entry, and the
Settings list stays permanently on "This project has no saved approvals." The entire scoped-grant
slice is dead in the shipped product while its unit tests are green. Fails closed rather than open,
so it is a functional blocker, not a security one.

**FIX:** declare the field, one line:

```ts
const confirmResponseSchema = Schema.Struct({
  kind: Schema.Literal('confirm'),
  accepted: Schema.Boolean,
  scope: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_DECISION_SCOPES)),
})
```

Add one regression test that decodes `{kind:'confirm',accepted:true,scope:'project'}` through
`agentLoopResponseInputSchema` and asserts `scope` survives — every other response field is exposed
to the same silent-drop trap.

---

## 2. MAJOR — an unreadable project settings file loses the project's `ask-for-approval` and falls back to YOLO

**FILE:** `src/main/application/agent-authorization-mode.ts:39` (`readProjectDefault`) over
`src/main/config/project-config.ts:101` (`loadProjectConfig`)

**WHAT:** `readProjectDefault` only fails closed when `getProjectPreferences` *throws*.
`loadProjectConfig` never throws on a schema failure: `readValidatedProjectSettings` is called with
`strict: false`, logs a warning and returns `null` (`project-config.ts:77-85`), so the whole file —
including a perfectly valid `preferences.authorizationMode` — is discarded and the resolution chain
falls through to the global default, which ships as `yolo`
(`DEFAULT_AGENT_AUTHORIZATION_MODE`, `agent-authorization.ts:5`).

Any single invalid field anywhere in the file does it. Reproduced with the real code, using a grant
entry whose capability this build does not know (exactly what a newer build would write, or a hand
edit):

```
$ npx tsx --tsconfig tsconfig.node.json /tmp/prefproof.ts
[project-config] Failed to validate .openwaggle/settings.json { message: 'Invalid project settings
  schema: authorizationGrants.0.capability: Expected "mcp.tool-call", actual "shell.exec" …' }
preferences read back: undefined
```

`pickAuthorizationMode({sessionOverride: undefined, projectDefault: undefined, globalDefault: 'yolo'})`
→ `'yolo'`.

**WHY IT MATTERS:** this is the one thing the module's own doc comment promises cannot happen: "a
corrupted settings file or an unreadable project config produces prompts instead of silent full
access" (`agent-authorization-mode.ts:11-17`). A project deliberately set to Ask for Approval
silently becomes full access — no prompt, no transcript entry, no log beyond one parse warning —
after a hand edit, a partial write, or a downgrade from a build that added a capability. The one
control the user set to be asked stops asking.

**FIX:** distinguish "no file" from "file present but unreadable". Smallest correct change: give
`agent-authorization-mode.ts` a strict read for this single decision, e.g. a
`readProjectAuthorizationDefault(projectPath)` in `project-config.ts` that reads with `strict: true`
and lets `readProjectDefault` return `FAIL_CLOSED_AUTHORIZATION_MODE` in its existing `catch`.
Alternatively have `loadProjectConfig` return a discriminated `{ ok: false, reason: 'invalid' }` and
treat `invalid` as fail-closed at this call site only, leaving unrelated callers on today's lenient
behaviour.

---

## 3. MAJOR — in a worktree session, project grants are written into the worktree, where nothing can see or revoke them

**FILE:** `src/main/adapters/pi/agent-kernel/classic-run.ts:18` and `waggle-run.ts:180` feeding
`run-lifecycle.ts:110` → `interaction-ui-context.ts:204` → `agent-authorization-request.ts:55`

**WHAT:** the `projectPath` handed to the authorization path is
`await ensureSessionWorktreeProjectPath(input.session)`, which for `environmentMode: 'worktree'`
returns the worktree directory (`~/.openwaggle/worktrees/<repo>/<sessionId>`,
`session-worktree-birth.ts:111`). Everything downstream then uses that as "the project":
`grantForProject` writes `<worktree>/.openwaggle/settings.json`, and `findGrantCovering` reads it.

Meanwhile the same feature reads the *real* project path everywhere else:
`resolveEffectiveAuthorizationMode` resolves the project default from `session.projectPath`
(`agent-authorization-mode.ts:88`), Settings lists and revokes grants for `settings.projectPath`
(`AgentAccessSection.tsx:293`), and the ribbon's label is built from `session.projectPath`
(`ChatComposerStack.tsx:46,215`).

**WHY IT MATTERS:** the user clicks a button that says "Always allow list_issues for github-issues in
**my-repo**" and a standing grant is written somewhere else entirely. Consequences, all real:

- Settings for `my-repo` never lists it, so it **cannot be revoked from the UI** — a persistent
  authorization the user was told about and cannot take back.
- It does not apply to the repo, nor to any other worktree session, so "always allow" re-prompts on
  the next session anyway.
- Grants recorded for `my-repo` are ignored inside worktree sessions.
- It writes an untracked `.openwaggle/settings.json` into the session's git worktree, which surfaces
  in that session's own diff/commit surface.
- Mode and grants disagree about which directory is "the project", which will keep producing bugs.

**FIX:** pass the authorization project root separately from the run cwd. In `run-lifecycle.ts:107-112`
keep `projectPath: input.projectPath` for the runtime, and give the UI context the durable root, e.g.
`authorizationProjectPath: input.session.projectPath`, then use that in
`createAuthorizeChannel`. That also realigns grants with the path `resolveEffectiveAuthorizationMode`
and Settings already use.

---

## 4. MAJOR — session creation returns `authorizationMode: 'yolo'` for a row that holds NULL

**FILE:** `src/main/store/session-details/session-creation.ts:32`

**WHAT:** the insert correctly stores `NULL` (line 54, "inherit"), but the `SessionDetail` handed
back claims a mode:

```ts
authorizationMode: input.authorizationMode ?? 'yolo',
```

`sessions:create` passes no `authorizationMode` (`session-details-handler.ts:113-123`), so every new
session returns an explicit `'yolo'` while its row says "inherit". This is the exact NULL→yolo
coercion the design forbids, and it is the residue of blocker B1's fix
(`docs/reviews/pr170-findings.md:17`): the row was fixed, the returned projection was not. The read
path is correct (`session-queries.ts:57-59` omits the field when the column is not a known mode).

**WHY IT MATTERS:** the renderer stores that object as `activeSession`
(`chat-store-actions.ts:68-72`) and the composer control treats a present `authorizationMode` as an
override (`SessionAuthorizationModeMenu.tsx:82`). With the global or project default set to Ask for
Approval, a freshly created session's permission control reads **YOLO** while the run will in fact
prompt. A permission control that misstates the mode in force is the one thing it must never do, and
it heals only when something happens to refetch the detail. Secondary: because the control thinks the
override is already `yolo`, `handleChange` short-circuits (`line 95`), so the user cannot pin a real
`yolo` override on that session until a refresh. Actual enforcement is unaffected — the resolver
re-reads the row — so this is a lie in the UI, not an escalation.

**FIX:** carry the same absence the row carries:

```ts
...(input.authorizationMode ? { authorizationMode: input.authorizationMode } : {}),
```

---

## 5. MINOR — grants are keyed on the mutable server name, not the stable instance id in the same object

**FILE:** `src/main/adapters/pi/mcp-tool-execution.ts:58` and `mcp-client-interactions.ts:213`

**WHAT:** `requester: attribution.serverLabel`, which is `server.name` (`capability-shared.ts:19`) —
the configurable label from `.mcp.json`. The same attribution object carries `serverInstanceId`, a
persisted id (`config-view.ts:73`, `json-files.ts:20`), which is what Codex's
`McpToolApprovalKey { server, connector_id, tool_name }` models and what the type comment claims to
follow (`agent-authorization-grants.ts:20-27`).

**WHY IT MATTERS:** a standing grant follows the *name*. Repoint the `github` entry at a different
command or URL, or let a project-level MCP config define a server whose name matches one the user
granted, and tool calls to the new server are auto-approved with no prompt. It is not a wildcard
over-match — resource-absent semantics are correct (see "categories" below) — but the identity is
weaker than the design says it is.

**FIX:** include the stable id in the key, e.g. `requester: attribution.serverInstanceId` with the
label kept for display, or `requester: \`${serverInstanceId}\`` plus a `label` field on
`ScopedAuthorizationGrant` used only by Settings. Existing grants become unmatched, which is the safe
direction.

---

## 6. MINOR — project settings writes are read-modify-write with no serialization, so concurrent grants are lost

**FILE:** `src/main/config/project-config.ts:133-156` (`updateProjectSettingsFile`)

**WHAT:** read → transform → write temp → rename, with nothing serializing concurrent callers. The
rename is atomic; the read-modify-write is not. Before this branch the only writers were user-driven
preference changes, so the race was theoretical. Now `grantProjectAuthorization` is called from the
authorization path, and parallel MCP tool calls (Waggle collaborations in particular) can approve two
different tools within milliseconds.

**WHY IT MATTERS:** last writer wins on the whole file, so one of the two grants is silently dropped
and the user is prompted again for something they explicitly chose to keep. A grant racing a
preference write can also drop the preference.

**FIX:** serialize per project path with a promise chain around `updateProjectSettingsFile`
(one module-level `Map<string, Promise<unknown>>`, chain and clear), the same shape
`session-worktree-birth.ts:25-33` already uses for birth.

---

## 7. MINOR — switching the project or global default to YOLO leaves a pending prompt parked

**FILE:** `src/main/ipc/project-handler.ts:143-152` and `src/main/ipc/settings-handler.ts` (missing
call), versus `src/main/ipc/session-details-handler.ts:195-209` (present)

**WHAT:** the session handler deliberately resolves the effective mode after the write and calls
`grantPendingAuthorizationsForSession` when it comes out `yolo` — including the "cleared an override
that reveals a YOLO default" case. `project-config:set-preferences` and the global
`defaultAuthorizationMode` write do neither.

**WHY IT MATTERS:** the mode is a live chain, so a project or global switch to YOLO does govern the
*rest* of the run — but the request already on screen keeps blocking it. The user just told the app
never to ask and is still staring at a question that only a manual click will clear. Inconsistent
with the locked behaviour the session path implements.

**FIX:** after a successful preference/settings write that sets `authorizationMode` to `yolo`
(or clears a project override), resolve and grant pending authorizations for the affected sessions —
sessions whose `project_path` matches for the project case. If that is deliberately out of scope, say
so in the handler comment, because right now the asymmetry reads as an oversight.

---

## 8. MINOR — `scopeKey` is dropped when an authorization prompt is rehydrated from history

**FILE:** `src/renderer/src/features/chat/lib/agent-loop-transcript-interactions.ts:77-92`
(`parseConfirmInteraction`)

**WHAT:** the durable node stores the whole event including `scopeKey`
(`agent-loop-events.ts:120-123`), but the parser rebuilds only `title`, `message` and `purpose`.
`isAuthorizationRequest` requires `scopeKey !== undefined`
(`agent-authorization-ribbon-model.ts:32-37`), so a replayed authorization row loses its identity
line ("list_issues · Run a tool") and renders as a generic question.

**WHY IT MATTERS:** the transcript is the audit trail for what was authorized. After a reload it can
no longer say what the approval covered, only the prose message. No security impact — live requests
keep their key, and main never takes the key from the renderer.

**FIX:** parse and re-attach the key (validating `capability` with
`isAgentAuthorizationCapability`, requester/resource as strings), dropping the field when it does not
validate.

---

## 9. MINOR — session grants are never cleared, and the doc says they are

**FILE:** `src/main/application/agent-authorization-grants.ts:47` (`clearSessionGrants`)

**WHAT:** the export is documented "for session deletion and for tests" but production never calls
it — the only callers are the two unit test files. Session deletion
(`session-details-handler.ts` → `cleanupBeforeSessionRemoval`) does not.

**WHY IT MATTERS:** `sessionGrants` grows for the process lifetime, one entry per session that ever
approved something. No security consequence (session ids are not reused), but the module's stated
invariant is unenforced and the comment is misleading.

**FIX:** call `clearSessionGrants(id)` in the session-delete path, next to `cleanupSessionRun`.

---

## 10. MINOR — every authorization request hydrates the entire session

**FILE:** `src/main/application/agent-authorization-mode.ts:78-79` over
`src/main/store/session-details/session-queries.ts:171-185`

**WHAT:** resolving the mode calls `getSessionDetail`, which selects every `session_nodes` row for
the session and hydrates all messages, to read one column. It runs on every authorization request —
including in YOLO, before the short-circuit — plus a `.openwaggle/settings.json` read.

**WHY IT MATTERS:** on a long session this is a large main-process read per MCP tool call, and Waggle
runs fire many. Resolving per request is the right design; resolving it this expensively is not.

**FIX:** add a narrow query beside `selectSessionRow`, e.g.
`selectSessionAuthorizationFields(id)` returning `{ project_path, authorization_mode_override }`, and
use that here. Keeps the live-chain semantics, drops the node scan.

---

## 11. MINOR — migration 25 cannot tolerate a database that already has the column

**FILE:** `src/main/services/database-migrations.ts:282-286` with
`database-schema.ts:161-174`

**WHAT:** a bare `ALTER TABLE sessions ADD COLUMN authorization_mode_override`. Idempotency across
normal runs is fine (`_migrations` guard, `database-service.ts:39-49`), and ordering is correct.
But an earlier revision of this same branch added the column through a PRAGMA-guarded boot-time step
(`docs/reviews/pr170-findings.md:96-100`). Any database touched by that build already has the column,
`ALTER` fails with "duplicate column name", the whole `setupLayer` fails as
`DatabaseBootstrapError`, and the app does not start.

**WHY IT MATTERS:** limited to developers and testers who ran the intermediate build — released users
are unaffected — but the failure mode is a hard boot failure with no recovery short of deleting the
database or editing `_migrations` by hand.

**FIX:** either check `PRAGMA table_info(sessions)` before the `ALTER` in that migration, or accept
the duplicate-column error for this one migration id.

---

## 12. NITS

- `src/shared/types/agent-authorization-grants.ts:59` — `authorizationScopeKeyId` maps an absent
  `resource` and `resource: ''` to the same id, so an empty-string resource would match the
  server-level key. `project-handler.ts:105-109` already trims `''` away on the IPC path, and no
  producer emits an empty resource, so it is theoretical. Encoding presence (e.g. `\u0001` prefix
  when present) removes it.
- `authorization-grants:grant` is exposed through preload (`api.ts:130`, `project-handler.ts:163`)
  but no UI calls `grantAuthorization` — Settings only lists and revokes. A write endpoint that
  creates standing authorizations with no caller is surface for nothing.
- `session-mutations.ts:60-75` — `setSessionAuthorizationMode` ignores the affected-row count, so
  setting a mode on a deleted session reports success.
- `src/shared/types/agent-loop-interaction.ts:43-46` — `'disclosure'` and `'external-navigation'`
  have no producer anywhere; the URL elicitation and the form disclosure both ride on `'user-input'`
  via plain `confirm` (`mcp-client-interactions.ts:67,96`). Behaviour is correct (never
  auto-answered), but two of the four declared purposes are dead, and the ADR/type comments read as
  if they are in use.
- `docs/reviews/pr170-findings.md:96-100` still describes the boot-time PRAGMA guard as "the single
  mechanism"; the shipped mechanism is migration 25. Stale record.

---

## Categories the brief asked me to hunt — findings and non-findings

**A path where the mode resolves to full access when it should not.** One found: §2 (invalid project
settings file → project default lost → global `yolo`). One adjacent, deliberate, worth a decision
rather than a fix: `.openwaggle/settings.json` is repo-local, and both the project default and the
persisted grants live in it, so a settings file that arrives with a clone can set
`preferences.authorizationMode: "yolo"` and pre-seed `authorizationGrants` for a user whose global
default is Ask. `docs/configuration.md:21` and the website docs say these files must stay untracked,
which is the mitigation, but nothing enforces it and the composer only shows the resulting mode, it
never says "this came from the repo". If the project layer is meant to be trusted input, the docs
should say so explicitly; if not, the cheap hardening is to let project config only *narrow*
(`ask-for-approval` honoured, `yolo` ignored unless the project is explicitly trusted).

Also checked and clean: `pickAuthorizationMode` precedence and its `??` chain treat `null` and
`undefined` as inherit and never as `yolo`; both resolver catch paths fail closed;
`readGlobalDefault` re-validates the stored value. One observation, not a defect: a corrupted global
settings row resolves to `DEFAULT_SETTINGS.defaultAuthorizationMode` = `yolo`
(`sanitizers.ts:51`, `settings.ts:96`), so `FAIL_CLOSED_AUTHORIZATION_MODE` is unreachable for global
corruption. Defensible — `yolo` is the product default a user with no configuration gets anyway — but
the module comment claims more than the code delivers.

**Any place NULL is coerced to yolo.** One found: §4. The migration
(`database-schema.ts:167-172`), the read path (`session-queries.ts:57`), the write path
(`session-mutations.ts:68`), the copy/fork path (`agent-session-service.ts:170`), the IPC validator
(`session-details-handler.ts:33-39`) and the renderer's optimistic update
(`chat-store-actions.ts:127`) all preserve absence correctly.

**A grant key that could over-match.** No wildcard over-match. `authorizationScopeKeysMatch` compares
full ids, an absent `resource` matches only another absent `resource`, `capability` is a closed union
validated at the IPC boundary, and arguments are correctly excluded from the key. The identity is
weaker than intended in one respect (§5, mutable server name) and has one theoretical collision
(§12, `''` vs absent). Main always takes the key from its own pending request, never from the
renderer's response, so a compromised renderer cannot widen a grant.

**TOCTOU between resolving the mode and honouring it.** None that widens access. The only window is
inherent and documented: `resolveAuthorizationMode()` resolving `yolo` immediately before a switch to
Ask lets that one already-authorized call proceed — the same "revoking never reaches backwards" rule
stated in `project-config.ts:233-238`. The reverse direction is handled: the session handler resolves
*after* writing and grants pending authorizations (`session-details-handler.ts:202-208`). The gap that
does exist is §7, and it under-permits (a prompt stays up) rather than over-permits.

**A non-authorization purpose that can be auto-answered.** None. `requestAuthorization` is the only
code that consults the mode, and it always constructs `purpose: 'authorization'`
(`agent-authorization-request.ts:95`); `grantPendingAuthorizationsForSession` filters on
`kind === 'confirm' && purpose === 'authorization'`
(`agent-loop-interaction-broker.ts:264`); every plain `ui.confirm` is hardcoded to `'user-input'`
(`interaction-ui-context.ts:150`); both MCP call sites fall back to plain `confirm` when the symbol
channel is absent (`mcp-tool-execution.ts:67`, `mcp-client-interactions.ts:219`); history rehydration
downgrades an unknown purpose to `'user-input'`
(`agent-loop-transcript-interactions.ts:66-75`); and the renderer has no notion of `yolo` at all
(no occurrence outside tests). `getOpenWaggleAuthorize` is symbol-keyed and type-guards the value as
a function, and Pi's runner returns the very object OpenWaggle assigned
(`extensions/runner.js:458-461`), so the channel reaches the call sites as intended.

**Migration ordering / idempotency.** Ordering, nullability and the `CHECK` constraint are right, and
crucially the migration does **not** rebuild `sessions`, so cascading children survive — the unit
tests cover the added column, its nullability, pre-existing rows staying NULL, the rejected value and
migration 24 surviving. The only gap is §11.

**Unhandled rejection or a request that can never settle.** None found in the authorization path.
`requestAgentLoopInteraction` never rejects — it resolves with a kind-appropriate fallback on abort or
timeout — so the `void requestInteraction(...)` for `notify` (`interaction-ui-context.ts:180`) cannot
produce an unhandled rejection, and it resolves synchronously anyway. Abort listeners are registered
`{ once: true }` and removed in `cleanup`; an already-aborted signal settles before any listener is
attached; the merged `AbortSignal.any` composite is held alive by the awaiting closure. One residual:
pending entries are only settled by signal abort, timeout, an explicit stop
(`cancelAgentLoopInteractionsForRun`) or a user response — a request whose promise is abandoned
without the run signal aborting would linger in the map and on screen. It stays answerable, and I
found no path that produces it.

---

## VERDICT

**Do not merge as-is.** One blocker: the scoped-grant feature — a whole slice of this branch, with
its own UI, IPC surface, persistence and docs — is inert in the real application because the confirm
response schema drops `scope` (§1). Ship that one-line schema fix plus its regression test first.

Alongside it I would want §2 (invalid project settings escalating to full access, the one fail-open I
found), §3 (worktree sessions writing standing grants where nothing can revoke them) and §4 (a
permission control displaying YOLO for a session that inherits Ask). Those three are small, local
changes and each one contradicts a promise the branch makes in its own doc comments.

§5–§12 are fine as follow-ups. Everything else in my scope — the precedence chain, the live
resolution, purpose declaration, migration 25, grant key semantics, the broker's settle paths, and
the IPC/preload contract — is well built, and the design comments explaining *why* each choice was
made are unusually good; the two places where the code does not live up to those comments (§2, §4)
are exactly where I would look first next time.
