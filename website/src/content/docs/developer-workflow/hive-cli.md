---
title: "Hive CLI"
description: "Find, start, message, watch and export OpenWaggle sessions from a terminal or another agent."
order: 5
section: "Developer docs"
kind: "reference"
---

`openwaggle hive` finds conversations, starts work, sends follow-ups, reviews workers' delegations and exports transcripts from a terminal. It works on the same sessions you see in the desktop app.

The CLI, the agent's `hive` tool and the `openwaggle_hive` MCP tool use the same names. Every tool action is a `hive` subcommand and an MCP operation, with `-` in place of `_`: the tool's `follow_up` is `openwaggle hive follow-up`, `delegation_accept` is `openwaggle hive delegation-accept`, and `agent_definitions_search` is `openwaggle hive agent-definitions-search`. Scheduled tasks are the exception; they have their own [`openwaggle schedules`](/docs/using-openwaggle/scheduled-tasks) command. [Hive actions and states](/docs/reference/hive) lists every action with the capability it needs.

Before 1.0 these commands were `openwaggle sessions`, `openwaggle delegations` and `openwaggle agents list|search`. Those names no longer work. `openwaggle agents` still validates, imports, explains and edits [definition files](/docs/extending/agent-definitions).

The CLI talks to the local Session Host, the process that runs sessions and saves them. It never opens the database itself. A command starts the Session Host when it needs to, and a run it started keeps going after you close the desktop app.

An agent running inside OpenWaggle should use its `hive` tool. The CLI is for people in a terminal and for agents running in other tools. Both create the same sessions, so a worker spawned from the CLI appears in the Hive panel and the Session Summary.

For opening the app, `openwaggle run`, `openwaggle status` and the full command list, see [Command line](/docs/developer-workflow/command-line).

The installed app includes the CLI. On macOS and Linux, the packaged app installs or refreshes its command at `~/.local/bin/openwaggle` when it starts, so make sure `~/.local/bin` is on your shell's `PATH`. OpenWaggle never overwrites an unrelated file at that path; if the command is missing, check for a conflicting file there. The Windows installer manages the command. From a source checkout, use `pnpm cli:dev -- <command>`.

## Start with an existing session

Run these from your repository's folder. In each command, replace `<session-id>` with an ID from `list`, or with a session link copied from the desktop app (`openwaggle://sessions/<session-id>`).

To list the project's sessions:

```sh
openwaggle hive list
```

To read a session's summary and state:

```sh
openwaggle hive read <session-id>
```

To see its current run and queue:

```sh
openwaggle hive status <session-id>
```

To give it a new task:

```sh
openwaggle hive follow-up <session-id> --text "Summarize the remaining work. Do not edit files."
```

The first three commands only read. The last one sends work: it starts when the session is idle, or waits behind the current run. Look at the session before you send it anything, because a message can make the agent use tools.

Every session ID operand accepts a link as well as an ID. So do `--target` and `--worker` on `report`, the `--parent` and `--worker` filters of `delegations-list` and `delegations-conflicts`, and the `access` scopes `--session` and `--hive`.

[Create and communicate](#create-and-communicate) starts a new session. [Hives and sessions](/docs/using-openwaggle/hives-and-sessions) explains workers and the risks of a shared workspace.

## Discover and read

| Command | What it does |
| --- | --- |
| `openwaggle hive list` | Lists sessions in the current project. |
| `openwaggle hive search "authorization migration" --mode hybrid` | Searches with hybrid ranking. |
| `openwaggle hive search "semantic session host" --mode semantic --all --json` | Searches every session you can reach, by meaning, as JSON. |
| `openwaggle hive read <session-id>` | Reads one session. |
| `openwaggle hive read <session-id> --full --jsonl` | Streams the whole transcript. |
| `openwaggle hive turns <session-id> --limit 50` | Pages through turns. |
| `openwaggle hive items <session-id> --after 200 --limit 100` | Pages through transcript items. |

`list`, `search`, `delegations-list` and `delegations-conflicts` look at the current project by default: the project of the folder you run them in, with its main checkout and every worktree of it. Use `--project <path>` for another project, or `--all` for every session you may see.

`list` and `search` leave archived sessions out. `list --archived` lists only archived ones, `search --include-archived` searches them too, and `list --parent <session>` lists only that session's direct workers. `delegations-list` shows every state, newest first, unless `--state` narrows it.

Hybrid search combines word matching from the index with similarity of meaning. `--require-fresh` waits for the meaning index to catch up instead of returning a readiness marker.

A search for several words matches sessions that contain all of them, anywhere in the session. When the words must appear together and in order inside one transcript item, wrap the whole search in literal double quotes, for example `openwaggle hive search '"authorization migration"' --mode lexical`. A quoted phrase never joins text across two messages or tool events, so every phrase result points at one item.

`read --full` streams a fixed snapshot of the transcript, page by page, so an agent can fetch the whole transcript without holding it in memory. Each page has a limit on records and on bytes, so a session with large messages gets smaller pages. A single record too large for any page fails with `record_too_large` instead of crashing the Session Host. Programs should use `--json` for one response and `--jsonl` for streams.

## JSON output

Single-response commands with `--json` print a `type: "response"` envelope with a schema version on stdout, and put the command's result in `result`. This includes a structured rejected outcome returned by the Host; the response remains available on stdout while the process uses its matching nonzero exit class. Streams such as `read --full`, `watch` and `exports-watch` use `--jsonl`. Every stdout line then has `type: "record"` and puts the streamed value in `record`.

A failure that aborts before a structured command result is available prints a `type: "error"` envelope on stderr. That covers invalid usage, failed authentication or authorization, connection failures and internal errors. It is different from a structured rejected response on stdout.

```json
{"schemaVersion":1,"type":"response","command":"list","result":{"contract":"session-query-v2","response":{"contractVersion":2,"requestId":"request-1","outcome":{"operation":"list","sessions":[]}}}}
{"schemaVersion":1,"type":"record","record":{"kind":"cursor","cursor":{"hostInstanceId":"host-1","sequence":42}}}
{"schemaVersion":1,"type":"error","error":{"kind":"authorization","message":"An error has occurred"}}
```

### Error kinds and exit codes

Every `openwaggle` command reports a failure with one of these kinds and exits with its code: `hive`, `access`, `agents`, `recovery`, `schedules`, `status`, `host`, `run`, `update` and `mcp`. With `--json` or `--jsonl` the kind is in the error envelope. Without them, the message starts with `error [<kind>]:`. The kind comes from what failed, never from the wording of the message.

| Kind | Exit code | Meaning |
| --- | --- | --- |
| `usage` | 2 | The command cannot run as typed: an unknown option, a missing operand, a bad value, or an `update --version` older than the installed one. Nothing reached the Session Host. |
| `authentication` | 3 | A credential is missing, unreadable or refused, such as an unknown or revoked access profile, or one whose credential was rotated. Also while the Session Host slows down repeated failed attempts; retry later. |
| `authorization` | 4 | The caller may not do this: a missing capability, a session outside its scope (`target_scope_denied`), or an OpenWaggle agent using the CLI without a named profile. |
| `not_found` | 5 | The session, delegation or other target does not exist (`session_not_found`, `delegation_not_found`). |
| `conflict` | 6 | The current state refuses it: a stale run or queue revision, an existing credential destination without `--replace`, a destination that changed after a repeatable operation, or another refusal whose code this table does not name. |
| `timeout` | 7 | A wait ended before its condition was met. `hive wait` and `hive exports-wait` still print their response on stdout. |
| `host_unavailable` | 8 | The Session Host cannot be reached, started or spoken to. |
| `internal` | 1 | Anything else, an unexpected failure. |

When the Session Host refuses a request in its response, such as a rejected outcome, the CLI prints it on stdout and exits with the code of its kind. It does not also print an error on stderr.

An ID that does not exist gets the same answer from every action. A query's `outcome.error.code`, or a command's rejected outcome `code`, is `session_not_found` or `delegation_not_found`, and the CLI exits with 5. That holds for `read`, `status`, `follow-up`, `steer`, `wait`, `report` targets, `delegations-read`, `delegation-accept`, and the `--parent` and `--worker` filters of `delegations-list` and `delegations-conflicts`.

An ID that exists outside the caller's scope answers `target_scope_denied` and exits with 4, also for those filters. A `report` to such a target answers `target_not_authorized`, also exit 4. The two answers are kept apart on purpose. Session and delegation IDs are random, so the answer tells a caller nothing about an ID it did not already have, and it says whether more access would help. The agent's `hive` tool returns the same outcomes, and the `openwaggle_hive` MCP tool fails with a message that names the same code.

## Search transcripts

Ordinary search uses hybrid mode over session summaries and needs `sessions:discover`. `search --full-transcript` uses word matching by default, can look through older transcript content, and also needs `sessions:read`. A profile that can only discover sessions cannot use it.

Pass `--mode semantic` or `--mode hybrid` when matching by meaning helps. Those modes build the embeddings they need on first use, and only for the sessions the query may see, up to 1,000 sessions. Use `--require-fresh --timeout-ms <ms>` to wait until every item the storage limits allow is indexed.

The meaning index is a local cache that OpenWaggle can rebuild. The transcript itself is the source of truth. The cache keeps these limits:

| Limit | Value |
| --- | --- |
| Items per session | 5,000 most recent searchable items |
| Items in total | 50,000 |
| Vectors in total | 64 MiB |
| Items waiting to index | 10,000 |
| Unused scopes | Expire after 7 days. When space runs out, the least recently used go first. |

A prepare, wait or search that is running holds a lease on its scope, so the cache never removes it mid-use. When a session or the current scope passes a limit, readiness becomes `partial`, with exact counts and a reason, instead of waiting forever. Semantic-only search may use what is indexed. Hybrid search reports `semantic_partial_coverage` and uses the complete word index. The discovery window is marked truncated. `read --full` and full-transcript word search are always complete; the cache does not limit them.

A single-word or quoted full-transcript match names the transcript item, the run when known, and the item's position. A match for several unquoted words may combine words from several items. Then it names only the session, rather than pretending one item contains the whole query.

Full-transcript search covers visible user and assistant text, attachment names, tool names, short success or failure outcomes, summaries, and visible OpenWaggle coordination messages. It never indexes raw item JSON, reasoning, tool arguments, textual tool results, or text extracted from attachments. Empty internal items are skipped.

## Create and communicate

In these examples, replace `<parent-id>`, `<session-id>` and `<run-id>` with real IDs. `status` shows a session's current run ID.

To start a new session in the current folder, in its current checkout:

```sh
openwaggle hive launch . --text "Plan the migration" --workspace current
```

To spawn a worker in its own worktree under a parent that is running:

```sh
openwaggle hive spawn <parent-id> --expected-run <run-id> --text "Implement the storage slice" --workspace new-worktree
```

To queue a follow-up:

```sh
openwaggle hive follow-up <session-id> --text "Run the integration tests"
```

To steer the current run:

```sh
openwaggle hive steer <session-id> --expected-run <run-id> --text "Also preserve the old API contract"
```

To stop the current run and start a new one in its place:

```sh
openwaggle hive replace <session-id> --expected-run <run-id> --text "Stop and use the revised design"
```

Give message input with exactly one of `--text`, `--stdin`, `--input-file` or `--request-json`. Attach files with `--attach`, repeated for each file. `create`, `launch`, `fork` and `spawn` accept `--title`. `create`, `launch` and `spawn` accept `--agent`, `--model` and `--thinking`; `--thinking` sets the new session's starting thinking level. `launch` and `spawn` also accept `--yolo` when your access limit allows it. Workspace flags depend on the command; `hive help` lists the choices.

The thinking level is a session setting, like its model. `message` and `start` accept `--thinking` only when the session is idle and the command starts a run. The level then stays the session's thinking level for that run and later ones, but it never changes the desktop default for new sessions. In the same way, `message` and `start` accept `--authorization` or `--yolo` only when they start a run on an idle session. That override applies to the one run, stays within your access limit, and is never saved as the session's mode. While a run is active, a `message` that would be queued is refused with `thinking_level_requires_idle_session` or `run_authorization_override_requires_idle_session`. `follow-up`, `steer` and `replace` never accept these options, so a queued follow-up always runs with the session's settings when it starts.

Use `message` when you want it to start now or queue, whichever fits. Use `follow-up` when the message must be a separate next run, and `steer` when it must go into the current run. A follow-up stays queued while a run is active. If that run ends just before the follow-up is accepted, the Session Host starts the follow-up as the next run instead of leaving it stuck. Commands that act on a run need `--expected-run`. If that run is no longer current, the command fails instead of steering or stopping the wrong run.

A profile that uses `replace` needs both `sessions:message` and `sessions:interrupt`. `sessions:start` does not stand in for message access when replacing a run.

Idempotency keys that start with `pi-session-discovery:` are reserved for the sessions OpenWaggle creates for discovered Pi sessions. A `create` that passes one with `--idempotency-key` is refused with `reserved_idempotency_key`.

### Steering receipts

A successful `steer` or `promote` returns a delivery `receipt`:

| `delivery` | Meaning |
| --- | --- |
| `queued` | Pi accepted the input for the current run. It may not be in the transcript yet. |
| `handled` | An extension handled the command without queueing a user message. |
| `unavailable` | A replayed success saved by an older Session Host that recorded no receipt. It is never run again to rebuild one. |

A `queued` receipt also carries `durableTextSha256` and `minimumCreatedOrder`. `durableTextSha256` is the lowercase SHA-256 of the exact first text block as it will be saved, encoded as UTF-8, after Pi's input transformations. Image-placeholder text is not included. `minimumCreatedOrder` is the earliest session item order that can match, captured after compaction and before queueing, so an older identical prompt cannot count as this steer. It is not an index into the visible, compacted transcript. Steering receipts arrived in local session protocol revision 8; current clients must use the revision the installed Session Host accepts. Use `watch` or `read` to see the message arrive.

If the run ends before Pi takes in a queued steer, the Session Host puts it back at the front of the follow-up queue. A promoted follow-up keeps its ID. A direct `steer` becomes a new follow-up from the same caller, and its `queue-list` item carries `returnedSteer` with the steer's run and idempotency key, so check the queue before you send it again. A steer still waiting for compaction when the run ends is refused instead, so the caller keeps it. A direct `steer` is refused with `queue_capacity_reached` while the follow-up queue is full, or `steering_capacity_reached` when the run already holds the most steers it could return.

### Coordinate a worker from another tool

Find the parent session and its current run first, then spawn against that run. The run ID stops an outside agent from attaching a worker to a parent that has already moved on. Choose `share-parent` for the same checkout, or `new-worktree` when edits need their own checkout. Replace the IDs in each command with the ones you found.

To find the parent session:

```sh
openwaggle hive search "Sessions release" --all
```

To read its current run ID:

```sh
openwaggle hive status <parent-id>
```

To spawn the worker:

```sh
openwaggle hive spawn <parent-id> --expected-run <run-id> --text "Review the release checks and submit findings" --workspace new-worktree
```

To wait up to a minute for it to go idle:

```sh
openwaggle hive wait <worker-id> --condition idle --timeout-ms 60000
```

To read everything it did:

```sh
openwaggle hive read <worker-id> --full --jsonl
```

To list the parent's delegations:

```sh
openwaggle hive delegations-list --parent <parent-id>
```

To accept one submitted revision:

```sh
openwaggle hive delegation-accept <parent-id> <delegation-id> <submission-revision>
```

To pick the worker's agent definition first, run `openwaggle hive agent-definitions-list` or `openwaggle hive agent-definitions-search <query>`, then pass the name to `spawn --agent <name>`. Run from a session's worktree or a folder inside it, they read that session's project. Any other folder, including a subfolder of a project, is read as its own project, the way `launch` reads it. Like the agent's tool, they leave out definitions turned off for the project, because `spawn` and `launch` refuse those. They read definition files in the CLI process, but they take `--profile` like every `hive` command: a named profile must authenticate, which starts the Session Host if it is not running, and an OpenWaggle agent without one is refused. With nothing to list they print `No Agent definitions found.`

Read the worker and delegation IDs from the spawn response; do not guess them from a title. A wait is one check with a time limit, not a subscription. If it times out, it exits with 7 and the worker may still be running. Wait again, or use `hive watch <worker-id>` for live events. Review the delegation's submission before you ask for a revision or accept it. To pass information between sessions without starting another run, use `hive report <source-session-id> --upstream --text "..."`, or name a session with `--target <id>`.

## Queue, requests, and coordination

| Command | What it does |
| --- | --- |
| `openwaggle hive queue-list <session-id> --include-bodies` | Lists queued follow-ups with their text. |
| `openwaggle hive queue-pause <session-id> --queue-revision <revision>` | Pauses the queue. |
| `openwaggle hive queue-reorder <session-id> <follow-up-id>... --queue-revision <revision>` | Puts follow-ups in a new order. |
| `openwaggle hive promote <session-id> <follow-up-id> --expected-run <run-id>` | Sends a queued follow-up into the current run. |
| `openwaggle hive requests-list <session-id>` | Lists questions and approvals a run is waiting on. |
| `openwaggle hive approval-respond <session-id> <run-id> <request-id> --response-json '{"kind":"confirm","accepted":true}'` | Answers an approval request. |

A question from the agent survives the desktop app disconnecting and has no automatic expiry. Look at it and answer it in the app or the CLI. Queue changes take the queue revision you last read, so two callers cannot overwrite each other's changes without noticing.

A follow-up queue holds at most 256 entries and 32 MiB of saved messages. Adding past either limit fails with `queue_capacity_reached` or `queue_byte_capacity_reached`; withdraw or deliver entries before you retry. The limit keeps queue changes, app updates and recovery within bounded memory. Delivery is still one entry at a time.

`hive wait` blocks until an idle, queue-empty or state-revision condition is met. It answers from the Session Host's current state, so it never returns `resync_required`. When the Session Host drops its internal subscription under heavy event load, or `--after-host` and `--after-sequence` name a cursor it no longer has, it reloads that state and keeps waiting until the condition matches or `--timeout-ms` runs out. `exports-wait`, the `hive` tool's `wait` and `exports_wait`, and the MCP `wait` and `exports-wait` operations behave the same.

`hive watch` subscribes to the Session Host's ordered event stream. Passing session IDs filters events inside the Session Host, before they take space in the subscription buffer. A watch without a filter receives every event the caller may see. JSONL output wraps every line in a versioned envelope. Inspect `line.record`. Cursor checkpoints have `line.record.kind === "cursor"` and carry the starting point of the subscription, or the latest progress past a filtered event.

```js
const line = JSON.parse(rawLine)
if (line.type === 'record' && line.record.kind === 'cursor') {
  persistCheckpoint(line.record.cursor)
}
```

Save the latest Session Host identity and sequence you saw, including the cursor inside visible event records, and reconnect with `--after-host` and `--after-sequence`. A `resync-required` record means the client must reload the current state.

Delegation history is read the same way, page by page. Replace the IDs and the cursor with real values.

To list the delegations of a Queen or a worker:

```sh
openwaggle hive delegations-list --parent <queen-or-worker-session-id>
```

To read the first page of one delegation's history:

```sh
openwaggle hive delegations-read <delegation-id> --limit 50
```

To read the next page:

```sh
openwaggle hive delegations-read <delegation-id> --limit 50 --cursor <next-cursor>
```

Every session summary and delegation that carries a delegation state (`list`, `search`, `read`, `delegations-list` and `delegations-read`) also carries `nextActor`: who acts next on that worker. It is one of:

| `nextActor` | Meaning |
| --- | --- |
| `user` | Only the person can unblock it: a run is waiting on an approval or a question, or the worker is stuck. It is stuck when its last run failed or was interrupted, or it asked its parent for help, and its parent has no active run and nothing queued to deliver. |
| `parent` | Its parent agent acts next: review a `ready_for_review` result, see a failed run, answer a request for help, or follow up a worker that set `waiting`. |
| `worker` | The worker acts next: it is `working`, or revising after `revision_requested`. |
| `none` | The delegation is `accepted` or `cancelled`. |

The delegation states stay as they are. `nextActor` is worked out when you read, by the same rule the Hive panel uses, so it follows the parent's runs and queue as they change. A `needs_attention` the Session Host set for a failed run goes back to `working` (or `revision_requested`) when a new run starts on the worker. One the worker set itself goes back to `working` when its parent's agent sends it anything. The history keeps both changes, by `session-host` and by the parent. Command outcomes are saved for repeated requests, so they do not carry `nextActor`; read the session or the delegation instead. [Hive actions and states](/docs/reference/hive#delegation-states) describes every state.

The cursor fixes one snapshot across all delegation history, so records added while an agent reads later pages do not shift or repeat that read. The Session Host may return fewer than `--limit` records to stay within its byte budget; keep reading while `nextCursor` is present. A single history record too large for a page returns `record_too_large`.

## Export

Replace `<session-id>` and `<operation-id>` with real IDs.

To export a transcript as Markdown:

```sh
openwaggle hive export <session-id> --format markdown > conversation.md
```

To export a session and its workers as JSONL:

```sh
openwaggle hive export <session-id> --format jsonl --scope tree > conversation.jsonl
```

To write a bundle to a folder:

```sh
openwaggle hive export-create <session-id> ./handoff --format bundle
```

To wait up to a minute for that export:

```sh
openwaggle hive exports-wait <session-id> <operation-id> --timeout-ms 60000
```

A streaming export writes to stdout and splits large transcripts into pages by size. Its `--format jsonl` output (also selected by the `--jsonl` stream shorthand) is a portable export artifact, not a command-stream envelope. The first line is `{ "record": "manifest", "manifest": { "schemaVersion": 1, ... } }`, and each line after it is a raw `{ "record": "node", "schemaVersion": 1, ... }` record. Read the top-level `exportLine.record` field, not `exportLine.type` or `exportLine.record.kind`.

```js
const exportLine = JSON.parse(rawLine)
if (exportLine.record === 'manifest') {
  readManifest(exportLine.manifest)
} else if (exportLine.record === 'node') {
  readTranscriptNode(exportLine)
}
```

A file export is saved and can be followed with `exports-list`, `exports-read`, `exports-wait`, `export-cancel` and `exports-watch`. It checks the destination and which resources it may read, and refuses an existing destination unless you pass `--overwrite`. Export listings are split into pages by size too, so large manifests cannot make status checks hang. Export list, read and wait responses leave out the text of queued messages by default. Use `openwaggle hive exports-read <session-id> <export-operation-id> --include-queue-bodies` (or the same flag on `exports-list` and `exports-wait`) only when the access profile in use grants both session read and queue access. `exports-watch --jsonl` is a command event stream, so it uses the same outer `type: "record"` envelope, cursor checkpoint and `resync-required` records as `hive watch`, also when unrelated export events are filtered out.

On Windows, a file export into a workspace currently fails. Windows lacks the file-system calls OpenWaggle uses to stop another process from swapping the path during the write. Use a streaming export to stdout instead, for example `openwaggle hive export <session-id> --format markdown > conversation.md`.

## Restricted external-agent profiles

The desktop user needs no named profile and follows normal OpenWaggle permissions. For another agent tool, create a profile you can revoke, with only the capabilities and targets it should have. Replace `/absolute/project/path` with the project's folder.

To create the profile and store its credential:

```sh
openwaggle access profiles create ci-helper --capability sessions:discover --capability sessions:read --capability sessions:message --project /absolute/project/path --authorization ask-for-approval --credential-store
```

To use it, pass `--profile`. Setting `OPENWAGGLE_PROFILE` to the profile's name works too; [Environment variables](/docs/reference/environment-variables#app-and-cli) lists it with `OPENWAGGLE_USER_DATA_DIR` and the other CLI variables.

```sh
openwaggle hive list --profile ci-helper --json
```

To revoke it:

```sh
openwaggle access profiles revoke ci-helper
```

An MCP client gets a profile's access through `openwaggle mcp serve --profile ci-helper`, which signs in with the same stored credential and can only narrow the profile further (see [OpenWaggle as an MCP server](/docs/configuration/mcp#openwaggle-as-an-mcp-server)). Revoking the profile stops that server too.

The Session Host enforces a named profile's policy, and the profile signs in with its own credential, so a restricted Windows client does not need the desktop owner's credential. On Windows, the local session pipe gets a new name for every Session Host launch, published only in the current user's protected Session Host folder. Before it accepts clients, the Session Host checks that the pipe's access list grants only the current Windows user. If Windows cannot apply and check that list, the Session Host refuses to start rather than use the system's broader default pipe permissions. Elevated and normal processes of the same Windows account can both reach the pipe; the named profile then decides what they may do in OpenWaggle.

A named profile does not contain a process that can also run the CLI as the same unrestricted user. Use an operating system sandbox, a separate account or a container when an outside agent must not be able to get the owner's access back. OpenWaggle's own agents should use the `hive` tool. The agent's shell sets `OPENWAGGLE_AGENT_RUN=1`, so the CLI refuses to run there without a profile (exit code 4) and refuses `mcp serve --owner`. That marker is a guardrail, not a security boundary. [Environment variables](/docs/reference/environment-variables#set-for-agent-shell-commands) lists what the agent's shell gets.

The generated credential is stored apart from the profile's policy. Profiles sign in, have a scope, can be revoked, and never quietly take on a broader `YOLO` preference. `access` commands use the [error kinds and exit codes](#error-kinds-and-exit-codes) above. With `--json`, a result is `{"schemaVersion":1,"type":"response","command":"access profiles list","result":...}` on stdout, and a failure is `{"schemaVersion":1,"type":"error","error":{"kind":"...","message":"..."}}` on stderr. Without `--json`, they print readable lines. A rejected profile-management response stays a structured response on stdout and exits with the matching nonzero code, as rejected session commands do.

`access profiles list` leaves out revoked profiles; add `--include-revoked` to show them. A revoked profile keeps its record, for its audit history, and its name. Revoking a profile also removes, on this machine, its credential-store copy, its installation receipts, and the markers of its used staged credentials. A staged `.pending` credential stays, as a recovery file. When `create` or `rotate` writes the credential to `--credential-file`, an older credential-store copy is removed, so `--profile` does not keep using an old credential. A profile with no stored credential fails with `No stored credential for access profile "<name>"`, and a credential the Session Host refuses names the profile and suggests rotating it.

### Recover a lost credential

Credential recovery and cleanup failures are reported differently: the CLI prints an error on stderr instead of treating the rejection as fully handled. A reused pending credential is kept if a later request fails or is rejected, because that does not settle the earlier operation. To settle an unknown outcome, repeat the same command with the same operation key as the same caller; a changed command or caller is not the same retry. Older pending credential files that do not record their original destination cannot be retried automatically, even with the same key; use the reported protected path to recover them by hand. If removing a protected file fails, the error names where the file still is rather than claiming the secret was removed.

If the response to a profile creation or credential rotation is lost, the Session Host may already have made the change. OpenWaggle keeps the protected credential and reports the unknown outcome, the operation reference and the recovery path, without showing the secret. A later rejected retry also keeps an earlier pending credential. Keep the error details and the protected file until the outcome is confirmed and the credential recovered; do not delete the file just because a retry was rejected. Repeat the same CLI command with the same operation key as the same caller to settle an unknown outcome. A creation that succeeded but whose local credential could not be installed is reported separately as created, with its recovery path.

For an existing profile that is not revoked, a new `openwaggle access profiles rotate <name> --credential-store` rotates the credential. When there is exactly one matching pending store credential, the accepted rotation installs it. This is a new operation, not a replay. Old clients disconnect and must reconnect with the stored credential. The earlier protected file stays available for its original operation's exact-key retry or manual recovery, but a later rotation will not reuse those installed bytes; it generates a fresh credential. A revoked profile, more than one eligible pending file, or corrupt credential data blocks recovery. Keep unresolved files and their reported locations instead of deleting them or retrying blindly.

## Platform and protocol details

On Windows, starting a detached Session Host uses the built-in Windows PowerShell helper, so the Session Host does not keep the launching client's pipes open. The CLI command can then finish while the Session Host keeps running. If the helper cannot run, startup fails rather than falling back to a launch that can leave the CLI hanging.

The installed Windows command adds Electron's `--` argument separator for you. If you run the executable directly, include it: `OpenWaggle.exe -- access profiles create ...`. For a development build, put it after the app path: `electron . -- access profiles create ...`. Without it, Electron can reject capability names such as `sessions:read`, or URL arguments, before OpenWaggle starts.

The current local session protocol revision is **30**, and the Session Host accepts **only revision 30**, so an older client is refused when it connects and must upgrade. `nextActor` is an added field of query outcomes, which clients do not decode strictly, so it needed no new revision.

| Revision | What it added |
| --- | --- |
| 30 | **Settings > Worktrees** across every project: the worktree list, measuring the space a worktree frees, **Archive & remove**, and the record of automatic worktree removal. |
| 29 | Limits on what the desktop app reads of a session. The session tree carries no message content, and the app reads a window of the transcript and only the messages added since its last read. |
| 28 | Cheap, finite heartbeats. A scheduled task carries its `heartbeat` settings (stop condition, wake check and its approval, idle auto-pause), a run its `wakeCheck` result and run `outcome`, and a heartbeat its own model, with the `approve-wake-check` and `report-outcome` operations. Creating a heartbeat with no way to finish is refused with `stop_condition_required` (see [Scheduled tasks](/docs/using-openwaggle/scheduled-tasks#keep-heartbeats-cheap)). |
| 27 | The Hive defaults. A queue change reports `remainingFollowUpIds` (formerly `followUpIds`), a withdraw also reports `withdrawnFollowUpIds`, a queued follow-up reports its queue state, the catalog's default scope is the whole current project, `list` takes `parentSessionId`, `spawn` takes a title, and session summaries carry `depth`. |
| 26 | Scheduled tasks. |
| 25 | **Settings > Archived items**: one searchable, filtered list of archived sessions and branches, selecting every match, and restoring many items (or undoing that) at once. |
| 24 | MCP management: the **Settings > MCP** and `openwaggle mcp` channels (configuration, enabling and exposure, adding, removing and installing servers, MCP Registry search and install, inspecting a server, signing in and out, importing from other tools), the MCP App catalog, a session's MCP switch, the slash menu's Pi extension commands (`agent:list-extension-commands`), and pausing Pi session discovery while a project is removed. |
| 23 | Session source control in the Session Host: the change request inspector, merge checks and confirmed merges, session working-path checks, and recording Git output. |
| 22 | Changed the active run snapshots the Session Host sends. |
| 21 | Editing queued messages from the desktop app, and the thinking level as a session setting. Follow-ups no longer carry a thinking level or access override, and `queue update-authorization` is removed. A queued message held because the access that queued it was revoked or changed can be sent as the desktop user from the app; the CLI does not offer that. |
| 20 | Regenerating a session title with the title model. |
| 19 | The `openwaggle host stop` command. |
| 18 | Labelled launch steps in worktree launch events and run snapshots. |
| 17 | Native managed actions, and removed the old action commands. |
| 16 | Session resource operations for the desktop app. |
| 15 | Worktree launch events. |
| 14 | Update commands. |
| 13 | Reading files from a turn's diff. |
| 12 | Project catalog commands. |
| 11 | The desktop app's native terminal and browser bridge. |
| 10 | Saving and revoking project approvals. |
| 9 | Workspace authorization and preparing visualization sources. |
| 8 | Steering receipts. |
| 7 | MCP authorization. |

Desktop registration and the approval controls from revision 10 are available only to the local desktop app, not to outside agent profiles. These are the revisions where each operation first appeared; they do not mean the current Session Host accepts old protocol revisions. An older Session Host must complete the signed-in upgrade handoff before it serves requests it does not support. The desktop app never falls back to its own database, saves approvals locally, or grants access when the Session Host is unavailable.

Run `openwaggle hive help`, `openwaggle access profiles help` or `openwaggle agents help` for the complete list of operations and flags.
