---
title: "Sessions CLI"
description: "Discover, control, watch, and export OpenWaggle Sessions from a terminal or another agent."
order: 3
section: "Developer Workflow"
---

The `openwaggle` CLI is a client of the same local Session Host as the desktop app. It does not open the Session database directly. Commands can start the Host on demand, accepted Runs continue when the GUI closes, and Host events keep an open GUI synchronized with CLI activity.

On Windows, starting a detached Host uses the built-in Windows PowerShell helper to prevent it from retaining the launching client's pipes. This lets a CLI command finish while the Host continues running. If the helper cannot run, startup fails with an error instead of falling back to a launch that can leave the CLI hanging.

On macOS and Linux, install or update the command from Settings > Agent Access > OpenWaggle CLI. The managed user shim is written to `~/.local/bin/openwaggle`; OpenWaggle reports when that directory is missing from `PATH` and never overwrites an unrelated file. The Windows installer manages the command. From a source checkout, use `pnpm cli:dev -- <command>`.

The Windows command adds Electron's `--` argument separator automatically; use `openwaggle access profiles create ...` normally. If you invoke the executable directly, include the separator: `OpenWaggle.exe -- access profiles create ...`. For a development executable, put it after the app path: `electron . -- access profiles create ...`. Without it, Electron can reject capability names such as `sessions:read` or URL arguments before OpenWaggle starts.

The current Local Session protocol revision is 11; the Host also accepts revision 10. Revision 11 adds the GUI's native terminal/browser control bridge. Saving and revoking project approvals from the GUI requires revision 10 or later. The owning Host serializes those changes with project preferences, including when a CLI command started the Host before the GUI opened. Desktop registration and these approval controls remain available only to the local GUI, not to external agent profiles.

Host-authorized workspace access and visualization source preparation require revision 9 or later. This covers file search, project syntax themes, and recovery of saved visualizations after a crash. Older Hosts must complete the authenticated upgrade handoff before serving requests they do not support. The GUI does not fall back to its own Session database, save approvals locally, or grant access when the Host is unavailable. Steering receipts require revision 8 or later; the MCP authorization command was introduced in revision 7.

## Discover and read

```sh
openwaggle sessions list
openwaggle sessions search "authorization migration" --mode hybrid
openwaggle sessions search "semantic session host" --mode semantic --all --json
openwaggle sessions read <session-id>
openwaggle sessions read <session-id> --full --jsonl
openwaggle sessions turns <session-id> --limit 50
openwaggle sessions items <session-id> --after 200 --limit 100
```

List and search default to the current working path. Use `--project <path>` for the repository project or `--all` for the complete authorized catalog. Hybrid search combines indexed lexical relevance and semantic similarity. `--require-fresh` waits for the current semantic projection instead of returning a readiness marker.

Lexical multiword searches match all tokens anywhere in one Session. Wrap the complete search text in literal double quotes when word order and adjacency are required within one transcript item, for example `openwaggle sessions search '"authorization migration"' --mode lexical`. Quoted phrases never join text across message or tool-event boundaries, so every phrase result can identify one matching item.

`read --full` streams a stable high-water-mark snapshot page by page, so an agent can retrieve the complete transcript without accumulating it in memory. Pages are bounded by both record count and encoded bytes; a Session with large messages therefore produces smaller pages automatically. A single pathological record that cannot fit in one bounded response fails with `record_too_large` instead of crashing the Host. Machine consumers should use `--json` for one response and `--jsonl` for streams.

Single-response commands with `--json` use a schema-versioned `type: "response"` envelope on stdout and place the command result in `result`. This includes a structured rejected outcome returned by the Host; the response remains available on stdout while the process uses its matching nonzero exit class. Command streams such as `read --full`, `watch`, and `export watch` use `--jsonl`; every stdout line has `type: "record"` and places the stream value in `record`.

A failure that aborts before a structured command result is available—such as usage validation, authentication or authorization protocol failure, transport failure, or an internal error—uses a schema-versioned `type: "error"` envelope on stderr. This is different from a structured rejected response on stdout.

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
openwaggle sessions launch . --text "Plan the migration" --workspace current
openwaggle sessions spawn <parent-id> --expected-run <run-id> \
  --text "Implement the storage slice" --workspace new-worktree
openwaggle sessions follow-up <session-id> --text "Run the integration tests"
openwaggle sessions steer <session-id> --expected-run <run-id> \
  --text "Also preserve the old API contract"
openwaggle sessions replace <session-id> --expected-run <run-id> \
  --text "Stop and use the revised design"
```

Use exactly one of `--text`, `--stdin`, `--input-file`, or `--request-json` for message input. Attach files with repeatable `--attach`. Lifecycle commands accept `--agent`, `--model`, `--thinking`, explicit Workspace options, and `--yolo` when the resolved authorization ceiling permits it.

Use `message` when adaptive start-or-queue behavior is wanted. Use `follow-up` when the message must become a separate next Run, or `steer` when it must enter the current Run. A Follow-up remains queued while a Run is active; if that Run settles just before admission, the Host starts the Follow-up as the next Run instead of stranding it. Run-targeted mutations require `--expected-run`; stale callers fail instead of steering or interrupting the wrong Run.

Profiles that use `replace` need both `sessions:message` and `sessions:interrupt`. A `sessions:start` grant does not substitute for message authority during Run replacement.

Successful `steer` and `promote` responses include a delivery `receipt`. `delivery: "queued"` means Pi accepted the input for the active Run, not that it has reached the transcript yet. Its `durableTextSha256` is the lowercase SHA-256 of the exact projected first text block encoded as UTF-8, after Pi input transformations. Image-placeholder text parts are not included. `minimumCreatedOrder` is the earliest eligible native Session node order, captured after compaction and before queueing, so an older identical prompt cannot acknowledge the steer. This is not an index into the visible, compacted transcript. `delivery: "handled"` means an extension consumed the command without queueing a user message. Replayed successes saved by an older Host report `delivery: "unavailable"` when no receipt was recorded; they are never executed again to reconstruct it. These commands require Local Session protocol revision 8. Use `watch` or `read` to observe subsequent delivery.

## Queue, requests, and coordination

```sh
openwaggle sessions queue list <session-id> --include-bodies
openwaggle sessions queue pause <session-id> --queue-revision <revision>
openwaggle sessions queue reorder <session-id> <follow-up-id>... \
  --queue-revision <revision>
openwaggle sessions promote <session-id> <follow-up-id> --expected-run <run-id>
openwaggle sessions requests list <session-id>
openwaggle sessions requests respond <session-id> <run-id> <request-id> \
  --response-json '{"choice":"approve"}' --approve
```

Pending agent-loop questions survive GUI disconnects and have no automatic expiry. Inspect and answer them explicitly through the GUI or CLI. Queue mutations use an expected revision so concurrent callers cannot silently overwrite each other.

A durable Follow-up queue accepts at most 256 entries and 32 MiB of serialized intent. Appends beyond either boundary fail with `queue_capacity_reached` or `queue_byte_capacity_reached`; withdraw or deliver entries before retrying. This keeps queue mutation, GUI synchronization, and recovery memory bounded without changing one-by-one delivery.

`sessions wait` blocks until an idle, queue-empty, or state-revision condition is reached. `sessions watch` subscribes to the ordered Host event stream. Supplying Session ids applies the filter inside the Host before events consume the subscription buffer; an unfiltered watch continues to receive every authorized event. JSONL output emits a versioned envelope for every line. Inspect `line.record`; cursor checkpoints have `line.record.kind === "cursor"` and carry the initial subscription boundary or the latest progress past a filtered event.

```js
const line = JSON.parse(rawLine)
if (line.type === 'record' && line.record.kind === 'cursor') {
  persistCheckpoint(line.record.cursor)
}
```

Persist the latest emitted Host identity and sequence, including the cursor embedded in visible event records, and reconnect with `--after-host` and `--after-sequence`. A `resync-required` record means the client must reload canonical state.

Delegation history uses the same bounded retrieval model:

```sh
openwaggle delegations list --parent <queen-or-worker-session-id>
openwaggle delegations read <delegation-id> --limit 50
openwaggle delegations read <delegation-id> --limit 50 --cursor <next-cursor>
```

The cursor fixes a high-water snapshot across every Delegation history stream, so records appended while an agent reads later pages do not shift or duplicate that read. The Host may return fewer than `--limit` records to stay within its encoded-byte budget; continue while `nextCursor` is present. A single history record that cannot fit returns `record_too_large`.

## Export

```sh
openwaggle sessions export <session-id> --format markdown > conversation.md
openwaggle sessions export <session-id> --format jsonl --scope tree > conversation.jsonl
openwaggle sessions export create <session-id> ./handoff --format bundle
openwaggle sessions export wait <session-id> <operation-id> --timeout-ms 60000
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

Artifact export is durable, supports status/list/read/cancel/watch operations, validates destination and resource scope, and refuses an existing destination unless `--overwrite` is explicit. Export-operation listings are also byte-paginated so large captured manifests cannot make status discovery unresponsive. Export list, read, and wait responses omit stored queue intent bodies by default. Use `openwaggle sessions export read <session-id> <export-operation-id> --include-queue-bodies` (or the same flag on `export list`/`export wait`) only when the active access profile grants both Session read and queue access. `export watch --jsonl` is a command event stream, so it uses the same outer `type: "record"` envelope, cursor checkpoint, and `resync-required` records as `sessions watch`, including when unrelated export events are filtered out.

On Windows, workspace-scoped artifact export currently fails closed because the platform does not provide the descriptor-relative installation semantics OpenWaggle requires to prevent path-swap attacks. Use streaming export to stdout instead, for example `openwaggle sessions export <session-id> --format markdown > conversation.md`.

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

openwaggle sessions list --profile ci-helper --json
openwaggle access profiles revoke ci-helper
```

Named profiles enforce their policy at the Session Host API and authenticate with their own credential; a restricted Windows client does not need access to the desktop owner's credential. Windows rotates the Local Session pipe name for every Host launch and publishes it only in the current user's protected Session Host directory. Before accepting clients, it also verifies a protected DACL that grants only the current Windows user SID. If Windows cannot apply and verify that DACL, the Session Host refuses to start instead of using the operating system's broader default pipe permissions. Elevated and unelevated processes for the same Windows account can reach the pipe, then named-profile policy determines their OpenWaggle authority. Named profiles do not contain a process that can also invoke the CLI as the same unrestricted user. Use an OS sandbox, separate account, or container when an external agent must be unable to recover owner authority. OpenWaggle-hosted agents should use the native `sessions` tool; the bundled shell marks agent runs and refuses accidental profile-less CLI use, but that marker is a guardrail rather than a security boundary.

The generated credential is stored separately from the profile policy. Profiles are authenticated, scoped, revocable, and never inherit a broader `YOLO` preference implicitly. CLI errors use stable nonzero exit classes for usage (2), authentication (3), authorization (4), not-found (5), conflict (6), timeout (7), Host-unavailable (8), and internal failures (1). With `--json`, Access command failures emit `{"schemaVersion":1,"type":"error","error":{"kind":"...","message":"..."}}` on stderr. A rejected profile-management response remains a structured response on stdout and uses the matching nonzero exit class, consistent with rejected Session commands.

Run `openwaggle sessions help`, `openwaggle access profiles help`, or `openwaggle agents help` for the complete operation and flag list.
