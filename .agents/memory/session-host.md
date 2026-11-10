# Session Host

The detached Session Host process: ownership locks and its SQLite database, cutover and
restore, Local Session protocol revisions and capabilities, connection budgets and event
streams, refusal kinds, background work gating, exports, and measured Host stalls.
Load when touching `src/main/session-host/`, Local Session commands or revisions, Host startup,
or Host CPU and event-loop performance.

## What the window reads of a Session is bounded (v1 performance B5/D5/B7, October 2026)

- `sessions:get-tree` returns `SessionTree` with content-free `SessionTreeNode`s (`preview`, `hasMessage`; `contentJson` only for agent-loop audit nodes). The Host and main-process code use `SessionContentTree`/`SessionContentWorkspace` (full `SessionNode`s); the views are built only at the Host UI boundary (`shared/utils/session-data-view.ts`, `host-ui-session-data-operations.ts`). Never read `node.message` from a tree in the renderer; a message's id is its node's id, so use `hasMessage`.
- The workspace path is a window (`transcriptWindow.startIndex > 0` means the Host holds older entries). Anything that needs the whole active path derives it from the tree's parent ids (`buildPiTranscriptPath`), never from `transcriptPath` (`session-tree-panel-rows`, `workspacePathNodeIds`). One-off `api.getSessionWorkspace(id, selection)` calls without a request still get the whole path.
- Reuse depends on `session_control_states.node_mutation_revision`, read before the nodes. Sessions without a control-state row report null and nothing is reused. Appends do not bump it; updates, deletes and inserts into history do (snapshot renumbering of audit nodes does too, so a Run usually resends).
- `api.getSessionDetail` in the renderer is wrapped (`shared/lib/session-detail-reader.ts`): callers always get a complete detail, unchanged messages keep identity. `querySessionControl` joins identical queries made in the same task. Tree/workspace reads coalesce in `session-workspace-reads.ts`: same-task calls join, later calls share one trailing read.
- Project Actions queries are never polled on a timer: runs/preparation poll only while active (or while the scope Session's agent works); everything refetches on focus, and on Host `session-state-changed`/`session-list-changed` only for the changed Sessions' scopes and projects, never discovery (`isProjectActionQueryAffected`). A changed Session the window has not loaded (created in the same batch, a Worker beyond the loaded page) has no known project, so that batch reads every project's non-discovery queries (V1 P3-5). Starting/stopping a run invalidates them.
- The tree filter's Host search (`sessions:search-tree`) returns a cursor (last created order read, node mutation revision); the next search for the same query passes it and, while the revision holds, reads only the nodes appended since (`incremental`). Without it, a query left open read and folded the whole Session's `content_json` on every append of a Run (V2 P3-1).
- A Session open must read one detail and one workspace, nothing else (W10). The detail is bounded to the newest 400 messages (`maxMessages`, `messagesWindow`); never assume `activeSession.messages` is the whole history (count with `messagesWindow.pathLength`, find older messages in the workspace). An unbounded 11 MB detail cost ~500 ms in transport alone: the Host reads and hydrates 3,600 messages in ~20 ms, but frames over 8 MB go out as base64 chunks the main process parses. Duplicate reads came from the read receipt's Host event (now `catalogOnly`), from `refreshSession` refreshing the tree after an open, and from a tree read racing the route's workspace read. Diagnose with an IPC timeline (start/end per invoke on the main clock, aligned to the click) before profiling the renderer.
- Measuring: a large fixture with hundreds of markdown links per message keeps `sessions:resources:backfill` busy for ~600 ms per page on the Host for minutes; use a link-free fixture to measure open latency. Re-opening a large Session is dominated by renderer layout (composer auto-resize `scrollHeight`, transcript `getBoundingClientRect`), not IPC.

## A full outbound budget used to close whichever Host connection sent next (October 2026)

- "Local Session Host connection closed." from a live Host (same PID, no crash or stall logged) was the Host's global outbound byte budget (256 MB, every encode reserving 72 MB) running out while large answers waited unread, typically the desktop main process parsing a 10–20 MB Session detail. The next sender on *any* connection then failed with `LocalSessionOutboundCapacityError` and its socket was destroyed silently: GUI Host UI reads, the desktop poll and the renderer event stream all dropped together, and the GUI's one replay hit the same full budget. Reproduced against a real Host by opening nine connections that request a 13 MB detail and never read; a following `sessions:pins:list` failed in 2 ms.
- The budget now runs encodes in arrival order; one that finds no room waits for a release. After `outboundCapacityWaitMs` (4 s) from its arrival it closes a connection that left a frame unread for 4 s (since its last written slice: frames are written in ≤1 MiB slices so slow but steady readers show progress), preferring one whose bytes alone free enough room, else the one holding most, and waits up to 500 ms for that connection's own bytes before choosing another. It closes none when the stopped connections together could not make room. Otherwise it waits for a release or for a reader to stop, and fails the asker with `LocalSessionOutboundCapacityError` only at `MAX_OUTBOUND_CAPACITY_WAIT_MS` (8 s wall from when the frame was ready), after closing as many stopped readers as it takes in one last 500 ms pass. Do not count that limit from command receipt: Host UI reads (`sessions:get-detail` included), waits and Waggle commands have no client timeout, so a slow command would lose its answer and connection to a full budget at once.
- All of these times are live time (`LocalSessionHostLiveClock`): a 25 ms ticker runs while any frame is held, and time the event loop was blocked (a gap between ticks beyond 50 ms) is not counted, since no socket could be served. Wake-time lateness alone misses stalls inside the window and stalls ended by a release wake. Vitest fake timers do not reproduce a stall: advancing time runs the ticker on schedule, and `setSystemTime` moves `Date` without firing the timers that came due, so stall tests busy-wait with real timers and live in the integration tier (`local-session-outbound-budget-stall.integration.test.ts`) with wide margins.
- Handshake and connection-error frames are sent bounded (`maxBytes` 64 KiB): they skip the turn and the 72 MB reservation and are written while large answers wait, so a full budget never runs a handshake into its 5 s deadline. A bounded frame that encodes larger falls back to waiting.
- Drops log the caller (`peer`), and waits over 1 s are logged, all under `session-host/outbound`. A paused test socket emits `close` only after it is resumed.
- Renderer IPC errors lose their `.code`, so these reach Sentry as `Error: unknown` (unhandled rejection in the GUI process). Never leave a `void api.*()` without a catch; `openwaggle/no-uncaught-void-ipc` (renderer-scoped) enforces it, with `.catch` or a `.then` rejection handler required on every `void` chain rooted at the `@/shared/lib/ipc` bridge.
- IPC errors also lose their stack crossing the preload bridge (Electron rebuilds the `Error`), so a stackless unhandled renderer rejection (`Error: unknown`, `Error: provider-unavailable` — Sentry issue OPENWAGGLE-7, 5 events, all pre-v1.0.0-beta.26) names no call site. The `@/shared/lib/ipc` proxy now wraps every callable it returns so a rejected promise tags the method name (a `WeakMap`, never a property on the error), `rejectedApiMethodOf` reads it, and the renderer Sentry `beforeSend` puts it on the event as `openwaggle.api_method` — a tag scrubbing keeps, so the next event in that class says which API call failed. First tag wins, so a wrapped reader wrapping another wrapped call never renames an error. Breadcrumbs are deliberately off (ADR 0045), so tags are the only context channel.
- `openwaggle/no-uncaught-void-ipc` only guards `void` chains rooted at the bridge import, not `void someStoreAction()`: the Session Host refresh fires `refreshCatalogSessions` with `void`, and its `try/finally` had no catch, so a transient `listSessionsByIds` IPC failure (host socket hiccup) floated as an unhandled renderer rejection — Sentry issues OPENWAGGLE-6 (`Error: unknown`) and OPENWAGGLE-7 (`Error: provider-unavailable`), same call site, two scrubbed codes. Every sibling catalog action (`loadCatalog`, `loadMoreSessions`, `loadHiveSessions`) catches and logs; `refreshCatalogSessions` now does too, and a store-action contract worth keeping is that a `void`-fired action never rejects.
- The same gap bit the Settings writes a second time (OPENWAGGLE-6 recurred 2026-11-09 in v1.0.0-beta.37 tagged `openwaggle.api_method = updateSettings`): five renderer call sites fired preferences/command-palette actions with `void` whose first IPC call was `updateSettings` — the chat route's `setProjectPath`, the composer picker's `setSelectedModel`, the Settings model toggles' `setEnabledModels`, the palette's recent-project `setProjectPath().then`, and its `selectProject` (which `void`s from the item action) — and none had a catch, so each floated the same `Error: unknown`. All five now settle (log, or toast for the palette's direct commands); when adding a `void someStoreAction()` call site, grep for every action that awaits `api.updateSettings`/`api.setEnabledModels` first and catch at the call site.

## The Session Host names every refusal's kind (ADR 0063, November 2026)

- `SESSION_HOST_REFUSAL_KINDS` (`src/shared/domain/session-host-refusals.ts`) is the only place a refusal code gets its error kind. Producers spread `...sessionHostRefusal(code)` into rejected outcomes instead of writing `code:` alone; `session-host-refusal-producers.unit.test.ts` fails on a bare `effect: 'rejected'` literal or an error frame without `errorKind`. `session-host-refusals.unit.test.ts` pins every released code's kind, because moving a code to another kind changes its exit code and needs a major after 1.0.
- Local Session revision 32 (`sessions:refusal-kinds-v1`) added `kind` to rejected outcomes and query errors and `errorKind` to error frames. Mutation outcome schemas decode `kind` exactly, so stored outcomes from before it go through `withStoredRefusalKind` (`sqlite-stored-refusal-kind.ts`) on replay; use `decodeStoredSessionControlMutationOutcome`, never the wire decoder, for stored rows.
- The CLI copies the kind (`session-cli-exit-status.ts`; a refusal without one is `conflict`, a thrown failure without one `internal`). Do not reintroduce guessing from code names; it gave `delegation_workspace_missing` the kind `not_found`. A protocol error without `errorKind` (an older Host's frame) takes the table's kind for its code; `commandFailure` ignores any `errorKind` a thrown failure declares.
- `profile_revoked` and `profile_not_found` mean the caller's own profile (authentication). `access profiles` names a revoked or missing target `target_profile_revoked` (conflict) or `target_profile_not_found` (not_found); `withStoredProfileRefusalKind` maps old stored outcomes on replay.
- Paged reads (`hive export`, `hive read --full`) throw `pageQueryRefusal(outcome.error)`, a `CliError` with the Host's kind, for a refused later page; a plain `Error` there exits 1. The MCP tool words every refusal `code (kind): message` through `openwaggle-mcp-refusal-message.ts`: its handler wraps every Host call (the scope checks' reads too) in `mcpThrownRefusal`, its own grant and workspace checks use `mcpLocalRefusal`, and a scope read treats only `session_not_found` as a missing Session. `session-host-refusal-producers.unit.test.ts` also fails on a `kind:` written by hand beside a `code:`.
- Every CLI envelope `command` is the path after `openwaggle` (`CliEnvelopeCommand`; `update --check --json` prints `update` and is covered because `install.sh` reads its `savedChannel`), and `schedules export` always prints the `scheduled-tasks` envelope; `cli-envelope-command.unit.test.ts` and `schedules-cli-machine-output.unit.test.ts` hold the contract.

## Session Host authority and subscriptions are live boundaries

Project approval grants and revocations must use the same owning Host as project preference
writes. Both update `.openwaggle/settings.json`, and the write queue is process-local. A GUI-local
write can otherwise race a CLI-owned Host and restore a successfully revoked grant. Route both
mutations through the Host's validated application operation, require protocol revision 10, and
retain GUI-only caller authority. A remote Host failure must not fall back to a local write.
Deterministic tests hold a real config rename to verify overlapping writes preserve both changes.

Pre-agent worktree progress is Host-owned run state too. Publish it through the Session Host event
stream, seed the reconnectable stream buffer before `agent_start`, and relay it to renderer windows.
A GUI-local broadcast is invisible when a detached Host owns the Run and cannot survive reconnects.

Session authority stores canonical project and workspace paths as a durable snapshot, then checks
the live Run scope again for long-running operations such as exports. Tests for these boundaries
must use real canonical directories; invented paths exercise rejection rather than the intended
authorization branch.

An Effect tagged error with no `message` field reaches `Effect.runPromise` callers as a
`FiberFailure` whose message is the placeholder "An error has occurred". Every
`LocalSessionCommandAuthorizationError` looked like that in the Hive tool (then named `sessions`), which hid a plain
`target_scope_denied`. Render failures that leave the Host through
`sessionCommandFailureMessage`, and assert the rendered text in tests, not only the error code.

A failed Local Session handshake must not name its code: `profile_not_found` and
`profile_revoked` overlap the authorization codes. `local-session-connection.ts` sends one message
and logs the reason; `sessionCommandFailureMessage` also maps a stray `LocalSessionAuthenticationError`
to that message. The Hive tool and command error frames both render failures through
`sessionCommandFailureMessage`, which falls back to the allowlisted `describeLocalSessionServerError`.

Desktop shutdown needs both a fresh post-drain fence snapshot and the in-flight poll to settle.
Two normal five-second polls exhausted Electron's ten-second quit budget and quarantined the next
GUI after forced cleanup. Keep normal polls at five seconds, but pace draining polls at 100 ms.
The real broker/bridge regression verifies prompt idle shutdown and that active fences still block
the clean receipt. Shortened mock polls alone did not expose this integration failure.

Windows libuv named pipes use the operating system's default security descriptor, which grants
Everyone read access and lets another account occupy a duplex server's read-only connections.
Session Host pipe names therefore rotate after canonical database ownership is acquired, clients
reread the protected endpoint capability while attaching, and the Host applies and verifies a
protected current-user-SID DACL before opening admission. Keep the Windows CI integration test for
this boundary. Named pipes require handle-based `SetSecurityInfo`/`GetSecurityInfo`, using
`CreateFile` with security-metadata rights only. Keep pre-admission rejection active while the
helper runs. Bounded stage diagnostics distinguish helper startup, input, and native API stalls;
Unix unit tests cannot prove live Windows handle behavior or DACL readback.
Use the explicit `System.IO.Pipes.PipeAccessRights.FullControl` mask (`0x001F019F`) in
both the requested pipe descriptor and its readback check: generic access bits are mapped
by Windows and are not a stable readback representation. Require one unconditional,
non-inherited Allow ACE for the current user, a protected DACL, and that exact mask.
Native regression probes must validate later pipe instances without reapplying protection;
descriptor fixtures also check that narrower rights, extra principals and extra rights fail.

After a Windows Host replacement rotates `endpoint.capability`, GUI commands must reread the
protected endpoint before their first dispatch, including non-replayable Waggle, compaction,
attachment, and Local UI mutations. Only replay-safe contracts may retry after an ambiguous
transport failure. Renderer event watches must refresh their retained paths before reconnecting;
Host UI and MCP owner operations use the same refreshed authority. Fence asynchronous GUI route
refreshes by the external configuration/retirement epoch, not the route object's identity, so
concurrent ordinary commands do not invalidate otherwise valid Host UI work.

Restricted event subscriptions are filtered at admission before bounded buffering. Exact Session,
project, workspace, and Hive scopes use a synchronously readable authorized-Session snapshot that
is refreshed on authentication, profile changes, and lineage-producing lifecycle changes. Events
outside that snapshot, or whose event kind lacks the required base or derived capability, consume
no subscriber capacity and expose no cursor advance. Query, subscription, event-envelope, and
resynchronization cursors are fresh authenticated opaque capabilities bound to the caller authority;
they resume statelessly on the same Host without revealing its global sequence or hidden-event gaps.
Restricted replay uses at most 128 LRU authority views, each capped at 256 visible events and 256
KiB, for at most 32 MiB of retained serialized payload and 32,768 envelope references; publishing
therefore performs at most 128 synchronous admission checks. Views retain shared envelope references,
not payload copies. Hidden events never enter a view or advance its expiry floor. Authority-view LRU
eviction, refresh, or revocation expires its cursors and forces attached subscriptions to resynchronize.
Requested Session filters are intersected again for replay and live delivery, but the replay floor is
authority-wide: traffic from another Session visible to that authority may expire a narrower consumer.
Per-event live authorization still refreshes revocation, capability, and derived grants, but must
not rebuild the filesystem/workspace/catalog admission snapshot for every streamed token. An
admission refresh explicitly invalidates existing streams; clients resynchronize from canonical
state or retained replay rather than silently losing events that race the fence.

A lineage-producing lifecycle command must release its issuing socket's admission reader after the
mutation commits and before it refreshes every profile admission. Refreshing while the command still
holds that reader fences and waits on itself, eventually disconnecting the CLI after a successful
create, fork, launch, or spawn. The release hook is idempotent, input on one socket remains serialized,
and the global refresh still completes before the lifecycle response is written or a new Run starts.

Paginated active-branch exports must pin the selected branch head on the first page and carry that
immutable node through every continuation. Re-reading `session_branches.head_node_id` per page lets
concurrent tree navigation silently truncate or mix the exported artifact.

## A slow Host must not end the GUI's event stream (October 2026)

The GUI renderer bridge (`session-host-renderer-recovery.ts`) is the renderer's only source of
live Session events. It used to stop for good on any `retryable: false` protocol error, and the
Host's connection-level `fail()` marked every failure non-retryable, `handshake_timeout`
included. One Host stall of 5 s or more during a reconnect froze every Session until restart.
Both "subscription stopped after a terminal failure" lines in the beta.3 GUI logs were followed
by a user restart; the many recovered "degraded" retries were not. Now nothing stops the pump,
neither a watch nor an `ensure` failure: an older Host still reports `handshake_timeout` as
non-retryable from the `ensure` probe. After 10 consecutive failures it retries every 30 s and
logs one error; warnings are logged at attempts 1, 2, 4, 8, and so on. The backoff resets only
once a subscription delivers past its snapshot or stays up 10 s, so a fail-after-subscribe loop
cannot spin at 250 ms. `handshake_timeout` is retryable, and the Host-wide authentication throttle
reports `authentication_throttled` (retryable) instead of `authentication_failed`.
`LocalSessionHandshakeDeadline` re-arms when its timer fires late, at most 3 times, because after a
stall Node runs expired timers before it reads sockets and a buffered hello looked late, and it
gives a received hello one more period to authenticate. A caller whose authentication finishes
after the deadline expired is not admitted, or it would hold a client liveness owner forever.
`local-session-server-handshake-stall.integration.test.ts` reproduces these cases with a
busy-wait. Host and GUI both run `startEventLoopStallMonitor` (stalls of 1 s or more, at most one
log per 10 s, plus a trailing summary of folded stalls). The Host's report includes the oldest and
newest in-flight command names and liveness owners, so the next stall names its process. The stall source itself was not
reproduced. Measured against a 565 MB user DB copy: `persistSessionSnapshot` took at most 0.21 s
(7,929-node Session), `getSessionTree` 0.14 s, lexical search 0.37 s, and a WAL commit 30 ms under
heavy I/O, so SQLite work does not explain multi-second stalls. Pi's Bedrock tool-call streaming
reparses the whole partial JSON on every delta, which is quadratic: a 190 KB call costs 3 to 11 s
of CPU. The largest stored assistant message was only 38 KB, though. The pi-ai patch now rate-limits
that parse (`parseStreamingToolArguments` in `dist/utils/json-parse.js`, used by the delta paths
of Bedrock, Anthropic, OpenAI Responses/Azure/Codex, OpenAI Completions, Mistral and the
`pi-messages` client): every delta up to 8 KiB, then after 1/8 growth or max(50 ms, 10x the last
parse time). A block's `arguments` therefore lag its raw JSON, and every terminal path must parse
the full JSON itself: block stop, `done`, `error` and abort. Streams can end normally without
closing the tool block (Anthropic `message_stop` without `content_block_stop`, Responses
`response.completed` without `output_item.done`, Bedrock without `contentBlockStop`, pi-messages
`done` without `toolcall_end`); the first patch missed the Anthropic and Responses success paths,
so a `write` tool ran with 63,536 of 65,562 bytes. `finishStreamingToolCalls` now closes those
paths, and `pi-streaming-tool-arguments-terminal-paths.unit.test.ts` streams every patched
provider through a loopback server, ending normally without a close and failing after the
deltas, and checks the final arguments are exact. Any new provider path that pushes `done` or
`error` needs the same. A 217 KB call in 20-byte deltas
went from 14.5 s of parsing (10,884 parses, 4.5 s event-loop lag end to end) to 51 ms (436
parses, 48 ms lag). `pi-bedrock-streaming-tool-arguments.unit.test.ts` drives Pi's real Bedrock
stream against a loopback AWS event-stream server (`bedrock-event-stream.test-utils.ts`).
OpenWaggle's own projection copied the whole input into every `toolcall_delta` transport event,
and each copy is stringified for the Host socket, parsed by the GUI, cloned over IPC, and
re-stringified by the renderer: about 1.2 GB for that one call. `emitToolCallDeltaUpdate` now
emits a `toolcall_delta` only when Pi replaced the call's `arguments` object (a re-parse); held
raw deltas ride on the next emitted event, and the tail after the last re-parse is superseded by
`toolcall_end`'s exact input. That cut it to 436 events and 4 MB (renderer apply 830 ms -> 4 ms).
A Pi provider that mutated `arguments` in place would freeze the live preview until the call ends.

## Session Host stalls had measurable sources: unindexed foreign keys and leaked abort listeners (October 2026)

A live CPU profile of the packaged Host (`kill -USR1 <session-host pid>` opens the inspector on
127.0.0.1:9229, since no Electron fuse disables it; record with `Profiler.start/stop` over the CDP
WebSocket and close it again with `inspector.close()`) found the multi-second stalls the earlier
investigation could not reproduce. The two longest (3.9 s and 2.9 s) were single synchronous
better-sqlite3 statements during `sessions:delete`. `session_nodes.parent_id` is a self-referencing
`ON DELETE CASCADE` key with no index, so every node delete scanned all of `session_nodes` (750 MB,
182k rows in a 1.2 GB user database): about 170 ms per node, 160 s for a 770-node Session, and the
same per node that snapshot reconciliation drops during a Run. 31 other foreign-key child columns
had no index either; migration 64 (`session-host-foreign-key-indexes`) adds them all, where the
table exists, and `database-foreign-key-indexes.integration.test.ts` fails on any new unindexed
foreign key. The same cascade recursed once per transcript depth, so a Session deeper than about
1000 nodes (34 in that database) could not be deleted at all ("too many levels of trigger
recursion", surfaced as "related durable state still depends on it"); `deleteSessionRow` detaches
`parent_id` first.

The other hot spot was Effect's `runPromise(effect, { signal })`, which adds a `{ once: true }`
abort listener and never removes it. A Session `wait` re-resolves its caller on every target event
(streaming deltas included) with one long-lived signal, so listeners piled up and Node's
`addEventListener` duplicate scan made each add slower (40,000 adds took 36 s). In a 20-minute
profile it cost 11.7 s. Use `runEffectWithAbortSignal` (`src/main/utils/`) whenever the signal can
outlive the run. A promotion also held the Session's attachment transition while its steer waited
for durable delivery, which lasts until Pi's next turn boundary, so queue changes waited minutes (a
promote 259 s, a follow-up 214 s); `releaseSessionAttachmentTransitionWhile` steps aside for that
wait, which is safe because a pending promotion durably reserves the queue (`follow_up_reserved`).
Stepping aside from the transition alone deadlocked (#324): the promotion still held the Session's
command serialization, a Follow-up sent meanwhile took the transition and waited on the
serialization, and the delivered promotion waited on the transition, so the Run stayed "Finishing…"
until the Host restarted. It now also steps aside from the serialization
(`releaseSessionCommandSerializationWhile`), released outermost so the transition is taken back
first and the serialization last, in the dispatcher's lock order. Commands admitted meanwhile must
be safe against the pending promotion: queue changes that could move or remove the item and a second
promote of it are refused, `replace` and an explicit Waggle replacing the Run
(`replaceWithExternal`) are refused with `follow_up_reserved` (a replace holds both locks while
waiting for the Run to settle, settlement retries a pending promotion only about 1 s, and the item
then stayed queued after being steered), and the promotion reports the revisions of the final state
(`outcomeForFinalState`), since a Follow-up queued meanwhile bumps both, and releases the
Follow-up's attachments only when the journal recorded the promotion. The renderer's Follow-up queue
read used `staleTime: Infinity` with the app default `retry: false`, so one read that timed out
during a stall kept "Follow-up queue unavailable" up until a manual Retry; it now retries and
re-reads every 5 s while failing. Remaining Host CPU in that profile came from Pi's synchronous
skill and extension resource scans (`loadSkills`, `collectSkillEntries`, jiti), spread out rather
than one long stall. An earlier
4.4-hour Host silence (desktop heartbeat failing every 5 s, no Host log lines, no crash report,
machine awake) stayed unexplained.

## Run settlement blocked the Host for seconds: per-node discovery rebuilds and inline WAL checkpoints (#357, October 2026)

Every beta.25 "Session Host event loop stalled" line (1.6 to 3.5 s) ended 20 ms before a Worker
Run's `session_runs` row settled. Reproduced by persisting real Worker snapshots (200 to 417 nodes)
into a copy of the 2.1 GB user database: `persistSessionSnapshot` blocked 2.4 to 4.1 s and resource
capture another 0.2 to 0.6 s, each as one synchronous stretch. Causes, in order of cost:
- `session_node_search_insert`/`_update`/`session_node_discovery_search_delete` rebuilt the Session's
  lexical discovery row per node, and that row's insert trigger rebuilds its term postings and
  signatures (about 9 ms a node on that database; 97% of the snapshot). A Worker's first snapshot
  inserts all of its Run's nodes at once. Migration 72 guards the rebuild with
  `session_lexical_discovery_deferrals`; `withDeferredLexicalDiscoveryRefresh` holds a row during
  snapshot reconciliation and rebuilds once. Any other writer still rebuilds per node. The deferral
  row only lives inside the snapshot's transaction. The trigger list itself creates the table
  (`CREATE TABLE IF NOT EXISTS`), because migration 50 and the baseline recreate the triggers too.
- SQLite checkpoints inside the commit that grows the WAL past 1,000 pages: 200 to 500 ms on that
  database, usually the snapshot commit. `runWalCheckpointBackground` (Host only) sets
  `wal_autocheckpoint = 0` once a worker thread with its own better-sqlite3 connection (same addon,
  so one SQLite library and its POSIX locks; never `node:sqlite` for the same file) runs PASSIVE
  checkpoints every second. If the worker cannot start or stops, autocheckpoint goes back to 1,000.
- better-sqlite3 is synchronous and Effect resumes fibers through microtasks, so a chain of
  statements never lets sockets or timers run. `makeEventLoopSlicer`/`yieldToEventLoop`
  (`src/main/utils/event-loop-slice.ts`) return to the event loop via `node:timers` `setImmediate`
  (test fake timers do not replace it) between node writes, term-index steps and captured messages.
  Yielding inside `sql.withTransaction` is safe: other fibers wait for the connection semaphore.
After: the longest stretch was 36 to 116 ms with ten Workers loading the machine (load average 15),
the longest single statement (the one discovery rebuild of a 591-term objective) 20 to 40 ms in the
sqlite3 CLI. A fresh APFS clone (`cp -c`) of the database has a cold page cache, so the first
measurement on a clone reads high.

## Large-profile Host CPU: embedding on the main thread, unsliced term repair, backfill rework (v1 perf W5b, October 2026)

On a copied 1,800-Session / 300k-node / 1.4 GB profile the Host listened at 50-85 s and then stayed
at 100% CPU. Found with a Host started on an APFS copy (`session-host-internal` as argv[0] after the
app path; `--inspect=<port>` must come after it or `applicationCliArguments` treats it as the
command), native `sample`, and a SQL-timing wrapper patched into the built bundle only:
- The pegging is semantic embedding: onnxruntime-node's `InferenceSessionWrap::Run` is synchronous on
  the Host's JS thread (stalls of 58-88 s, `livenessOwners: {semantic-preparation: 1}`), handed to W7.
- Transcript-term repair ran Session after Session with no event-loop turn: 50 s straight. It now
  rebuilds in bounded steps (`session-transcript-term-sliced-rebuild.ts`, ADR 0037 amendment).
- Resource backfill re-parsed every message's Markdown 3-4 times per call and once per 32 captured
  links, and hydrated each captured resource with a recursive active-path walk. A text-keyed parse
  cache and skipping the walk when occurrences fit the preview: 115.8 s to 25.8 s for 16k links.
- A Host started without a client exits after ~10 s if no liveness owner holds it
  (`hasAcceptedClient` timer in the Host entry); keep a client or work attached when profiling.
- Pragmas (`cache_size`, `mmap_size`) showed no difference beyond noise on macOS with a warm page
  cache; not changed. Residual per-node trigger cost with the lexical deferral is ~0.1 ms (FTS).

## Filed under "MCP Runtime Memory"

- Embedding never runs in the Session Host (D3): `MultilingualE5SessionEmbeddingModel` sends batches to a child (`session-embedding-process.ts`: Electron as Node, `getSafeChildEnv`, `serialization: 'advanced'`, ORT `intraOpNumThreads: 2`) that exits 60 s after its last batch or on `dispose()`. On disconnect the child kills itself with SIGKILL, not `process.exit()`: a normal exit after the model loads runs onnxruntime-node's static `Ort::Env` destructor, which throws (`mutex lock failed`) and SIGABRTs, and macOS showed an "OpenWaggle quit unexpectedly" dialog every time the child went idle (beta.29). The child's `uncaughtException` and `unhandledRejection` handlers also write the error to stderr (the parent keeps the tail) and SIGKILL, never the default exit, and survive an error that cannot be converted to a string. A worker thread does not work: after `pipeline.dispose()` and `worker.terminate()` the process RSS stayed at ~730 MB. In-process inference held 1.2 GB and stalled the loop ~950 ms per batch of 32 on the large profile; the child keeps Host RSS ~95 MB with p99 loop delay 12–21 ms. Discovery re-embeds a Session only once its queue row is 15 s old (`settleMs`).
- Host background work (A-F9, decision 4): `hostBackgroundGate` (`application/host-background-gate.ts`) is open until `installHostIdleSlim()` enables it at Host start; then discovery, semantic/transcript projection and term repair wait until a client or a Run (`SessionHostLiveness.acquire('client' | 'run')`, `clientAttached` / `runStarted`) has been present 5 s, and pause while none is, so a headless Host still indexes Sessions a CLI Hive or Scheduled task creates. 2 s after the last one leaves, and at most once per `HOST_IDLE_SLIM_MIN_INTERVAL_MS` (60 s, since each short CLI command attaches and leaves), slim hooks close idle Sessions' MCP connections (`closeIdleSessions`, Runs keep theirs), end the embedding child, and run a V8 gc (`--expose-gc` via `v8.setFlagsFromString` + `vm.runInNewContext('gc')`). The embedding child must answer within 120 s of its last answer while batches wait (`SESSION_EMBEDDING_REQUEST_TIMEOUT_MS`), or it is killed and the batches fail.
- Background work also gives way to clients (W12): every non-long-poll Local Session command (`LocalSessionInflightCommands.track` tells the gate) holds `whenForegroundQuiet()` until it ends plus 50 ms, for at most 1 s per wait; a command older than 2 s stops holding. Background passes yield with `yieldToHostForeground` / `awaitHostBackgroundTurn` (`application/host-background-turn.ts`), never inside a transaction. An event-loop yield alone was not enough: better-sqlite3 runs on the Host thread and Effect SQL serializes on the connection, so each statement of a request waited behind a ~30 ms repair slice and a Session open took 1.1–2.2 s while the term repair ran. Perf warm templates are warmed without a client, so the repair runs in every measured launch 5 s after attach.

## Filed under "Renderer And Session Memory"

- Snapshot `created_order` values are not stable per node. Pi entries use their Pi index, and every snapshot renumbers durable agent-loop nodes (`:agent-loop:` ids) after them. So a turn that adds fewer Pi entries than a Session has agent-loop nodes shifts them onto slots that other rows still hold. SQLite checks `UNIQUE (session_id, created_order)` row by row, so in-place rewrites failed with `SQLITE_CONSTRAINT_UNIQUE` ("This response couldn't be saved" in Hive Workers driven by follow-ups). Node reconciliation now parks moving rows at negative orders first. Any change to node rewriting must survive `session-snapshot-created-order-shift.integration.test.ts`, and the park predicate is unit-tested in `snapshot-node-reconciliation.unit.test.ts`.
- That same `created_order` instability breaks readers that assume append-only ordering, in two different ways. `session_resource_backfill_state.through_created_order` is a durable monotonic high-water mark and its page reads `created_order > cursor`, so once agent-loop nodes are renumbered above new Pi entries, those Pi entries land below the cursor and their resources never enter the catalog. The tree-scoped `hive items` high-water mark is captured per query, so there the same instability only skews an in-flight pagination rather than permanently dropping rows. Both are pre-existing, not fixed by the parking change; the real fix is a stable ordering for non-Pi nodes.
- Session Host authority uses an OS-held exclusive lock in a dedicated persistent `<databasePath>.ownership.sqlite` file. Never delete or replace this file during ownership or recovery. SQLite releases the lock on process death and retains it during synchronous cutovers with no JS heartbeat. An authenticated older Host draining for upgrade must close before replacement.
- OpenWaggle opens its own SQLite files (Host database, cutover staging/legacy/recovery copies, ownership locks) with better-sqlite3 only, through the Host's Effect connection or `openHostSqliteDatabase` (#371). POSIX locks belong to the process, and each SQLite library carries its own copy that does not see the other's locks: a `node:sqlite` reader that opened and closed the live database inside the Host let another process take the write lock while the Host was writing (reproduced in WAL mode; `host-sqlite-database.integration.test.ts` guards it). The upgrade-blocker check (handshake `host_upgrade_pending`, `host stop` count) now reads through `input.runEffect`, so it waits on the Host connection's semaphore behind a running transaction. `check:repository-standards` (`scripts/standards/sqlite-library.ts`) rejects other SQLite libraries under `src/`, `scripts/` and `packages/`, including Worker source strings; only `src/main/browser-import/` (browsers' own cookie databases) may use `node:sqlite`. Differences that bit the port: better-sqlite3 requires every `?` to be bound (node:sqlite binds missing ones as NULL), rejects multi-statement `prepare`, booleans, and `.all()`/`.get()` on statements that return no rows, returns `Buffer` blobs, waits 5 s on a busy lock by default (`openHostSqliteDatabase` passes `timeout: 0`, which the ownership lock needs), and `close()` returns the database, not `undefined`.
- Pre-cutover restore must stage the recovery database copy before installing the legacy source path, then roll back the preserved active database on any copy or cutover failure. Install the source without replacing an occupied path, and remove that path on rollback only when this restore created it. A failed copy after renaming the active database otherwise leaves the canonical path missing.
- Detached startup's 10-second orphan check applies only before the Host has accepted any authenticated client. Record adoption monotonically in liveness; a later GUI restart gap must follow the configured idle grace, not the startup deadline. A one-time owner-count check killed already-adopted Hosts during otherwise clean GUI restarts. The real CLI regression authenticates once, disconnects for 12 seconds, and checks that the same Host still answers. Never-adopted, ownerless Hosts must still stop at the orphan deadline.
- QA profile cleanup removes private data while ownership is held and retains the tiny ownership-file skeleton permanently. Preserve its exact SQLite `-journal`, `-wal`, and `-shm` companions too: exclusive locking can retain an open rollback journal after COMMIT, and unlinking it fails with `EBUSY` on Windows or removes a live SQLite file on POSIX. Let SQLite manage those files. Cleanup must not unlink the ownership inode or its companions after release either: a successor may already have acquired them. Similar-prefix files and the transcript database's separate journals are not part of this preserved skeleton.
- Export recovery must not scan history or touch artifacts before the Host listener opens. Capture a rowid watermark, fence execution claims, and recover bounded source-row pages in a scoped background worker. A cancelled page retains cleanup receipts; Host drain stops retries and releases the recovery lease.
- Selected-path export checkpoints use revisioned, resumable repair with bounded source reads and checkpoint writes per transaction. Yield between batches and preserve cancellation; never expose a partly rebuilt revision. Semantic scope reuse and refresh must be atomic, including policy shrink and expired-lease eviction.
- The attached GUI uses isolated in-memory persistence. Workspace authorization and visualization ownership must read the authoritative Host, not GUI-local Session repositories. Root checks use indexed exact lookups with bounded legacy-alias pages; a failed or retired Host never authorizes a fallback from stale local data. Client visualization reads must not recover deletion tombstones, because only the owner knows which deletions are active. Serialize owner preparation and staged deletion per Session, independently of the Pi tree writer so active-run visualizations can still load. Canonical Host deletion must perform visualization cleanup; an IPC-only wrapper is bypassed by remote routing. Its protected finalizer also publishes deletion invalidation after cancellation. Projection errors can follow a committed database deletion, so probe owner existence before restoring staged files; a failed probe keeps files quarantined for owner recovery.
- Local Session command transport timeouts must cover the operation's declared long-poll window plus a response grace period. The default 10-second socket timeout is correct for ordinary commands but must not truncate `wait`, `exports-wait`, or freshness-blocking search requests that legitimately wait longer. Steer and Promote may await automatic compaction; like manual compaction, they have no default response deadline, while preserving an explicitly requested client deadline.
- Local Session revision 22 (`events:run-snapshot-content-v1`): active Run snapshot text and reasoning parts carry `contentIndex` so the Host buffer splits an answer the way the live view does, and reconnect merges match parts by identity (tool id, stepId) instead of position. Parts are exact-decoded, so revision-21 clients are refused at the handshake rather than failing on a snapshot. `degraded.messageCutShort` says whether the caps cut the streaming message, because `omittedBytes` is Run-wide; the run-level flag made every later answer look degraded.
- Every field the Host buffer puts on an active Run snapshot part must be in the client's exact decoder (`messagePartSchema` in `local-session-snapshot-parts.ts`, used by `local-session-active-run-snapshots.ts`). Pi 1.2.0 (#303) made the buffer record a codemode call's nested calls as `nestedCalls` on its tool-call part (`ToolCallResult` allows it too), and the decoder did not list it. The first active Run that used codemode made `decodeActiveRunSnapshots` throw, which failed the whole renderer-bridge subscription; it retried every 30 s into the same snapshot, so no Session received live events (transcripts on "Thinking...", rows on "Connecting") while Runs finished in the Host. Log signature: `[session-host/renderer-bridge] Remote Session Host renderer connection is degraded` with a schema path ending in `["nestedCalls"] is unexpected`. Since #308:
  - Type tests (`local-session-snapshot-parts.unit.test.ts`) hold the keys of each `messagePartSchema` member and of the attachment, tool-call and tool-result records to `MessagePart`'s, and `MessagePart` must extend the decoded type so a widened literal fails too; `@shared/schemas/nested-tool-calls` is checked two-way against `NestedToolCalls`, and session-details hydration reuses it. The same audit found `AttachmentRecord.browserPreview` missing from the snapshot decoder.
  - Only a snapshot without a Run identity fails the decode, because the bridge reads a Session missing from the snapshots as a settled Run. An undecodable streaming part is left out, counted in `degraded.omittedBytes` and marks the message cut short; an earlier assistant message holding one is left out; undecodable user messages, activity events or worktree launch are left out. Each is logged by `session-host/run-snapshots` with sessionId, runId and the failing schema paths and issue tags only (`getParseIssuePaths`): Effect issue messages embed the failing value, which is transcript or tool content.
  - Live events had the same failure: a failed subscription resubscribes after the same cursor and the Host replays the same event. `decideSessionHostEvent` relays a `message_start` without a user message it cannot decode, skips any other undecodable event past its cursor (`onCursor`), and fails only on an event without a cursor. Logged by `session-host/event-client` with kind, sessionId, event type and sequence.
  - No Local Session revision bump for this kind of fix: the Host already sent the field under revision 24, the client was catching up. Bumping would only turn old clients' hang into a handshake refusal and make the fixed GUI refuse a still-running beta Host.
- Local Session revisions are assigned in merge order, not branch order. Title regeneration (ADR 0043) landed on main as revision 20 while the Follow-up edit and Session settings branch also used 20; the branch moved to 21 (`LOCAL_SESSION_REVISION_21_CAPABILITIES`, `HOST_UI_REVISION_21_REQUIRED_CHANNELS`). When syncing a branch that bumped `LOCAL_SESSION_CURRENT_REVISION`, keep main's number and renumber the branch's constants, capability list, channel list, the revision checks in both `local-session-command-revision.ts` and `local-session-client.ts`, and every `[N]` in `src/main/session-host/__tests__/*revision*` and the negotiation test (including the future-client `[N+2, N+1]` case).
- The v1 performance branch's bounded Session reads (`LOCAL_SESSION_SESSION_DATA_REVISION`, `host-ui:session-data-v1`, `HOST_UI_REVISION_29_REQUIRED_CHANNELS`/`_ARGUMENT_COUNTS`) were revision 28 on the branch and became 29 when main shipped Heartbeat efficiency as 28 in beta.28. Its migrations 80–83 already sorted after main's 75, so only the ledger identity list needed 75 inserted before them. Ledger-reading migration tests bound their `_migrations` query above (`id <= <their migration>`) so later migrations never change what they expect.
- The desktop window's `AppDatabase` is client-isolated (`configureAppDatabaseAccess('client-isolated')` in `main/index.ts`), so any window-side `typedHandle` that reads `SessionProjectionRepository`, `SessionResourceRepository`, `SessionOutputRetryRepository`, or calls `SettingsService.update` silently sees an empty database or writes into one that disappears. That broke the Change request inspector ("This change request does not belong to the opened Session." on every open), merges, and every Session-scoped Commit/Push/Create PR from the Session Summary, whose Outputs were also lost (ADR 0048). Unit tests did not catch it because they run in owner mode. The fix pattern: a revisioned Host UI channel (`hostHandle`, or `invokeConfiguredHostUi` with a local fallback when the route is not configured) and, for window-side orchestration that relays a Host result, `relayingHandle` + `RelayedHostResult` instead of a cast. Settings reads from window-side services go through `invokeConfiguredHostUi('settings:get')`; source-control writes go through the Host's atomic `source-control:patch-settings`, as `makeSourceControlSettingsAccess` does (other settings use `settings:update`). Reproduce such bugs against `bun run dev:debug` (set `OPENWAGGLE_QA_CDP_PORT` if 9223 is taken) by driving `window.api` over CDP, not with unit tests.

## Filed under "Access Modes And Authorization Memory"

- Unknown IDs: `answerMissingTarget` (`application/local-session-missing-target.ts`) wraps the
  non-GUI dispatcher and turns the target repository's `session-not-found`/`delegation-not-found`
  into the contract's own refusal (`outcome.error.code` or a rejected outcome). Existing but
  out-of-scope IDs stay `target_scope_denied` on purpose (random IDs, no enumeration oracle).
  `delegations-list`/`-conflicts` filters are authorized like `read`
  (`local-session-delegation-filter-authorization.ts`): before, an unscoped query skipped them.

## Filed under "Tooling Memory"

- The detached Session Host (ADR 0030) runs agents with its console on `/dev/null`; it writes `openwaggle-host-YYYY-MM-DD.log` beside the GUI log (ADR 0037). Look there for run and persistence failures, not in the GUI log. Tagged Effect errors such as `SessionProjectionRepositoryError` have an empty `message`; format them with `describeError`, which follows `cause` through `FiberFailure`.

## Filed under "Expired provider credentials, refused Title models, empty legacy files (#357, October 2026)"

- Log lines carry `HH:mm:ss.mmmZ`. Each entry records its time when it is logged, and the
  buffered batch (written on the next tick) goes to the file of each line's own UTC day: stamping
  and routing at write time put a 23:59:59.999Z line into the next day's file with the flush time.
  Logger tests must fake `Date` while they assert; one that restored real timers first passed only
  on the day it was written.
