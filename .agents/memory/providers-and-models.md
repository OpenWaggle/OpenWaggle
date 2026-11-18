# Providers and models

Provider sign-in and auth UI, the selected model and per-Session execution profile,
thinking levels, expired provider credentials (AWS SSO and shared AWS files), and provider
installation identifiers.
Load when touching provider auth, `features/providers`, model or thinking-level selection.

## Expired provider credentials, refused Title models, empty legacy files (#357, October 2026)

- AWS SSO expiry ("Token is expired. To refresh this SSO session run 'aws sso login'...") ended Runs
  with code `unknown`. `isExpiredCredentialMessage` (shared classifier) maps SSO, STS
  `ExpiredTokenException` and OAuth sign-in expiry to `session-expired` ("Provider credentials
  expired"), before the 401/403 rule. The AWS SDK refreshes an SSO token from its cached refresh
  token at most once per 30 s per SSO session (`lastRefreshAttemptTimes`); a request made meanwhile
  fails at once, so several Runs starting together all failed but one. `withExpiredCredentialRetry`
  (installed on both Bedrock stream functions in `pi-bundled-bedrock.ts`) re-sends a request that
  failed on expired credentials before it streamed anything, once, after 2 s, and first calls
  `clearBedrockClients()`: since the v1 performance work the patched transport reuses one client
  per configuration (see Pi Runtime Memory), so without that the retry would reuse the failing
  credential provider. Bedrock emits `start` only after
  `client.send` returns, so a credential failure is always the first event.
- Keys replaced in the shared AWS files (`~/.aws/credentials`, `~/.aws/config`, or the
  `AWS_SHARED_CREDENTIALS_FILE` / `AWS_CONFIG_FILE` paths) were not picked up until restart: the
  AWS SDK caches those files per process (`filePromises` in `@smithy/core/config`), so a new
  client read the old keys again. Two paths: temporary STS keys a login tool rewrites (saml2aws)
  fail as `ExpiredTokenException` and are retried after 2 s; a long-term IAM key a script rotated
  and deleted fails as `UnrecognizedClientException`, is not retried, drops the clients, and the
  next request uses the new key. The pi-ai patch gives each new client `credentialDefaultProvider:
  defaultProvider({ ...init, ignoreCache: true })`: the files are read again whenever a client
  resolves credentials, so once per client for static keys and on each refresh (about hourly) for
  SSO or assume-role, never per request; `packageExtensions` in package.json adds
  `@aws-sdk/credential-provider-node` to pi-ai with the Bedrock client's range, and
  `pi-bedrock-rotated-credentials.unit.test.ts` checks both resolve to one copy. A retry that also
  fails on its credentials (expired or refused) drops the clients again, before the Run sees the
  failure; that saves the next request a failed attempt and the 2 s retry. Dropping is Host-wide
  (`clearBedrockClients`): every profile's client re-resolves credentials and reconnects. Same
  approach as the proposed upstream fix for Pi #11221; drop both on the Pi upgrade that has it.

## Filed under "Pi Runtime Memory"

- Pi 1.2.0's Sign in with ChatGPT (`openai-chatgpt`) sends OpenAI a stable installation ID and reads it from `ModelRuntime.login`'s fourth argument, `LoginOptions.getDeviceId`. Without it the flow throws "requires a device ID (UUID) for this installation" before opening the browser. `pi-provider-oauth-service.ts` passes `getDeviceId: () => settingsManager.getOrCreateDeviceId()` from `createOpenWaggleGlobalPiSettingsManager()` and flushes it, so the ID lives in `~/.pi/agent/settings.json` as Pi's own login stores it. `SettingsManager.flush()` never rejects: a failed write is only reported by `drainErrors()`, which the sign-in logs. `LoginOptions.agentName` (OpenAI's agent name hint) is not passed, so OpenAI's consent screen still says "Pi". Check new `LoginOptions` fields on every Pi upgrade.

## Filed under "Product And UX Memory"

- Provider auth UI is method-based. Keep provider-level availability separate from API-key configured state and OAuth connected state.

## Filed under "Access Modes And Authorization Memory"

- The selected model is app-DB state, never repo state. `.openwaggle/settings.json` lives inside the
  user's repository, so a personal model pick committed there leaks machine-specific provider config;
  it is stored as `selectedModelsByProject` in the SQLite `settings_store` instead, and the project
  file writer strips any legacy `preferences.model` on write. `authorizationMode` stays repo-local by
  design; `thinkingLevel` is never a project preference (it is Session state, see below).
- A Session's model lives in its execution profile (`session_execution_profiles.profile_json` `$.modelId`)
  and changes only through the Host-owned `sessions:set-model` channel, which refuses
  (`session_run_active`) while a Run is starting, active, or stopping. Classic and Waggle Runs read it
  once at Run start, so a switch reaches only the next Run, including queued follow-ups. The
  renderer records each Run's model from `agent_start.model` (`runModelBySessionId`) to explain the pending
  pick above the composer and keep the context meter on the running model. That map survives an
  `agent_end` with `willRetry` (the Run continues on the same model through the auto-retry wait) and is
  cleared on a terminal `agent_end`, a failed or cancelled `auto_retry_end`, or run completion. Sends and enqueues await
  `settledSessionModelWrites` first, because the Host, not the send payload, picks the model. A Session
  pick never rewrites the project's preferred model for new Sessions.
- The Session thinking level follows the model (ADR 0044 notes): `$.thinkingLevel` in the execution
  profile, set through `sessions:set-thinking-level`, read and clamped at Run start, and recorded by Pi
  as `thinking_level_change`. Messages, queued Follow-ups, and `AgentSendPayload` carry no thinking
  level, and Follow-ups carry no Run authorization override. `SqliteSessionSettingsRepository`
  checks the active Run in the same transaction as the write, so a model or thinking change is
  refused (`session_run_active`) while a Run is starting, active, or stopping, but allowed while
  the queue waits. A `message`/`start` level is written with the Run's admission
  (`persistRunStartThinkingLevel`, same transaction as the starting Run). A desktop pick also
  persists Pi's global default and publishes the sessionless `default-thinking-level-changed` Host
  event; a caller's `thinking` on create/launch/spawn or an idle-start `message`/`start` never does,
  and extensions cannot set it (the broker refuses `thinkingLevel` in settings patches). A new
  Session starts from Pi's *global* `defaultThinkingLevel`: a project-level Pi default is never
  read, so a draft pick always sticks. Renderer: `useSessionThinkingLevel(sessionId)` returns
  `{ level, setLevel, canChange }` (a draft, `null`, reads/writes Pi's default). First send
  creates the Session at the level the draft shows (`draftThinkingLevel`: pending pick, else the
  default query) through the 4th `sessions:create` argument, sent as
  `specialization.thinkingLevel`, which never writes Pi's default; there is no module-global
  draft pick to go stale. First send locks the draft (`lockDraftForFirstSend`, `isMaterializing`)
  before its first await and reads the level only after `settledThinkingLevelWrites`, from the
  query cache (`readDefaultThinkingLevel`). A 4-argument `sessions:create` needs revision 21
  (`HOST_UI_REVISION_21_ARGUMENT_COUNTS` in `requiredHostUiRevision`). `useSessionSettingsChangeable(sessionId)` is the shared picker gate:
  false while a Run starts (first send from the moment `createSession` resolves, foreground send,
  worktree launch, or a queue action whose outcome was `started-run`, kept in
  `queued-run-start-store` until that Run's `agent_start`/settlement, or until a Host resync
  re-reads the Session's queue as idle: `reconcileQueuedRunStarts`), while the queue snapshot
  reports `activeRunId` (Runs started anywhere: CLI, other windows, agents), runs, or finishes
  (terminal `agent_end` or a failed `auto_retry_end` until the final `run-completed`). Sends,
  enqueues, draft creates, and every queue change that can start a Run (resume, `queue-adopt`,
  edit save/cancel, withdrawing a running queue's head) await `settledSessionSettingWrites` inside
  `withForegroundSend` (`mutateMayStartRun`). Locked pickers use `aria-disabled` plus an
  `aria-describedby` reason and take focus back from a list or menu the lock closes.
- Every Host Session already had `$.thinkingLevel` in its execution profile before revision 21
  (written at creation or cutover, and required by `decodeSessionExecutionProfile`), but beta.5 Runs
  used the message's level, so that stored value was stale. Pi's entries hold what each Session last
  ran with. `migrateLegacyThinkingLevels` (`adapters/sqlite-legacy-thinking-level-migration.ts`)
  runs first in `startHostBackgroundServices`, before the Host listens: (1) beta.5's desktop pick
  `settings_store.thinkingLevel` becomes Pi's global default if valid and Pi names none
  (`ThinkingLevelDefaultService.getConfiguredDefault`, unlike `getDefault` which falls back);
  (2) once, gated by the `sessionThinkingLevelsRestored` settings_store marker, every profile's
  level becomes the last projected `thinking_level_change` on its active path
  (`last_active_node_id`, else the newest node, where Pi opens the file), else its stored level,
  else Pi's default. Pi records a level after clamping it to the model, so a restored `off` gives
  way to a higher legacy level (the desktop pick, else the stored level; a desktop pick of `off`
  keeps `off`), and the pick survives a later switch to a reasoning model (`sessionLevel`); (3) the
  desktop pick key is deleted only after both succeeded. Pi restores exactly that
  entry when no level is passed (`sdk.js` `hasThinkingEntry`), but every Run now passes the stored
  level, so without the backfill a Session would silently switch levels on its first Run after the
  upgrade. It is not a ledger migration on purpose: a new migration id raises
  `SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID` and fences older binaries out of the database.
  Failures are logged and retried at the next Host start.
- `sessions:set-thinking-level` publishes `session-list-changed` as soon as the Session write
  commits, then writes Pi's default; a failed default write is logged and never reported as a failed
  Session change (`default-thinking-level-changed` is published only on success).
