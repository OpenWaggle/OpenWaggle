# Review: main process, shared types, IPC and persistence (PR #170)

Independent reviewer agent (pi on Bedrock, `eu.anthropic.claude-opus-5`), read-only against
the merged branch. Findings verbatim; the tool transcript that produced them is not kept.
Disposition for every finding is in [`pr170-findings.md`](./pr170-findings.md).

### Finding 1

SEVERITY: major
   FILE: src/main/openwaggle-mcp-session-lifecycle.ts:44,
 src/main/openwaggle-mcp-session-derivation.ts:78,
 src/main/openwaggle-mcp-task-runtime.ts:89
   WHAT: These three session-creation paths never pass `authorizationMode`, so
 sessions created through the OpenWaggle MCP server (agent-derived sessions, task
 runtime sessions) always land on the SQL default `'yolo'` and ignore the
 project/global default resolved in `session-details-handler.ts:90`.
   WHY IT MATTERS: A user who sets the global or project default to `Ask for
 Approval` still gets full-access sessions for every agent-created session, silently
 defeating the setting for exactly the sessions the user did not create by hand.
   FIX: Move `resolveSessionAuthorizationMode` (session-details-handler.ts:38) into a
 shared application helper and call it in all three `sessions.create({...})` sites
 (they also skip `environmentMode`, so one shared "new session defaults" resolver
 fixes both).

### Finding 2

SEVERITY: major
   FILE: src/main/ipc/session-details-handler.ts:38-47
   WHAT: Project/global defaults are snapshotted into `sessions.authorization_mode`
 at creation time only; there is no "inherit" state, so changing the project or
 global default never affects any existing session, even one the user never overrode.
   WHY IT MATTERS: The locked contract is a live precedence chain (session override >
 project > global); tightening a project default to `Ask for Approval` appears to
 apply but every existing session keeps auto-granting, which is a silent failure of a
 security control.
   FIX: Either persist "inherit" (nullable column / `authorizationMode?: undefined`
 meaning unset) and resolve project→global at run start in
 `preflight.ts`/`run-lifecycle.ts`, or make the settings UI contract explicit that
 defaults only apply to new sessions and only write the session row when the user
 overrides.

### Finding 3

SEVERITY: major
   FILE: src/main/adapters/pi/agent-kernel/interaction-ui-context.ts:84-95
   WHAT: `confirmPurpose` classifies authorization vs. user-input by exact-matching
 four hard-coded title strings that are produced in unrelated files
 (`mcp-tool-execution.ts:42`, `mcp-client-interactions.ts:86,115,215`), with no
 shared constant and no test that links the producers to the classifier.
   WHY IT MATTERS: Any copy edit to one of those titles silently changes
 authorization semantics (YOLO users start seeing prompts, or a genuine input consent
 gate gets auto-granted), and nothing in typecheck, lint, or the current tests
 catches it.
   FIX: Stop inferring purpose from prose: export a shared
 `AUTHORIZATION_CONFIRM_TITLES` const (or better, thread an explicit `purpose:
 'authorization'` through the confirm `opts` from the four call sites) so the
 classification is declared where the request is created.

### Finding 4

SEVERITY: major
   FILE: src/main/adapters/pi/agent-kernel/interaction-ui-context.ts:154-156 (with
 src/main/adapters/pi/mcp-client-interactions.ts:85-98,114-129)
   WHAT: In YOLO, `Open MCP elicitation URL?` and `Review MCP input request?` are
 auto-granted, so an MCP server can make the app call `shell.openExternal(...)` on a
 server-supplied URL with no user consent, and the disclosure screen naming the
 destination server and requested schema is skipped before the user is handed a raw
 editor to type data that is sent to that server.
   WHY IT MATTERS: These two are not tool-execution grants; auto-accepting them turns
 "full agent access" into "third-party MCP server can open arbitrary https/loopback
 URLs in the user's browser and harvest input without attribution" — a
 phishing/data-disclosure escalation the mode selector does not advertise.
   FIX: Keep external-navigation and pre-input-consent confirms user-gated regardless
 of mode (classify them as `'confirmation'`, or add a third purpose such as
 `'disclosure'` that YOLO never auto-grants), and restrict YOLO auto-grant to the
 tool-call and sampling grants.

### Finding 5

SEVERITY: minor
   FILE: src/main/services/database-service.ts:35-45,77
   WHAT: `ensureSessionAuthorizationModeColumn` re-implements migration 24's DDL and
 runs a `PRAGMA table_info(sessions)` on every boot, outside the `_migrations`
 ledger.
   WHY IT MATTERS: Two copies of the same `ALTER TABLE` string can drift, and a
 schema fix-up that bypasses the migration ledger makes the DB state no longer
 reconstructible from `APP_MIGRATIONS` (the exact class of problem the ledger exists
 to prevent).
   FIX: Delete the ad-hoc guard and rely on migration id 24; if idempotency is
 genuinely needed, make it a normal migration step guarded inside
 `database-migrations.ts`.

### Finding 6

SEVERITY: minor
   FILE: src/main/services/database-schema.ts:22-41,115-121
   WHAT: `CURRENT_SESSION_TABLE_STATEMENT` (the only place `authorization_mode`
 appears in a CREATE TABLE) is never executed — it is reachable only through
 `CURRENT_SESSION_SCHEMA_STATEMENTS.slice(1)` — and it is already stale: it omits
 `environment_mode`, `worktree_path`, `worktree_base_ref`,
 `worktree_start_from_origin` added by migration 20.
   WHY IT MATTERS: The next person who recreates the sessions table from the
 statement named "CURRENT" gets a table missing four columns and simultaneously
 breaks migration 24 with `duplicate column name: authorization_mode` on fresh
 installs; the `.slice(1)` positional coupling also silently drops an index if anyone
 prepends a statement.
   FIX: Keep one executed CREATE TABLE (the pre-authorization-mode one used by
 migration 20) and either delete the unused "current" variant or generate the index
 list by name instead of `slice(1)`.

### Finding 7

SEVERITY: minor
   FILE: src/shared/types/session.ts:71,
 src/main/adapters/pi/agent-kernel/run-lifecycle.ts:110
   WHAT: `SessionDetail.authorizationMode` is optional and the run path falls back to
 `DEFAULT_AGENT_AUTHORIZATION_MODE` (= `yolo`), so any future producer of a
 `SessionDetail` that forgets the field yields full access.
   WHY IT MATTERS: A security control that fails open on missing data will eventually
 be defeated by an unrelated refactor, and the DB column plus `hydrateSessionDetail`
 already guarantee a value, so the optionality buys nothing.
   FIX: Make the field required on `SessionDetail` (hydration already always sets it)
 or make the run-path fallback `'ask-for-approval'` so unknown state fails closed.

### Finding 8

SEVERITY: minor
   FILE: src/main/services/database-migrations.ts:266-269
   WHAT: No test anywhere references `authorization_mode` — there is zero coverage
 for migration 24 on a pre-existing DB, for the `isAgentAuthorizationMode` hydration
 fallback in `session-queries.ts:57`, or for `setSessionAuthorizationMode` at the
 store level, and no unit test asserts that YOLO leaves
 `select`/`input`/`editor`/non-authorization `confirm` untouched.
   WHY IT MATTERS: The brief's two riskiest behaviours (old rows back-filled to full
 access, YOLO not swallowing user-input requests) are asserted only for one
 happy-path confirm case in `interaction-ui-context.unit.test.ts`.
   FIX: Add a store/integration test that opens a DB at migration 23, runs
 migrations, and asserts old rows hydrate to `'yolo'`; add one unit test per
 non-confirm interaction kind asserting YOLO still emits a request event.

### Finding 9

SEVERITY: minor
   FILE: src/main/application/agent-run/agent-loop-events.ts:44-51 vs
 src/renderer/src/features/chat/lib/build-agent-loop-interaction-rows.ts:7-17
   WHAT: The durability rule (drop `info` notify requests, drop all notify
 resolutions) is duplicated verbatim in main-process persistence and renderer
 projection with no shared predicate.
   WHY IT MATTERS: The contract "info creates no durable history, warning/error
 create exactly one notice" is enforced in two places that can diverge, and
 divergence shows up only as a wrong transcript after reload — invisible to both
 sides' unit tests.
   FIX: Put the predicate in `src/shared` (e.g.
 `shared/utils/agent-loop-interaction.ts`) and import it from both the persistence
 filter and the renderer row builder.

### Finding 10

SEVERITY: minor
   FILE: src/main/adapters/pi/agent-kernel/interaction-ui-context.ts:111
   WHAT: `factoryName: factory.name` puts a Pi extension's raw JS function name into
 the interaction payload sent to the renderer, alongside `source: 'pi-ui'`
 (agent-loop-interaction.ts:12) and `renderer.kind: 'pi-tui-custom'`
 (agent-loop-interaction.ts:60).
   WHY IT MATTERS: The contract forbids raw internal identifiers and "Pi" in anything
 user-facing; shipping them in the payload means only renderer discipline stands
 between them and a visible label.
   FIX: Drop `factoryName` from the payload (or keep it out of the durable node
 content and log it instead), and treat `source`/`renderer.kind` as internal-only
 discriminants that the renderer must map to product copy.

### Finding 11

SEVERITY: nit
   FILE: src/main/adapters/pi/agent-kernel/interaction-ui-context.ts:84
   WHAT: `confirmPurpose` accepts `message` but never reads it.
   WHY IT MATTERS: A dead parameter on a security-classification function suggests
 the message was meant to participate and invites a future reader to "fix" it.
   FIX: Take only `title`, or remove the function entirely as part of the
 explicit-purpose fix above.

### Finding 12

SEVERITY: nit
   FILE: src/main/services/database-schema.ts:183-188
   WHAT: The new column has no `CHECK (authorization_mode IN
 ('yolo','ask-for-approval'))` constraint.
   WHY IT MATTERS: Only IPC-level validation prevents arbitrary strings; a bad write
 is then silently coerced back to `'yolo'` (full access) by the hydration fallback
 rather than surfacing.
   FIX: Add a CHECK constraint, or log at `warn` in `hydrateSessionDetail` when the
 stored value is not a known mode.
