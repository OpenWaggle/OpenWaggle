---
title: "Sessions CLI"
description: "Discover, control, watch, and export OpenWaggle Sessions from a terminal or another agent."
order: 3
section: "Developer Workflow"
---

The `openwaggle` CLI is a client of the same local Session Host as the desktop app. It does not open the Session database directly. Commands can start the Host on demand, accepted Runs continue when the GUI closes, and Host events keep an open GUI synchronized with CLI activity.

On macOS and Linux, install or update the command from Settings > Agent Access > OpenWaggle CLI. The managed user shim is written to `~/.local/bin/openwaggle`; OpenWaggle reports when that directory is missing from `PATH` and never overwrites an unrelated file. The Windows installer manages the command. From a source checkout, use `pnpm cli:dev -- <command>`.

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

Lexical multiword searches match all tokens in any position. Wrap the complete search text in literal double quotes when word order and adjacency are required, for example `openwaggle sessions search '"authorization migration"' --mode lexical`.

`read --full` streams a stable high-water-mark snapshot page by page, so an agent can retrieve the complete transcript without accumulating it in memory. Pages are bounded by both record count and encoded bytes; a Session with large messages therefore produces smaller pages automatically. A single pathological record that cannot fit in one bounded response fails with `record_too_large` instead of crashing the Host. Machine consumers should use `--json` for one response and `--jsonl` for streams.

Ordinary search defaults to hybrid mode over the discovery projection and requires `sessions:discover`. `search --full-transcript` defaults to lexical mode, can inspect older transcript content, and additionally requires `sessions:read`; discovery-only profiles cannot use it. Pass `--mode semantic` or `--mode hybrid` explicitly when semantic transcript matching is useful. Those modes lazily prepare durable node embeddings only for the authorized query scope, up to 1,000 sessions. Use `--require-fresh --timeout-ms <ms>` to wait for every node admitted by the bounded semantic-storage policy.

Semantic transcript storage is a local, rebuildable cache rather than the authoritative transcript. It retains at most 5,000 recent searchable nodes per Session, 50,000 node records and 64 MiB of vectors in total, and 10,000 queued nodes. Inactive scopes expire after seven days and are reclaimed least-recently-used; an active prepare, wait, or search holds a durable lease and cannot be evicted. When a Session or the active authorized scope exceeds a limit, readiness becomes `partial` with exact counts and a reason instead of waiting forever. Semantic-only search may use the available partial projection, while hybrid search reports `semantic_partial_coverage` and uses the complete lexical index. The discovery window is marked truncated. `read --full` and lexical full-transcript search remain complete and are not limited by this semantic cache.

Full-transcript matches identify the matching transcript node, Run when known, and durable order. The searchable transcript projection includes visible user and assistant text, attachment names, tool names, compact success/failure outcomes, summaries, and visible OpenWaggle orchestration messages. It never indexes raw node JSON, reasoning bodies, tool arguments, textual tool results, or extracted attachment bodies. Empty internal nodes are skipped.

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

Use `message` when adaptive start-or-queue behavior is wanted. Use `follow-up` when the message must remain pending for the next Run, or `steer` when it must enter the current Run. Run-targeted mutations require `--expected-run`; stale callers fail instead of steering or interrupting the wrong Run.

Profiles that use `replace` need both `sessions:message` and `sessions:interrupt`. A `sessions:start` grant does not substitute for message authority during Run replacement.

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

`sessions wait` blocks until an idle, queue-empty, or state-revision condition is reached. `sessions watch` subscribes to the ordered Host event stream. JSONL output emits versioned `{ "kind": "cursor", "cursor": ... }` records for the initial subscription boundary and whenever a scoped watcher advances past a filtered event. Persist the latest emitted Host identity and sequence, including the cursor embedded in visible events, and reconnect with `--after-host` and `--after-sequence`. A `resync-required` record means the client must reload canonical state.

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

Streaming export writes to stdout and byte-pages large transcripts automatically. Artifact export is durable, supports status/list/read/cancel/watch operations, validates destination and resource scope, and refuses an existing destination unless `--overwrite` is explicit. Export-operation listings are also byte-paginated so large captured manifests cannot make status discovery unresponsive. `export watch --jsonl` uses the same cursor checkpoint and `resync-required` records as `sessions watch`, including when unrelated export events are filtered out.

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
