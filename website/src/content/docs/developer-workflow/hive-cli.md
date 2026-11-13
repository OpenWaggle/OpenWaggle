---
title: "Hive CLI"
description: "Every openwaggle hive and openwaggle access command, the JSON output, error kinds and exit codes, and the Session Host protocol revisions."
order: 5
section: "Developer docs"
kind: "reference"
---

`openwaggle hive` finds, reads, starts, messages, waits on and exports OpenWaggle sessions from a terminal or another agent tool. For a walkthrough, see [Control a Hive from outside the app](/docs/using-openwaggle/hives-and-sessions#control-a-hive-from-outside-the-app).

## Commands

In these tables, `<session>` is a session ID or a session link copied from the desktop app, such as `openwaggle://sessions/<session-id>`.

### Find and read

| Command | Syntax | What it does |
| --- | --- | --- |
| `list` | `hive list [--project <path> \| --all] [--parent <session>] [--archived]` | Lists sessions in the current project. |
| `search` | `hive search <query> [--mode hybrid\|lexical\|semantic] [--full-transcript] [--include-archived]` | Searches sessions. |
| `read` | `hive read <session>` | Reads one session's summary and state. |
| `read --full` | `hive read <session> --full --jsonl` | Streams the whole transcript. |
| `status` | `hive status <session>` | Shows the current run, with its ID, and the queue. |
| `turns` | `hive turns <session> [--limit <n>] [--cursor <cursor>]` | Pages through turns. |
| `items` | `hive items <session> [--after <order>] [--limit <n>]` | Pages through transcript items. |
| `wait` | `hive wait <session>... [--condition <condition>] --timeout-ms <ms>` | Waits until one of the sessions meets a condition, `idle` by default. See [Wait and watch](#wait-and-watch). |
| `watch` | `hive watch [<session>...] [--after-host <id> --after-sequence <n>]` | Streams the Session Host's events. |

### Start and message sessions

| Command | Syntax | What it does |
| --- | --- | --- |
| `create` | `hive create <project> [--title <title>] [--workspace <choice>]` | Creates an idle session. |
| `launch` | `hive launch <project> --text <objective> [--workspace <choice>]` | Creates a session and starts its first run. |
| `fork` | `hive fork <session> [--target-node <node-id>] [--position before\|at]` | Creates a session from a point in another transcript. |
| `spawn` | `hive spawn <parent> --expected-run <run-id> --text <objective> [--workspace <choice>]` | Creates a worker under a running parent and starts it. |
| `message` | `hive message <session> --text <message>` | Starts a run if the session is idle, or queues a follow-up. |
| `start` | `hive start <session> --text <message>` | Starts a run on an idle session. It never queues. |
| `follow-up` | `hive follow-up <session> --text <message>` | Queues a separate next run. |
| `steer` | `hive steer <session> --expected-run <run-id> --text <message>` | Adds input to the current run. |
| `replace` | `hive replace <session> --expected-run <run-id> --text <message>` | Stops the current run and starts a new one in its place. |
| `interrupt` | `hive interrupt <session> --expected-run <run-id>` | Stops the current run. |
| `interrupt-descendants` | `hive interrupt-descendants <session>` | Stops the runs of every worker below the session. |
| `report` | `hive report <session> --text <message> (--upstream \| --queen \| --target <session> \| --worker <name>)` | Passes a note to another session without starting a run. `--worker` picks a worker by its ID, title or agent definition name. |

### Manage sessions

| Command | Syntax | What it does |
| --- | --- | --- |
| `rename` | `hive rename <session> <title>` | Changes a session's title. |
| `archive`, `unarchive` | `hive archive <session>` | Archives a session, or brings it back. Nothing is deleted. |
| `handoff` | `hive handoff <session> --workspace local\|existing\|new-worktree [--workspace-id <id>]` | Moves a session to another workspace. |
| `authorization-set` | `hive authorization-set <session> inherit\|ask-for-approval\|yolo` | Changes a session's access mode. `inherit` goes back to the project's or app's mode. |

### Queue and requests

| Command | Syntax | What it does |
| --- | --- | --- |
| `queue-list` | `hive queue-list <session> [--include-bodies]` | Lists queued follow-ups and the queue revision. `--include-bodies` adds their text. |
| `queue-pause`, `queue-resume` | `hive queue-pause <session> --queue-revision <n>` | Pauses or resumes the queue. |
| `queue-reorder` | `hive queue-reorder <session> <follow-up-id>... --queue-revision <n>` | Puts follow-ups in a new order. |
| `queue-withdraw` | `hive queue-withdraw <session> <follow-up-id>...` | Removes follow-ups before they are sent. |
| `promote` | `hive promote <session> <follow-up-id> --expected-run <run-id>` | Sends a queued follow-up into the current run. |
| `requests-list` | `hive requests-list <session>` | Lists questions and approvals a run is waiting on. |
| `request-respond` | `hive request-respond <session> <run-id> <request-id> <answer>` | Answers a question. See [Answer a request](#answer-a-request). |
| `approval-respond` | `hive approval-respond <session> <run-id> <request-id> allow\|deny [--for once\|session\|project]` | Answers an approval request. |

`approval-respond` takes `allow` or `deny`. With `allow`, `--for session` keeps the approval for the rest of the session and `--for project` keeps it for the project. Without `--for`, or with `--for once`, it covers this one request. `--for` does not go with `deny`.

#### Answer a request

`request-respond` first reads the run's pending requests to learn what kind of answer the request wants. The profile you use therefore needs `sessions:read` as well as `sessions:respond`. Give exactly one answer option:

| Request | Answer options |
| --- | --- |
| Pick one of several choices (`select`) | `--choice <item>`, or `--dismiss` to pick none |
| Type an answer or edit text (`input`, `editor`) | `--text <text>`, `--stdin` or `--input-file <path>`, or `--dismiss` for no answer |
| Yes or no (`confirm`) | `--confirm` or `--decline` |
| A notice (`notify`) | `--acknowledge`, though a notice never waits for an answer, so the Session Host never has one pending |
| An extension's own request (`custom`) | `--value-file <path>` or `--value-file -` with one JSON value, or `--dismiss` for no value |

`--dismiss` on a yes-or-no request declines it, as closing the dialog does. `--value-file -` reads the JSON value from stdin. An option that does not fit the request's kind fails as a usage error (exit 2) and names the options that fit. `requests-list` shows only the requests the caller may answer. When the request is not there, the CLI asks the Session Host why, with an answer that cannot settle anything, and fails with the reason:

- `capability_denied` (exit 4) when the caller lacks `sessions:respond`.
- `interaction-mismatch` (exit 6) for a pending approval request the caller may not answer.
- `interaction-not-found` (exit 5) for a request that is not pending.

A retry with the same `--idempotency-key` is safe. When the request is no longer pending, the CLI sends the answer anyway, and the Session Host returns the outcome it recorded for that key, or `interaction-not-found` (exit 5) if it recorded none. That works for `--choice`, `--confirm`, `--decline` and `--value-file`. `--text`, `--stdin`, `--input-file` and `--dismiss` fit more than one kind of request, so the CLI cannot rebuild the recorded answer from them, and the retry fails with `not_found` without sending it. An approval request needs `approval-respond`. For one, `request-respond` asks the Session Host as it does for an unlisted request, so the exit is the same whether or not the caller can see the approval: `capability_denied` (exit 4) without `sessions:respond`, or `interaction-mismatch` (exit 6) with it. The message names the `approval-respond` command when the caller can see the approval.

### Delegations and agent definitions

| Command | Syntax | What it does |
| --- | --- | --- |
| `delegations-list` | `hive delegations-list [--parent <session>] [--worker <session>] [--state <state>]...` | Lists delegations, newest first. |
| `delegations-read` | `hive delegations-read <delegation-id> [--limit <n>] [--cursor <cursor>]` | Pages through one delegation's history. |
| `delegations-conflicts` | `hive delegations-conflicts [--delegation <id>] [--kind live-overlap\|merge-overlap] [--status <status>]` | Lists overlaps between workers' claims. `--status` is `unacknowledged`, `acknowledged` or `resolved`. |
| `delegation-submit` | `hive delegation-submit <worker> <delegation-id> <summary> [<evidence>]` | A worker submits its result as a new revision. |
| `delegation-state` | `hive delegation-state <worker> <delegation-id> working\|waiting\|needs_attention <reason>` | A worker sets its own state, with a reason. |
| `delegation-claim` | `hive delegation-claim <worker> <delegation-id> <reason> [<claims>]` | A worker records the files or areas it plans to change. Claims lock nothing. |
| `delegation-propose-amendment` | `hive delegation-propose-amendment <worker> <delegation-id> <base-revision> <reason> <changes>` | A worker proposes a change to its task. |
| `delegation-amend` | `hive delegation-amend <parent> <delegation-id> <expected-revision> <reason> (<changes> \| --proposal <proposal-id>)` | Changes the task, or accepts a proposed change. |
| `delegation-request-revision` | `hive delegation-request-revision <parent> <delegation-id> <revision> <feedback>` | Asks for a new revision. The worker gets the feedback as a follow-up. |
| `delegation-accept` | `hive delegation-accept <parent> <delegation-id> <revision> [note]` | Accepts one submitted revision. |
| `delegation-verify` | `hive delegation-verify <parent> <delegation-id> <revision> passed\|failed\|inconclusive <summary> [<evidence>]` | Records a check of a submitted revision. |
| `delegation-reopen` | `hive delegation-reopen <parent> <delegation-id> <reason>` | Reopens an accepted delegation. The worker gets the reason as a follow-up. |
| `delegation-cancel` | `hive delegation-cancel <parent> <delegation-id> <reason>` | Cancels an open delegation. |
| `delegation-dependency` | `hive delegation-dependency <parent> <delegation-id> add\|remove <dependency-id> ready_for_review\|accepted <reason>` | Makes a delegation wait for another to reach a state, or stops it waiting. |
| `delegation-conflict-acknowledge` | `hive delegation-conflict-acknowledge <parent> <delegation-id> <conflict-id> <reason>` | Marks a conflict between claims as seen. |
| `agent-definitions-list` | `hive agent-definitions-list [--project <path>]` | Lists the project's enabled agent definitions. |
| `agent-definitions-search` | `hive agent-definitions-search <query> [--project <path>]` | Searches them by name and description. |

#### Evidence, claims and task changes

`<evidence>` on `delegation-submit` and `delegation-verify` is any number of these options, each repeatable:

| Option | Evidence |
| --- | --- |
| `--evidence-command <summary>` | A command that ran, and what it showed |
| `--evidence-diff <summary>` | A change in the workspace |
| `--evidence-note <summary>` | Something the agent states |
| `--evidence-artifact <path-or-url>` | A file or link |
| `--evidence-source <reference>` | A place in the source, such as `src/main/a.ts:12` |

For an artifact or a source, the value is both the reference and the summary.

`<claims>` on `delegation-claim` is any number of these options, each repeatable. Each `delegation-claim` replaces the worker's earlier claims, so one with no claim options clears them.

| Option | Claims |
| --- | --- |
| `--read <path>`, `--write <path>` | One file in the workspace |
| `--read-tree <dir>`, `--write-tree <dir>` | A folder and everything in it |
| `--read-resource <scope>:<namespace>/<name>`, `--write-resource ...` | A named resource, such as `project:ports/5173` |

`<scope>` is `project` or `repository`.

`<changes>` on `delegation-propose-amendment` and `delegation-amend` uses the options `spawn` uses for a worker's task. A field you leave out keeps its current value, so pass only what changes:

| Option | Changes |
| --- | --- |
| `--objective <text>` | The task |
| `--deliverable <text>`... | The deliverables |
| `--accept <criterion>`... | The acceptance criteria |
| `--resource <reference>`... | The resource references |
| `--depends-on <delegation-id>[:accepted]`... | The delegations it waits for |
| `--handoff <text>` | The handoff context |
| `--no-deliverables`, `--no-acceptance-criteria`, `--no-resources`, `--no-dependencies`, `--no-handoff` | Empties that field |

A dependency waits for `ready_for_review` unless you add `:accepted`. A list option replaces the whole list, so repeat it for every item you want to keep. These commands read the delegation first, so the profile you use also needs `delegations:read`. If the Session Host refuses that read, or the read of pending requests for `request-respond`, the command fails with the refusal's error kind and exit code, and the message names its code. `delegation-amend --proposal <proposal-id>` applies a proposal exactly as proposed, so it takes no change options. To accept a proposal with changes, amend without `--proposal`. Without `--proposal`, both commands need at least one change. The changes apply to the specification at the revision you pass, so they cannot undo a change made since you read it. The Session Host refuses a revision that is no longer current with `specification_revision_stale` (exit 6). A retry with the same `--idempotency-key` sends the same command again, so the Session Host returns the result it recorded the first time.

### Export

| Command | Syntax | What it does |
| --- | --- | --- |
| `export` | `hive export <session> [--format markdown\|jsonl] [--scope active-branch\|tree]` | Streams a transcript to stdout, as Markdown unless you pass `--format jsonl`. |
| `export-create` | `hive export-create <session> <destination> [--format jsonl\|markdown\|bundle] [--overwrite]` | Writes an export to a file or folder, as JSONL unless you pass another `--format`. |
| `exports-list` | `hive exports-list <session>` | Lists file exports. |
| `exports-read` | `hive exports-read <session> <operation-id>` | Reads one file export. |
| `exports-wait` | `hive exports-wait <session> <operation-id> --timeout-ms <ms>` | Waits for a file export to finish. |
| `export-cancel` | `hive export-cancel <session> <operation-id>` | Cancels a file export. |
| `exports-watch` | `hive exports-watch <session> [<operation-id>]` | Streams export events. |

### Access profiles

| Command | Syntax | What it does |
| --- | --- | --- |
| `profiles create` | `access profiles create <name> --capability <capability>... <scope> --credential-store` | Creates a profile and stores its credential. |
| `profiles update` | `access profiles update <name> --capability <capability>... <scope>` | Changes a profile's capabilities and scope. |
| `profiles list` | `access profiles list [--include-revoked]` | Lists profiles. |
| `profiles rotate` | `access profiles rotate <name> --credential-store` | Gives a profile a new credential. |
| `profiles revoke` | `access profiles revoke <name>` | Revokes a profile. |

`<scope>` is `--all`, or one or more of `--project <path>`, `--session <session>` and `--hive <root-session>`. `--authorization ask-for-approval|yolo` sets the profile's access limit, `ask-for-approval` by default. A profile that gets `access:profiles` can also take the `--manage-*` options described in [Profiles that manage other profiles](#profiles-that-manage-other-profiles). `--credential-file <path>` writes the credential to a file instead of the credential store, and `--replace` overwrites an existing credential at the destination.

Run `openwaggle hive help`, `openwaggle access profiles help` or `openwaggle agents help` for every operation and flag.

## Names

The CLI, the agent's `hive` tool and the `openwaggle_hive` MCP tool use the same names. Every tool action is a `hive` subcommand and an MCP operation, with `-` in place of `_`. For example, the tool's `follow_up` is `openwaggle hive follow-up`, `delegation_accept` is `openwaggle hive delegation-accept`, and `agent_definitions_search` is `openwaggle hive agent-definitions-search`. Scheduled tasks are the exception. They have their own [`openwaggle schedules`](/docs/using-openwaggle/scheduled-tasks) command. [Hive actions and states](/docs/reference/hive) lists every action with the capability it needs.

Before 1.0 these commands were `openwaggle sessions`, `openwaggle delegations` and `openwaggle agents list|search`. Those names no longer work. `openwaggle agents` still validates, imports, explains and edits [definition files](/docs/extending/agent-definitions).

## Where the CLI runs

The CLI talks to the local Session Host, the process that runs sessions and saves them. It never opens the database itself. A command starts the Session Host when it needs to, and a run it started keeps going after you close the desktop app. Sessions the CLI creates are the same sessions the app shows, so a worker spawned from the CLI appears in the Hive panel and the Session Summary.

An agent running inside OpenWaggle should use its `hive` tool. The CLI is for people in a terminal and for agents running in other tools. For opening the app, `openwaggle run`, `openwaggle status` and the full command list, see [Command line](/docs/developer-workflow/command-line).

The installed app includes the CLI. On macOS and Linux, the packaged app installs or refreshes its command at `~/.local/bin/openwaggle` when it starts, so make sure `~/.local/bin` is on your shell's `PATH`. OpenWaggle never overwrites an unrelated file at that path. If the command is missing, check for a conflicting file there. The Windows installer manages the command. From a source checkout, use `pnpm cli:dev -- <command>`.

## Session IDs and links

Every session ID operand accepts a session link as well as an ID. So do `--target` and `--worker` on `report`, the `--parent` and `--worker` filters of `delegations-list` and `delegations-conflicts`, and the `access` scopes `--session` and `--hive`.

Read worker and delegation IDs from the `spawn` response. Do not guess them from a title.

## Discovery and reading

`list`, `search`, `delegations-list` and `delegations-conflicts` look at the current project by default. That is the project of the folder you run them in, with its main checkout and every worktree of it. Use `--project <path>` for another project, or `--all` for every session you may see.

`list` and `search` leave archived sessions out. `list --archived` lists only archived ones, `search --include-archived` searches them too, and `list --parent <session>` lists only that session's direct workers. `delegations-list` shows every state, newest first, unless `--state` narrows it.

Hybrid search combines word matching from the index with similarity of meaning. `--require-fresh` waits for the meaning index to catch up instead of returning a readiness marker.

A search for several words matches sessions that contain all of them, anywhere in the session. When the words must appear together and in order inside one transcript item, wrap the whole search in literal double quotes, for example `openwaggle hive search '"authorization migration"' --mode lexical`. A quoted phrase never joins text across two messages or tool events, so every phrase result points at one item.

`read --full` streams a fixed snapshot of the transcript, page by page, so an agent can fetch the whole transcript without holding it in memory. Each page has a limit on records and on bytes, so a session with large messages gets smaller pages. A single record too large for any page fails with `record_too_large` instead of crashing the Session Host. Programs should use `--json` for one response and `--jsonl` for streams.

## JSON output

With `--json`, a command that returns one response prints a `type: "response"` envelope with a schema version on stdout, and puts the command's result in `result`. Its `command` is the command as you typed it after `openwaggle`, without operands, such as `hive list`, `hive delegation-accept`, `schedules list`, `host stop` or `update` (for `update --check --json`). When the Session Host refuses a request, the response still goes to stdout, and the command exits with the code for that kind of error. It does not also print an error on stderr. Streams such as `read --full`, `watch` and `exports-watch` use `--jsonl`. Every stdout line then has `type: "record"` and puts the streamed value in `record`.

A failure that stops the command before it has a result prints a `type: "error"` envelope on stderr. That covers invalid usage, failed authentication or authorization, connection failures and internal errors. It also covers what `request-respond` and the amendment commands learn before they send the command: a refused read of the pending requests or the delegation, and the reason a request is not listed or an approval cannot be answered with `request-respond`. Those errors carry the Session Host's `code`, such as `capability_denied`, `interaction-not-found` or `interaction-mismatch`, as does any refusal the Session Host sends as an error, such as a capability it refuses before it runs a command. The `code` field is optional: it is there only when the Session Host refused something, and its values are the Session Host's refusal codes, so new ones may appear. Its kind and exit code are the ones the Session Host's table gives that code, wherever it comes from. So the same code can come on stderr, when the CLI finds it first, or on stdout, when the Session Host refuses the command it was sent. A keyed retry with nothing recorded, and an amendment whose revision is not current, are the second case.

```json
{"schemaVersion":1,"type":"response","command":"hive list","result":{"contract":"session-query-v2","response":{"contractVersion":2,"requestId":"request-1","outcome":{"operation":"list","sessions":[]}}}}
{"schemaVersion":1,"type":"record","record":{"kind":"cursor","cursor":{"hostInstanceId":"host-1","sequence":42}}}
{"schemaVersion":1,"type":"error","error":{"kind":"authorization","message":"Session command refused (capability_denied): the caller lacks a Session capability this operation requires.","code":"capability_denied"}}
```

### Error kinds and exit codes

Every `openwaggle` command (`hive`, `access`, `agents`, `recovery`, `schedules`, `status`, `host`, `run`, `update` and `mcp`) reports a failure with one of the kinds below and exits with its code. With `--json` or `--jsonl` the kind is in the error envelope. Without them, the message starts with `error [<kind>]:`. The kind comes from what failed, never from the wording of the message.

When the Session Host refuses a request, it names the kind itself. A rejected outcome and a query's `outcome.error` carry `kind` next to `code`, and the CLI exits with the code for that kind. From 1.0 a refusal code keeps its kind for the whole major version, and a later version may add kinds.

| Kind | Exit code | Meaning |
| --- | --- | --- |
| `usage` | 2 | The command or its request cannot run as typed. Nothing was changed. `request-respond` and the amendment commands may have read from the Session Host first. |
| `authentication` | 3 | A credential is missing, unreadable or refused. |
| `authorization` | 4 | The caller may not do this. |
| `not_found` | 5 | The session, delegation or other target does not exist. |
| `conflict` | 6 | The current state refuses it. |
| `timeout` | 7 | A time limit ran out. |
| `host_unavailable` | 8 | The Session Host cannot be reached, started or spoken to. |
| `resync_required` | 9 | A stream lost its place in the Session Host's events. Reload the current state. |
| `internal` | 1 | Anything else, an unexpected failure. |

What each kind covers:

- `usage` covers an unknown option, a missing operand, a bad value, or an `update --version` older than the installed one. It also covers a request the Session Host finds incomplete, such as a delegation change without its required reason (`transition_reason_required`) or an empty report (`report_empty`).
- `authentication` covers an unknown or revoked access profile, and one whose credential was rotated. It also comes back while the Session Host slows down repeated failed attempts, so retry later.
- `authorization` covers a missing capability, a session outside the caller's scope (`target_scope_denied`), a delegation change only its parent or its worker may make (`parent_required`, `worker_required`), a revision request or reopen from a caller that may not message the worker (`worker_message_denied`), and an OpenWaggle agent that uses the CLI without a named profile.
- `not_found` comes with `session_not_found`, `delegation_not_found`, `interaction-not-found` for a request that is not pending, and the other codes for a target that does not exist.
- `conflict` covers a stale run or queue revision, an existing credential destination without `--replace`, a destination that changed after a repeatable operation, and most other refusals of the current state.
- `timeout` covers a `hive wait` or `hive exports-wait` that ended before its condition was met. Both still print their response on stdout. For `run`, it means a question went unanswered past `--interaction-timeout-ms`, so OpenWaggle stopped the run. `host stop` returns it when, with `--wait`, the Session Host's work outlasted `--timeout-ms`, or when, with `--update`, the Session Host had not exited after 20 seconds. It also covers an update download or a Session Host request that took too long, and an `update --check --json` release check that did not finish within 30 seconds.
- `resync_required` comes from `hive watch` and `hive exports-watch` when the Session Host restarted, no longer has the cursor you passed, was passed a cursor for an event it has not sent, or dropped a subscriber that fell behind. The last stdout record is then the `resync-required` record. `hive export` stops with it when a transcript node changed between two of its pages; start the export again.

An ID that does not exist gets the same answer from every action. A query's `outcome.error.code`, or a command's rejected outcome `code`, is `session_not_found` or `delegation_not_found`, and the CLI exits with 5. That holds for `read`, `status`, `follow-up`, `steer`, `wait`, `report` targets, `delegations-read`, `delegation-accept`, and the `--parent` and `--worker` filters of `delegations-list` and `delegations-conflicts`.

An ID that exists outside the caller's scope answers `target_scope_denied` and exits with 4, also for those filters. A `report` to such a target answers `target_not_authorized`, also exit 4. OpenWaggle keeps the two answers apart on purpose. Session and delegation IDs are random, so the answer tells a caller nothing about an ID it did not already have, and it says whether more access would help. The agent's `hive` tool returns the same outcomes, and every refusal of the `openwaggle_hive` MCP tool, from the Session Host or from the server's own grants and scope, fails with a message that starts with the code and its kind, such as `session_not_found (not_found): Session not found.`

### Exit codes that changed before 1.0

Before 1.0 the CLI guessed some kinds from the words in a refusal code, and gave a refusal it could not place exit 6, or exit 1 when the refusal stopped the command. The Session Host now names the kind, so these refusals exit with a different code than in earlier betas. The rejected outcomes of `access` and `schedules` keep their exit codes, except the `access` case in the last row.

| Exit code | Refusals |
| --- | --- |
| 1 → 9 | `hive watch` or `hive exports-watch` ending with a `resync-required` record, and `hive export` refused with `resync_required` because the transcript changed between pages |
| 6 → 2 | `amendment_reason_required`, `claim_reason_required`, `conflict_acknowledgement_reason_required`, `dependency_reason_required`, `transition_reason_required`, `verification_summary_required` |
| 6 → 2 | `submission_empty`, `report_empty`, `claim_target_invalid`, `delegation_dependency_invalid`, `delegation_specification_invalid` |
| 6 → 2 | `invalid_cursor`, `reserved_idempotency_key`, `invalid-response-payload` |
| 6 → 4 | `parent_required`, `worker_required`, `authority_changed`, `follow_up_adopt_requires_desktop_user`, `follow_up_edit_requires_desktop_user` |
| 6 → 5 | `interaction-not-found`, also when `request-respond` finds the request is not pending before it sends an answer |
| 4 → 6 | `run_authorization_override_requires_idle_session` |
| 5 → 6 | `delegation_workspace_missing` |
| 1 → 6 | `subscription_limit_exceeded`, and `profile_admission_changed` and `profile_credential_rate_limited`, which can also stop `access profiles` |
| 1 → the refusal's code | Any other refusal of a later page of `hive export` or `hive read --full`, such as `record_too_large` (6) |
| 1 → the refusal's code | `access profiles create` or `rotate` refused while it keeps a credential staged by an earlier attempt |

Two `access profiles` codes were renamed, with the same exit codes. A change to a revoked profile answers `target_profile_revoked` (exit 6) instead of `profile_revoked`, and a profile name that does not exist answers `target_profile_not_found` (exit 5) instead of `profile_not_found`. `profile_revoked` and `profile_not_found` now mean only that the caller's own profile was revoked or deleted, which exits with 3.

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
| Unused scopes | Expire after 7 days, least recently used first when space runs out |

A prepare, wait or search that is running holds a lease on its scope, so the cache never removes it mid-use. When a session or the current scope passes a limit, readiness becomes `partial`, with exact counts and a reason, instead of waiting forever. Semantic-only search may use what is indexed. Hybrid search reports `semantic_partial_coverage` and uses the complete word index. OpenWaggle marks the discovery window as truncated. `read --full` and full-transcript word search are always complete, because the cache does not limit them.

A single-word or quoted full-transcript match names the transcript item, the run when known, and the item's position. A match for several unquoted words may combine words from several items. Then it names only the session, rather than pretending one item contains the whole query.

Full-transcript search covers visible user and assistant text, attachment names, tool names, short success or failure outcomes, summaries, and visible OpenWaggle coordination messages. It never indexes raw item JSON, reasoning, tool arguments, textual tool results, or text extracted from attachments. It skips empty internal items.

## Messages and runs

Give message input with exactly one of `--text`, `--stdin`, `--input-file` or `--request-file <path>`. `--request-file` reads the complete typed request from a JSON file, or from stdin with `--request-file -`. Attach files with `--attach`, repeated for each file. `create`, `launch`, `fork` and `spawn` accept `--title`. `create`, `launch` and `spawn` accept `--agent`, `--model` and `--thinking`. `--thinking` sets the new session's starting thinking level. `launch` and `spawn` also accept `--yolo` when your access limit allows it. Workspace choices depend on the command, and `hive help` lists them. `spawn` takes `share-parent` for the parent's checkout (the default, unless the agent definition sets `workspace`), `local`, or `new-worktree` for a checkout of its own.

The thinking level is a session setting, like its model. `message` and `start` accept `--thinking` only when the session is idle and the command starts a run. The level then stays the session's thinking level for that run and later ones, but it never changes the desktop default for new sessions. In the same way, `message` and `start` accept `--authorization` or `--yolo` only when they start a run on an idle session. That override applies to the one run, stays within your access limit, and is never saved as the session's mode. An `--authorization ask-for-approval` override also applies to the runs OpenWaggle starts after it for worker updates, as the [Hive reference](/docs/reference/hive#when-a-worker-reports-to-an-idle-parent) describes. While a run is active, the Session Host refuses a `message` that would be queued with `thinking_level_requires_idle_session` or `run_authorization_override_requires_idle_session`. `follow-up`, `steer` and `replace` never accept these options, so a queued follow-up always runs with the session's settings when it starts.

Use `message` when you want it to start now or queue, whichever fits. Use `follow-up` when the message must be a separate next run, and `steer` when it must go into the current run. A follow-up stays queued while a run is active. If that run ends just before the Session Host accepts the follow-up, it starts the follow-up as the next run instead of leaving it stuck. Commands that act on a run need `--expected-run`, and `status` shows the current run's ID. If that run is no longer current, the command fails instead of steering or stopping the wrong run.

A profile that uses `replace` needs both `sessions:message` and `sessions:interrupt`. `sessions:start` does not stand in for message access when replacing a run.

OpenWaggle reserves idempotency keys that start with `pi-session-discovery:` for the sessions it creates for discovered Pi sessions. A `create` that passes one with `--idempotency-key` fails with `reserved_idempotency_key`.

### Steering receipts

A successful `steer` or `promote` returns a delivery `receipt`:

| `delivery` | Meaning |
| --- | --- |
| `queued` | Pi accepted the input for the current run. It may not be in the transcript yet. |
| `handled` | An extension handled the command without queueing a user message. |
| `unavailable` | A replayed success saved by an older Session Host that recorded no receipt. The Session Host never runs it again to rebuild one. |

A `queued` receipt also carries `durableTextSha256` and `minimumCreatedOrder`. `durableTextSha256` is the lowercase SHA-256 of the exact first text block as it will be saved, encoded as UTF-8, after Pi's input transformations. It leaves out image-placeholder text. `minimumCreatedOrder` is the earliest session item order that can match, captured after compaction and before queueing, so an older identical prompt cannot count as this steer. It is not an index into the visible, compacted transcript. Steering receipts arrived in local session protocol revision 8. Current clients must use the revision the installed Session Host accepts. Use `watch` or `read` to see the message arrive.

If the run ends before Pi takes in a queued steer, the Session Host puts it back at the front of the follow-up queue. A promoted follow-up keeps its ID. A direct `steer` becomes a new follow-up from the same caller, and its `queue-list` item carries `returnedSteer` with the steer's run and idempotency key, so check the queue before you send it again. The Session Host refuses a steer that is still waiting for compaction when the run ends, so the caller keeps it. It refuses a direct `steer` with `queue_capacity_reached` while the follow-up queue is full, or with `steering_capacity_reached` when the run already holds the most steers it could return.

## Queue rules

A question from the agent survives the desktop app disconnecting and never expires on its own. Answer it in the app or with the CLI. Queue changes take the queue revision you last read, so two callers cannot overwrite each other's changes without noticing.

A follow-up queue holds at most 256 entries and 32 MiB of saved messages. Adding past either limit fails with `queue_capacity_reached` or `queue_byte_capacity_reached`. Withdraw or deliver entries before you retry. The limits keep the memory that queue changes, updates and recovery use small. Delivery is still one entry at a time.

## Wait and watch

`hive wait` blocks until one of its sessions meets the `--condition`:

| Condition | Also needs | Met when |
| --- | --- | --- |
| `idle` (default) | | The session has no run in progress |
| `queue-empty` | | The session has no queued follow-ups |
| `state-revision-after` | `--after-state-revision <n>` | The session's state revision is higher than `<n>` |
| `report-delivered` | `--report-id <id>` | That report has reached the session |
| `correlated-reply` | `--correlation-id <id>` | A reply with that correlation ID has reached the session |

A `report` returns the `reportId` and `correlationId` these conditions take. A reply is a report sent with `--reply-to <report-id>`, and `--request-reply` asks the target for one.

A wait is one check with a time limit, not a subscription. If it times out, it exits with 7, and the session may still be running. It answers from the Session Host's current state, so it never returns `resync_required`. When the Session Host drops its internal subscription under heavy event load, or `--after-host` and `--after-sequence` name a cursor it no longer has, it reloads that state and keeps waiting until the condition matches or `--timeout-ms` runs out. `exports-wait`, the `hive` tool's `wait` and `exports_wait`, and the MCP `wait` and `exports-wait` operations behave the same.

`hive watch` subscribes to the Session Host's ordered event stream. Passing session IDs filters events inside the Session Host, before they take space in the subscription buffer. A watch without a filter receives every event the caller may see. JSONL output wraps every line in a versioned envelope, `{"schemaVersion":1,"type":"record","record":{...}}`. Inspect `line.record.kind`:

| `record.kind` | Fields | Meaning |
| --- | --- | --- |
| `cursor` | `cursor` | A checkpoint: where the subscription starts, or progress past an event the filter left out. |
| `event` | `cursor`, `timestamp`, `event` | One Session Host event. `event.kind` names it, and `event.sessionId` names its session when it has one. |
| `resync-required` | `reason`, `cursor` | The stream lost its place. The command then exits with 9. |

```json
{"schemaVersion":1,"type":"record","record":{"kind":"cursor","cursor":{"hostInstanceId":"host-1","sequence":42}}}
{"schemaVersion":1,"type":"record","record":{"kind":"event","cursor":{"hostInstanceId":"host-1","sequence":43},"timestamp":1767225600000,"event":{"kind":"session-state-changed","sessionId":"session-1","stateRevision":7,"operation":"message"}}}
{"schemaVersion":1,"type":"record","record":{"kind":"resync-required","reason":"cursor-expired","cursor":{"hostInstanceId":"host-1","sequence":90}}}
```

```js
const line = JSON.parse(rawLine)
if (line.type === 'record' && line.record.kind === 'cursor') {
  persistCheckpoint(line.record.cursor)
}
```

Save the latest Session Host identity and sequence you saw, including the cursor inside event records, and reconnect with `--after-host` and `--after-sequence`. A `cursor` is `{ hostInstanceId, sequence }`, and a watch resumed after it starts with the next event. A `resync-required` record means the client must reload the current state with `read` or `status`, then watch again from the record's `cursor`. Its `reason` is one of these:

| `reason` | Meaning |
| --- | --- |
| `host-restarted` | A new Session Host instance runs. Its sequence starts again. |
| `cursor-expired` | The Session Host no longer keeps events that old. |
| `cursor-ahead` | The cursor names an event the Session Host has not sent. |
| `slow-consumer` | The watch fell too far behind and the Session Host dropped it. |

`openwaggle run --jsonl` prints its events as the same `event` records, next to its own `launch-rejected` and `run-settled` records.

From 1.0 these are covered: the three record kinds and their fields, cursor and resume behavior, `timestamp`, `event.kind`, `event.sessionId`, and the `reason` values. Later versions may add event kinds, record kinds and fields, so skip a kind you do not know. The body of `session-transport` and `session-waggle-transport` events is not covered. It follows the Pi agent events and can change in any release. Use `read`, `status` or `turns` for a view that stays stable.

## Delegation history

`delegations-list --parent <session>` lists the delegations of a Queen or a worker. `delegations-read` pages through one delegation's history. Pass `--cursor` with the `nextCursor` of the page before. The cursor fixes one snapshot across all delegation history, so records added while an agent reads later pages do not shift or repeat that read. The Session Host may return fewer than `--limit` records to stay within its byte budget, so keep reading while `nextCursor` is present. A single history record too large for a page returns `record_too_large`.

Every session summary and delegation that carries a delegation state (`list`, `search`, `read`, `delegations-list` and `delegations-read`) also carries `nextActor`, who acts next on that worker. The Hive reference lists its values and how OpenWaggle works it out under [delegation states](/docs/reference/hive#delegation-states).

`agent-definitions-list` and `agent-definitions-search` print the names and descriptions to pass to `spawn --agent <name>`. Run from a session's worktree or a folder inside it, they read that session's project. They read any other folder, including a subfolder of a project, as its own project, the way `launch` reads it. Like the agent's tool, they leave out definitions turned off for the project, because `spawn` and `launch` refuse those. They read definition files in the CLI process, but they take `--profile` like every `hive` command. A named profile must sign in, which starts the Session Host if it is not running, and the CLI refuses an OpenWaggle agent without one. With nothing to list they print `No Agent definitions found.`

To pass information between sessions without starting another run, use `hive report <source-session> --upstream --text "..."`, or name a session with `--target <session>`.

## Export output

A streaming export writes to stdout and splits large transcripts into pages by size. Its `--format jsonl` output (also selected by the `--jsonl` stream shorthand) is a portable export artifact, not a command-stream envelope. The first line is `{ "record": "manifest", "manifest": { "schemaVersion": 1, ... } }`, and each line after it is a raw `{ "record": "node", "schemaVersion": 1, ... }` record. Read the top-level `exportLine.record` field, not `exportLine.type` or `exportLine.record.kind`.

```js
const exportLine = JSON.parse(rawLine)
if (exportLine.record === 'manifest') {
  readManifest(exportLine.manifest)
} else if (exportLine.record === 'node') {
  readTranscriptNode(exportLine)
}
```

OpenWaggle saves a file export, and you can follow it with `exports-list`, `exports-read`, `exports-wait`, `export-cancel` and `exports-watch`. It checks the destination and which resources it may read, and refuses an existing destination unless you pass `--overwrite`. Export listings are split into pages by size too, so large manifests cannot make status checks hang. Export list, read and wait responses leave out the text of queued messages by default. Pass `--include-queue-bodies` to `exports-read`, `exports-list` or `exports-wait` only when the access profile in use grants both session read and queue access. `exports-watch --jsonl` is a command event stream, so it uses the same outer `type: "record"` envelope, record kinds, cursor checkpoints and `resync-required` records as `hive watch`, also when it filters out unrelated export events. Its events are `session-export-changed`.

On Windows, a file export into a workspace currently fails. Windows lacks the file-system calls OpenWaggle uses to stop another process from swapping the path during the write. Use a streaming export to stdout instead, for example `openwaggle hive export <session-id> --format markdown > conversation.md`.

## Restricted external-agent profiles

The desktop user needs no named profile and follows normal OpenWaggle permissions. For another agent tool, create a profile you can revoke, with only the capabilities and targets it should have. Replace `PROJECT_PATH` with the project's folder.

To create the profile and store its credential:

```sh
openwaggle access profiles create ci-helper --capability sessions:discover --capability sessions:read --capability sessions:message --project PROJECT_PATH --authorization ask-for-approval --credential-store
```

To use it, pass `--profile`. Setting `OPENWAGGLE_PROFILE` to the profile's name works too. [Environment variables](/docs/reference/environment-variables#app-and-cli) lists it with `OPENWAGGLE_USER_DATA_DIR` and the other CLI variables.

```sh
openwaggle hive list --profile ci-helper --json
```

To revoke it:

```sh
openwaggle access profiles revoke ci-helper
```

An MCP client gets a profile's access through `openwaggle mcp serve --profile ci-helper`, which signs in with the same stored credential and can only narrow the profile further. See [OpenWaggle as an MCP server](/docs/configuration/mcp#openwaggle-as-an-mcp-server). Revoking the profile stops that server too.

The Session Host enforces a named profile's policy, and the profile signs in with its own credential, so a restricted Windows client does not need the desktop owner's credential. On Windows, the local session pipe gets a new name for every Session Host launch, published only in the current user's protected Session Host folder. Before it accepts clients, the Session Host checks that the pipe's access list grants only the current Windows user. If Windows cannot apply and check that list, the Session Host refuses to start rather than use the system's broader default pipe permissions. Elevated and normal processes of the same Windows account can both reach the pipe. The named profile then decides what they may do in OpenWaggle.

A named profile does not contain a process that can also run the CLI as the same unrestricted user. Use an operating system sandbox, a separate account or a container when an outside agent must not be able to get the owner's access back. OpenWaggle's own agents should use the `hive` tool. The agent's shell sets `OPENWAGGLE_AGENT_RUN=1`, so the CLI refuses to run there without a profile (exit code 4) and refuses `mcp serve --owner`. That marker is a guardrail, not a security boundary. [Environment variables](/docs/reference/environment-variables#set-for-agent-shell-commands) lists what the agent's shell gets.

OpenWaggle stores the generated credential apart from the profile's policy. Profiles sign in, have a scope, can be revoked, and never quietly take on a broader `YOLO` preference. `access` commands use the [error kinds and exit codes](#error-kinds-and-exit-codes) above. With `--json`, a result is `{"schemaVersion":1,"type":"response","command":"access profiles list","result":...}` on stdout, and a failure is `{"schemaVersion":1,"type":"error","error":{"kind":"...","message":"..."}}` on stderr, with the Session Host's `code` added when it refused the request. Without `--json`, they print readable lines. When the Session Host refuses a profile change, the response still goes to stdout and the command exits with the matching nonzero code, as refused session commands do.

`access profiles list` leaves out revoked profiles. Add `--include-revoked` to show them. A revoked profile keeps its record, for its audit history, and its name. Revoking a profile also removes, on this machine, its credential-store copy, its installation receipts, and the markers of its used staged credentials. A staged `.pending` credential stays, as a recovery file. When `create` or `rotate` writes the credential to `--credential-file`, the command removes an older credential-store copy, so `--profile` does not keep using an old credential. A profile with no stored credential fails with `No stored credential for access profile "<name>"`, and a credential the Session Host refuses names the profile and suggests rotating it.

### Profiles that manage other profiles

A profile with the `access:profiles` capability can create and update other restricted profiles, but only inside its Profile-management envelope. The envelope is the most capabilities, scope and access limit it may hand out. Only the desktop user, signed in without a named profile, can create such a profile. Set the envelope with these options on `access profiles create` or `update`:

| Option | What it sets |
| --- | --- |
| `--manage-capability <capability>`... | Capabilities it may grant, at least one |
| `--manage-all` | Every target |
| `--manage-project <path>`... | Projects it may grant, resolved from the current folder |
| `--manage-session <session>`... | Sessions it may grant, by ID or session link |
| `--manage-hive <root-session>`... | Hives it may grant, by their Queen's ID or link |
| `--manage-export-root <path>`... | Export folders it may grant |
| `--manage-attachment-root <path>`... | Attachment folders it may grant |
| `--manage-authorization ask-for-approval\|yolo` | The highest access limit it may grant, `ask-for-approval` by default |

The envelope needs `--manage-all`, or one or more of `--manage-project`, `--manage-session` and `--manage-hive`. The `--manage-*` options fail as a usage error on a profile that does not also get `--capability access:profiles`. `update` replaces the whole policy, so an `update` without them removes the profile's envelope.

When the managing profile creates or updates a profile, the Session Host checks the new policy against the envelope. Every capability must be in `--manage-capability`. Every project, session and Hive must be in the matching `--manage-*` list, unless the envelope has `--manage-all`. An envelope with only projects does not cover a session inside one of them. Export and attachment folders must each be listed, even with `--manage-all`. A `yolo` access limit needs `--manage-authorization yolo`.

The Session Host refuses the change with one of these codes:

| Code | Why |
| --- | --- |
| `missing_access_profiles` | The caller's profile does not have `access:profiles`. |
| `management_envelope_missing` | The caller's profile has `access:profiles` but no envelope. |
| `management_envelope_exceeded` | The new policy asks for more than the envelope allows. |
| `cannot_edit_own_policy` | The caller tried to change its own profile. |
| `profile_redelegation_requires_local_user` | The new profile would get `access:profiles` or an envelope of its own. Only the desktop user can create a profile that manages others. |
| `profile_credential_control_requires_local_user` | The caller tried to rotate or revoke another profile. A profile rotates or revokes only its own credential. |

A managing profile can also list profiles.

### Recover a lost credential

When credential recovery or cleanup fails, the CLI prints an error on stderr instead of treating the refusal as fully handled. OpenWaggle keeps a reused pending credential if a later request fails or is refused, because that does not settle the earlier operation. To settle an unknown outcome, repeat the same command with the same operation key as the same caller. A changed command or caller is not the same retry. Older pending credential files that do not record their original destination cannot be retried automatically, even with the same key. Use the reported protected path to recover them by hand. If removing a protected file fails, the error names where the file still is rather than claiming the secret was removed.

If the response to a profile creation or credential rotation is lost, the Session Host may already have made the change. OpenWaggle keeps the protected credential and reports the unknown outcome, the operation reference and the recovery path, without showing the secret. A later refused retry also keeps an earlier pending credential. Keep the error details and the protected file until the outcome is confirmed and the credential recovered. Do not delete the file just because a retry was refused. OpenWaggle reports a creation that succeeded, but whose local credential it could not install, separately as created, with its recovery path.

For an existing profile that is not revoked, a new `openwaggle access profiles rotate <name> --credential-store` rotates the credential. When there is exactly one matching pending store credential, the accepted rotation installs it. This is a new operation, not a replay. Old clients disconnect and must reconnect with the stored credential. The earlier protected file stays available for a retry of its original operation with the same operation key, or for recovery by hand. A later rotation does not reuse those installed bytes. It generates a fresh credential. A revoked profile, more than one eligible pending file, or corrupt credential data blocks recovery. Keep unresolved files and their reported locations instead of deleting them or retrying blindly.

## Platform and protocol details

On Windows, starting a detached Session Host uses the built-in Windows PowerShell helper, so the Session Host does not keep the launching client's pipes open. The CLI command can then finish while the Session Host keeps running. If the helper cannot run, startup fails rather than falling back to a launch that can leave the CLI hanging.

The installed Windows command adds Electron's `--` argument separator for you. If you run the executable directly, include it: `OpenWaggle.exe -- access profiles create ...`. For a development build, put it after the app path: `electron . -- access profiles create ...`. Without it, Electron can reject capability names such as `sessions:read`, or URL arguments, before OpenWaggle starts.

The current local session protocol revision is 32, and the Session Host accepts only revision 32. It refuses an older client when it connects, and that client must upgrade. `nextActor` is an added field of query outcomes, which clients do not decode strictly, so it needed no new revision.

| Revision | What it added |
| --- | --- |
| 32 | Refusal kinds: every refusal names its error kind |
| 31 | Desktop notifications |
| 30 | **Settings > Worktrees** across every project |
| 29 | Limits on what the desktop app reads of a session |
| 28 | Cheap heartbeats that finish |
| 27 | The Hive defaults |
| 26 | Scheduled tasks. |
| 25 | **Settings > Archived items** |
| 24 | MCP management |
| 23 | Session source control in the Session Host |
| 22 | Changed the active run snapshots the Session Host sends. |
| 21 | Editing queued messages, and the thinking level as a session setting |
| 20 | Regenerating a session title with the title model. |
| 19 | The `openwaggle host stop` command. |
| 18 | Labeled launch steps in worktree launch events and run snapshots. |
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

Revision 32 added refusal kinds. Every rejected outcome, query error and error frame carries the error kind the Session Host assigns to its code, so clients no longer guess it. See [Error kinds and exit codes](#error-kinds-and-exit-codes).

Revision 31 added [desktop notifications](/docs/using-openwaggle/notifications) and their settings. The Session Host sends an event when it shows or withdraws a notification. When the app connects, it reads the notifications that are still waiting and sets its badge from them.

Revision 30 added the worktree list in **Settings > Worktrees**, measuring the space a worktree frees, **Archive & remove**, and the record of automatic worktree removal.

In revision 29, the session tree carries no message content, and the app reads a window of the transcript and only the messages added since its last read.

In revision 28, a scheduled task carries its `heartbeat` settings (stop condition, wake check and its approval, idle auto-pause), a run its `wakeCheck` result and run `outcome`, and a heartbeat its own model. It added the `approve-wake-check` and `report-outcome` operations. Creating a heartbeat with no way to finish fails with `stop_condition_required`. See [Scheduled tasks](/docs/using-openwaggle/scheduled-tasks#keep-heartbeats-cheap).

In revision 27, a queue change reports `remainingFollowUpIds` (formerly `followUpIds`), a withdraw also reports `withdrawnFollowUpIds`, and a queued follow-up reports its queue state. The catalog's default scope became the whole current project, `list` takes `parentSessionId`, `spawn` takes a title, and session summaries carry `depth`.

Revision 25 added one searchable, filtered list of archived sessions and branches in **Settings > Archived items**, selecting every match, and restoring many items (or undoing that) at once.

Revision 24 added the **Settings > MCP** and `openwaggle mcp` channels: configuration, enabling and exposure, adding, removing and installing servers, MCP Registry search and install, inspecting a server, signing in and out, and importing from other tools. It also added the MCP App catalog, a session's MCP switch, the slash menu's Pi extension commands (`agent:list-extension-commands`), and pausing Pi session discovery while a project is removed.

Revision 23 moved the change request inspector, merge checks and confirmed merges, session working-path checks, and recording Git output into the Session Host.

In revision 21, follow-ups no longer carry a thinking level or access override, and `queue update-authorization` is removed. The desktop app can edit queued messages, and can send one as the desktop user when the access that queued it was revoked or changed. The CLI does not offer that.

Desktop registration and the approval controls from revision 10 are available only to the local desktop app, not to outside agent profiles. These are the revisions where each operation first appeared. They do not mean the current Session Host accepts old protocol revisions. An older Session Host serves a newer client only after it hands over to the new version. The client signs in first, and the older Session Host hands over once its active runs end. The desktop app never falls back to its own database, saves approvals locally, or grants access when the Session Host is unavailable.
