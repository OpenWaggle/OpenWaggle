---
title: "Hive CLI"
description: "Coordinate, discover, control, watch, and export OpenWaggle Sessions from a terminal or another agent."
order: 5
section: "Developer docs"
---

Use `openwaggle hive` to find conversations, start work, send follow-ups, review Workers' Delegations, or export a transcript from a terminal. The commands operate on the same sessions you see in the desktop app.

The CLI, the agent's native `hive` tool, and the `openwaggle_hive` MCP tool share one vocabulary: every tool action is a `hive` subcommand and an MCP operation of the same name, with `-` for `_`. The exception is Scheduled tasks, which have their own [`openwaggle schedules`](/docs/using-openwaggle/scheduled-tasks) command. The tool's `follow_up` is `openwaggle hive follow-up`, `delegation_accept` is `openwaggle hive delegation-accept`, and `agent_definitions_search` is `openwaggle hive agent-definitions-search`. Before 1.0, these commands were `openwaggle sessions`, `openwaggle delegations`, and `openwaggle agents list|search`; those names no longer work. `openwaggle agents` still validates, imports, explains, and edits definition files.

The CLI talks to the local Session Host, the process that owns saved sessions and agent execution. It does not open the database directly. Commands can start the Host when needed, and accepted runs continue when the GUI closes.

An agent hosted by OpenWaggle should use its native `hive` tool. The CLI is for people in a terminal and agents running in other tools. Both paths create the same durable Sessions; a CLI-spawned Worker appears in the Hive panel and Session Summary.

For opening the app, `openwaggle run`, `openwaggle status`, and the full command list, see [Command line](/docs/developer-workflow/command-line).

The installed app includes the CLI. On macOS and Linux, packaged app startup installs or refreshes its managed command at `~/.local/bin/openwaggle`; make sure `~/.local/bin` is on your shell's `PATH`. OpenWaggle never overwrites an unrelated file at that path, so resolve a path conflict explicitly if the command is unavailable. The Windows installer manages the command. From a source checkout, use `pnpm cli:dev -- <command>`.

## Start with an existing session

From your repository directory:

```sh
openwaggle hive list
openwaggle hive read <session-id>
openwaggle hive status <session-id>
openwaggle hive follow-up <session-id> --text "Summarize the remaining work. Do not edit files."
```

Replace `<session-id>` with an ID returned by `list`, or with a session link copied from the desktop app (`openwaggle://sessions/<session-id>`). Every session ID operand accepts either form, and so do `--target` and `--worker` on `report`, the `delegations-list` and `delegations-conflicts` filters `--parent` and `--worker`, and the `access` scopes `--session` and `--hive`. The first three commands inspect state. The last sends a new task: it starts when the session is idle or waits behind its active run. Inspect the target before sending messages, since they can cause the agent to use tools.

Use [Create and communicate](#create-and-communicate) to start a new session. For independent Workers and shared-workspace risks, read [Hives and sessions](/docs/using-openwaggle/hives-and-sessions).

## Discover and read

```sh
openwaggle hive list
openwaggle hive search "authorization migration" --mode hybrid
openwaggle hive search "semantic session host" --mode semantic --all --json
openwaggle hive read <session-id>
openwaggle hive read <session-id> --full --jsonl
openwaggle hive turns <session-id> --limit 50
openwaggle hive items <session-id> --after 200 --limit 100
```

List and search default to the current working path. Use `--project <path>` for the repository project or `--all` for the complete authorized catalog. Hybrid search combines indexed lexical relevance and semantic similarity. `--require-fresh` waits for the current semantic projection instead of returning a readiness marker.

Lexical multiword searches match all tokens anywhere in one Session. Wrap the complete search text in literal double quotes when word order and adjacency are required within one transcript item, for example `openwaggle hive search '"authorization migration"' --mode lexical`. Quoted phrases never join text across message or tool-event boundaries, so every phrase result can identify one matching item.

`read --full` streams a stable high-water-mark snapshot page by page, so an agent can retrieve the complete transcript without accumulating it in memory. Pages are bounded by both record count and encoded bytes; a Session with large messages therefore produces smaller pages automatically. A single pathological record that cannot fit in one bounded response fails with `record_too_large` instead of crashing the Host. Machine consumers should use `--json` for one response and `--jsonl` for streams.

Single-response commands with `--json` use a schema-versioned `type: "response"` envelope on stdout and place the command result in `result`. This includes a structured rejected outcome returned by the Host; the response remains available on stdout while the process uses its matching nonzero exit class. Command streams such as `read --full`, `watch`, and `exports-watch` use `--jsonl`; every stdout line has `type: "record"` and places the stream value in `record`.

A failure that aborts before a structured command result is available produces a schema-versioned `type: "error"` envelope on stderr. This covers usage validation, authentication or authorization protocol failures, transport failures, and internal errors. This is different from a structured rejected response on stdout.

```json
{"schemaVersion":1,"type":"response","command":"list","result":{"contract":"session-query-v2","response":{"contractVersion":2,"requestId":"request-1","outcome":{"operation":"list","sessions":[]}}}}
{"schemaVersion":1,"type":"record","record":{"kind":"cursor","cursor":{"hostInstanceId":"host-1","sequence":42}}}
{"schemaVersion":1,"type":"error","error":{"kind":"authorization","message":"An error has occurred"}}
```

Ordinary search defaults to hybrid mode over the discovery projection and requires `sessions:discover`. `search --full-transcript` defaults to lexical mode, can inspect older transcript content, and additionally requires `sessions:read`; discovery-only profiles cannot use it. Pass `--mode semantic` or `--mode hybrid` explicitly when semantic transcript matching is useful. Those modes lazily prepare durable node embeddings only for the authorized query scope, up to 1,000 sessions. Use `--require-fresh --timeout-ms <ms>` to wait for every node admitted by the bounded semantic-storage policy.

Semantic transcript storage is a local, rebuildable cache rather than the authoritative transcript. It retains at most 5,000 recent searchable nodes per Session, 50,000 node records and 64 MiB of vectors in total, and 10,000 queued nodes. Inactive scopes expire after seven days and are reclaimed least-recently-used; an active prepare, wait, or search holds a durable lease and cannot be evicted. When a Session or the active authorized scope exceeds a limit, readiness becomes `partial` with exact counts and a reason instead of waiting forever. Semantic-only search may use the available partial projection, while hybrid search reports `semantic_partial_coverage` and uses the complete lexical index. The discovery window is marked truncated. `read --full` and lexical full-transcript search remain complete and are not limited by this semantic cache.

Single-term and quoted full-transcript matches identify the matching transcript node, Run when known, and durable order. An unquoted multi-term match may aggregate terms across several transcript items; in that case it identifies the Session without pretending that one item contains the complete query. The searchable transcript projection includes visible user and assistant text, attachment names, tool names, compact success/failure outcomes, summaries, and visible OpenWaggle orchestration messages. It never indexes raw node JSON, reasoning bodies, tool arguments, textual tool results, or extracted attachment bodies. Empty internal nodes are skipped.

## Create and communicate

```sh
openwaggle hive launch . --text "Plan the migration" --workspace current
openwaggle hive spawn <parent-id> --expected-run <run-id> \
  --text "Implement the storage slice" --workspace new-worktree
openwaggle hive follow-up <session-id> --text "Run the integration tests"
openwaggle hive steer <session-id> --expected-run <run-id> \
  --text "Also preserve the old API contract"
openwaggle hive replace <session-id> --expected-run <run-id> \
  --text "Stop and use the revised design"
```

Use exactly one of `--text`, `--stdin`, `--input-file`, or `--request-json` for message input. Attach files with repeatable `--attach`. `create`, `launch`, and `spawn` accept `--agent`, `--model`, and `--thinking`; `--thinking` sets the new Session's starting thinking level. `launch` and `spawn` also accept `--yolo` when the resolved authorization ceiling permits it. Workspace flags depend on the operation; use `hive help` for the accepted choices.

The thinking level is a Session setting, like its model. `message` and `start` accept `--thinking` only when the Session is idle and the command starts a Run. The level then becomes the Session's thinking level for that Run and later ones, but it never changes the desktop default for new Sessions. In the same way, `message` and `start` accept `--authorization` or `--yolo` only when they start a Run on an idle Session. The override applies to that one Run, is capped by your authorization ceiling, and is never saved as the Session's mode. While a Run is active, a `message` that would be queued is refused with `thinking_level_requires_idle_session` or `run_authorization_override_requires_idle_session`. `follow-up`, `steer`, and `replace` never accept these options, so a queued Follow-up always runs with the Session's settings when it starts.

Use `message` when adaptive start-or-queue behavior is wanted. Use `follow-up` when the message must become a separate next Run, or `steer` when it must enter the current Run. A Follow-up remains queued while a Run is active; if that Run settles just before admission, the Host starts the Follow-up as the next Run instead of stranding it. Run-targeted mutations require `--expected-run`; stale callers fail instead of steering or interrupting the wrong Run.

Profiles that use `replace` need both `sessions:message` and `sessions:interrupt`. A `sessions:start` grant does not substitute for message authority during Run replacement.

Idempotency keys that start with `pi-session-discovery:` are reserved for the Sessions OpenWaggle creates for discovered Pi sessions; a `create` that passes one with `--idempotency-key` is refused with `reserved_idempotency_key`.

Successful `steer` and `promote` responses include a delivery `receipt`. `delivery: "queued"` means Pi accepted the input for the active Run, not that it has reached the transcript yet. Its `durableTextSha256` is the lowercase SHA-256 of the exact projected first text block encoded as UTF-8, after Pi input transformations. Image-placeholder text parts are not included. `minimumCreatedOrder` is the earliest eligible native Session node order, captured after compaction and before queueing, so an older identical prompt cannot acknowledge the steer. This is not an index into the visible, compacted transcript. `delivery: "handled"` means an extension consumed the command without queueing a user message. Replayed successes saved by an older Host report `delivery: "unavailable"` when no receipt was recorded; they are never executed again to reconstruct it. Steering receipts were introduced in Local Session protocol revision 8; current clients must use the revision accepted by the installed Host. Use `watch` or `read` to observe subsequent delivery. If the Run ends before Pi incorporates a queued steer, the Host returns it to the front of the Follow-up queue: a promoted Follow-up keeps its ID, and a direct `steer` becomes a new Follow-up from the same caller whose `queue-list` item carries `returnedSteer` with the steer's Run and idempotency key, so check the queue before resending. A steer still waiting for compaction when the Run ends is refused instead, so the caller keeps it. A direct `steer` is rejected with `queue_capacity_reached` while the Follow-up queue is full, or `steering_capacity_reached` when the Run already holds the maximum number of steers it could return.

### Coordinate a Worker from another tool

Find the parent Session and its active Run first, then spawn against that Run. The exact Run id prevents an external agent from attaching a Worker to a parent that has already moved on. Choose `share-parent` for the same checkout or `new-worktree` when edits need isolation.

```sh
openwaggle hive search "Sessions release" --all
openwaggle hive status <parent-id>
openwaggle hive spawn <parent-id> --expected-run <run-id> \
  --text "Review the release checks and submit findings" --workspace new-worktree
openwaggle hive wait <worker-id> --condition idle --timeout-ms 60000
openwaggle hive read <worker-id> --full --jsonl
openwaggle hive delegations-list --parent <parent-id>
openwaggle hive delegation-accept <parent-id> <delegation-id> <submission-revision>
```

To pick a Worker's Agent definition first, run `openwaggle hive agent-definitions-list` or `openwaggle hive agent-definitions-search <query>`, then pass the name to `spawn --agent <name>`. Run from a session's worktree or a subdirectory, they read the project it belongs to. Like the agent's tool, they leave out definitions turned off for the project, because `spawn` and `launch` refuse them.

Read the returned Worker and Delegation ids from the spawn response; do not infer them from a title. A wait is one bounded observation, not a subscription. If it times out, the Worker may still be running: wait again or use `hive watch <worker-id>` for live events. Review the Delegation submission before asking for revision or accepting it. To pass information between Sessions without starting another Run, use `hive report <source-session-id> --upstream --text "..."` or target a Session explicitly with `--target <id>`.

## Queue, requests, and coordination

```sh
openwaggle hive queue-list <session-id> --include-bodies
openwaggle hive queue-pause <session-id> --queue-revision <revision>
openwaggle hive queue-reorder <session-id> <follow-up-id>... \
  --queue-revision <revision>
openwaggle hive promote <session-id> <follow-up-id> --expected-run <run-id>
openwaggle hive requests-list <session-id>
openwaggle hive approval-respond <session-id> <run-id> <request-id> \
  --response-json '{"kind":"confirm","accepted":true}'
```

Pending agent-loop questions survive GUI disconnects and have no automatic expiry. Inspect and answer them explicitly through the GUI or CLI. Queue mutations use an expected revision so concurrent callers cannot silently overwrite each other.

A durable Follow-up queue accepts at most 256 entries and 32 MiB of serialized intent. Appends beyond either boundary fail with `queue_capacity_reached` or `queue_byte_capacity_reached`; withdraw or deliver entries before retrying. This keeps queue mutation, GUI synchronization, and recovery memory bounded without changing one-by-one delivery.

`hive wait` blocks until an idle, queue-empty, or state-revision condition is reached. `hive watch` subscribes to the ordered Host event stream. Supplying Session ids applies the filter inside the Host before events consume the subscription buffer; an unfiltered watch continues to receive every authorized event. JSONL output emits a versioned envelope for every line. Inspect `line.record`; cursor checkpoints have `line.record.kind === "cursor"` and carry the initial subscription boundary or the latest progress past a filtered event.

```js
const line = JSON.parse(rawLine)
if (line.type === 'record' && line.record.kind === 'cursor') {
  persistCheckpoint(line.record.cursor)
}
```

Persist the latest emitted Host identity and sequence, including the cursor embedded in visible event records, and reconnect with `--after-host` and `--after-sequence`. A `resync-required` record means the client must reload canonical state.

Delegation history uses the same bounded retrieval model:

```sh
openwaggle hive delegations-list --parent <queen-or-worker-session-id>
openwaggle hive delegations-read <delegation-id> --limit 50
openwaggle hive delegations-read <delegation-id> --limit 50 --cursor <next-cursor>
```

The cursor fixes a high-water snapshot across every Delegation history stream, so records appended while an agent reads later pages do not shift or duplicate that read. The Host may return fewer than `--limit` records to stay within its encoded-byte budget; continue while `nextCursor` is present. A single history record that cannot fit returns `record_too_large`.

## Export

```sh
openwaggle hive export <session-id> --format markdown > conversation.md
openwaggle hive export <session-id> --format jsonl --scope tree > conversation.jsonl
openwaggle hive export-create <session-id> ./handoff --format bundle
openwaggle hive exports-wait <session-id> <operation-id> --timeout-ms 60000
```

Streaming export writes to stdout and byte-pages large transcripts automatically. Its `--format jsonl` output (also selected by the `--jsonl` stream shorthand) is a portable export artifact, not a command-stream envelope: the first line is `{ "record": "manifest", "manifest": { "schemaVersion": 1, ... } }`, and each following line is a raw `{ "record": "node", "schemaVersion": 1, ... }` record. Parse the top-level `exportLine.record` field rather than `exportLine.type` or `exportLine.record.kind`.

```js
const exportLine = JSON.parse(rawLine)
if (exportLine.record === 'manifest') {
  readManifest(exportLine.manifest)
} else if (exportLine.record === 'node') {
  readTranscriptNode(exportLine)
}
```

Artifact export is durable, supports `exports-list`, `exports-read`, `exports-wait`, `export-cancel`, and `exports-watch`, validates destination and resource scope, and refuses an existing destination unless `--overwrite` is explicit. Export-operation listings are also byte-paginated so large captured manifests cannot make status discovery unresponsive. Export list, read, and wait responses omit stored queue intent bodies by default. Use `openwaggle hive exports-read <session-id> <export-operation-id> --include-queue-bodies` (or the same flag on `exports-list`/`exports-wait`) only when the active access profile grants both Session read and queue access. `exports-watch --jsonl` is a command event stream, so it uses the same outer `type: "record"` envelope, cursor checkpoint, and `resync-required` records as `hive watch`, including when unrelated export events are filtered out.

On Windows, workspace-scoped artifact export currently fails closed because the platform does not provide the descriptor-relative installation semantics OpenWaggle requires to prevent path-swap attacks. Use streaming export to stdout instead, for example `openwaggle hive export <session-id> --format markdown > conversation.md`.

## Restricted external-agent profiles

The local desktop user needs no named profile and follows normal OpenWaggle authorization. Create a revocable profile for another agentic tool when it should receive a declared capability and target subset:

```sh
openwaggle access profiles create ci-helper \
  --capability sessions:discover \
  --capability sessions:read \
  --capability sessions:message \
  --project /absolute/project/path \
  --authorization ask-for-approval \
  --credential-store

openwaggle hive list --profile ci-helper --json
openwaggle access profiles revoke ci-helper
```

Named profiles enforce their policy at the Session Host API and authenticate with their own credential; a restricted Windows client does not need access to the desktop owner's credential. Windows rotates the Local Session pipe name for every Host launch and publishes it only in the current user's protected Session Host directory. Before accepting clients, it also verifies a protected DACL that grants only the current Windows user SID. If Windows cannot apply and verify that DACL, the Session Host refuses to start instead of using the operating system's broader default pipe permissions. Elevated and unelevated processes for the same Windows account can reach the pipe, then named-profile policy determines their OpenWaggle authority. Named profiles do not contain a process that can also invoke the CLI as the same unrestricted user. Use an OS sandbox, separate account, or container when an external agent must be unable to recover owner authority. OpenWaggle-hosted agents should use the native `hive` tool; the bundled shell marks agent runs and refuses accidental profile-less CLI use, but that marker is a guardrail rather than a security boundary.

The generated credential is stored separately from the profile policy. Profiles are authenticated, scoped, revocable, and never inherit a broader `YOLO` preference implicitly. CLI errors use stable nonzero exit classes for usage (2), authentication (3), authorization (4), not-found (5), conflict (6), timeout (7), Host-unavailable (8), and internal failures (1). With `--json`, Access command failures emit `{"schemaVersion":1,"type":"error","error":{"kind":"...","message":"..."}}` on stderr. A rejected profile-management response remains a structured response on stdout and uses the matching nonzero exit class, consistent with rejected Session commands.

Credential recovery or cleanup failures are an exception: the CLI reports an error on stderr instead of treating the rejection as fully handled. A reused pending credential is retained if a later request fails or is rejected, because that does not settle the earlier operation. For CLI operations, repeat the same command and operation key under the same caller identity to reconcile an unknown outcome; a changed command or identity is not an equivalent retry. Legacy file pending artifacts that do not bind their original destination cannot be retried automatically, even with the same key; use the reported protected path for manual recovery. If protected-file cleanup fails, the error reports the remaining recovery location rather than claiming the secret was removed.

If a profile-creation or credential-rotation response is lost, the Host may already have committed the change. OpenWaggle retains the protected credential and reports the unknown outcome, operation reference, and recovery path without displaying the secret. A later rejected retry also preserves an earlier pending credential. Keep the error details and protected file until the Host outcome is confirmed and the credential recovered; do not delete the file just because a retry was rejected. Repeat the same CLI command with the same operation key and caller identity to reconcile an unknown outcome. An accepted creation whose local credential installation fails is reported separately as created, with its recovery path.

For an existing, non-revoked profile, a new `openwaggle access profiles rotate <name> --credential-store` operation can explicitly rotate the credential. When one compatible pending store credential exists, the accepted rotation installs it. This is a new operation, not a replay; old clients disconnect and must reconnect using the stored credential. The earlier protected artifact remains available for its original operation's exact-key retry or manual recovery, but a later new rotation will not adopt those already-installed bytes again; it generates a fresh credential. A revoked profile, multiple eligible pending artifacts, or corrupt credential data prevents the recovery path. Keep unresolved artifacts and their reported locations instead of deleting them or retrying blindly.

## Platform and protocol details

On Windows, starting a detached Host uses the built-in Windows PowerShell helper so it does not retain the launching client's pipes. The CLI command can then finish while the Host keeps running. If the helper cannot run, startup fails rather than falling back to a launch that can leave the CLI hanging.

The installed Windows command adds Electron's `--` argument separator automatically. If you invoke the executable directly, include it: `OpenWaggle.exe -- access profiles create ...`. For a development executable, put it after the app path: `electron . -- access profiles create ...`. Without it, Electron can reject capability names such as `sessions:read` or URL arguments before OpenWaggle starts.

The current Local Session protocol revision is **25**, and the Host accepts **only revision 25**, so an older client is refused when it connects and must upgrade. Revision 25 added Settings > Archived items: one searchable, filtered list of archived sessions and branches, selecting every match, and restoring many items (or undoing that) at once. Revision 24 added MCP management: the Settings > MCP and `openwaggle mcp` channels (configuration, enabling and exposure, adding, removing and installing servers, MCP Registry search and install, inspecting a server, signing in and out, importing from other tools), the MCP App catalog, a Session's MCP switch, the slash menu's Pi extension commands (`agent:list-extension-commands`), and pausing Pi session discovery while a project is removed. Revision 23 moved Session-coupled source control into the Host: the change request inspector, merge checks and confirmed merges, Session working-path checks, and Git output recording. Revision 22 changed the active Run snapshots the Host sends. Revision 21 added editing queued messages from the desktop app and made the thinking level a Session setting: Follow-ups no longer carry a thinking level or authorization override, and `queue update-authorization` is removed. A queued message held because the access that queued it was revoked or changed can be sent as the desktop user from the app; the CLI does not offer that. Revision 20 added regenerating a Session title with the Title model. Revision 19 added the `openwaggle host stop` command. Revision 18 added labelled launch steps to worktree launch events and Run snapshots. Revision 17 added native managed Actions and removed legacy action commands. Revision 16 added Session resource Host-UI operations; revision 15 added worktree-launch events. Revision 14 added update commands, revision 13 added turn-diff file reads, and revision 12 added project catalog commands. Revision 11 introduced the GUI's native terminal/browser bridge. Saving and revoking project approvals was introduced in revision 10. Desktop registration and these approval controls are available only to the local GUI, not external agent profiles.

Workspace authorization and visualization source preparation were introduced in revision 9, steering receipts in revision 8, and MCP authorization in revision 7. These minimum operation revisions do not mean the current Host accepts all old wire revisions. Older Hosts must complete the authenticated upgrade handoff before serving requests they do not support. The GUI does not fall back to its own database, save approvals locally, or grant access when the Host is unavailable.

Run `openwaggle hive help`, `openwaggle access profiles help`, or `openwaggle agents help` for the complete operation and flag list.
