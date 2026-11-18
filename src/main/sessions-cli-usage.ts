/** How the commands that once took inline JSON take their input as ordinary options. */
const STRUCTURED_INPUT_NOTES = `Message input: exactly one of --text <text>, --stdin, --input-file <path>, --request-file <path|->
Answer (request-respond reads the pending request, so it also needs sessions:read):
  --choice <item> (select) | --text <text>, --stdin, --input-file <path> (input, editor) |
  --confirm or --decline (confirm) | --acknowledge (notify) | --value-file <path|-> (custom,
  one JSON value) | --dismiss (no answer; a confirm is declined). Approvals take approval-respond.
  For a request requests-list does not show, the Session Host says why (capability_denied,
  interaction-mismatch, interaction-not-found). An --idempotency-key retry is sent anyway so the
  Host replays it, except with --text, --stdin, --input-file or --dismiss.
Evidence (delegation-submit, delegation-verify), each repeatable: --evidence-command <summary>
  --evidence-diff <summary> --evidence-note <summary> --evidence-artifact <path-or-url>
  --evidence-source <reference>
Claims (delegation-claim), each repeatable: --read <path> --write <path> --read-tree <dir>
  --write-tree <dir> --read-resource <project|repository>:<namespace>/<name> --write-resource <...>
Specification changes (delegation-propose-amendment, delegation-amend): --objective <text>
  --deliverable <text>... --accept <criterion>... --resource <reference>...
  --depends-on <delegation-id>[:accepted]... (default ready_for_review) --handoff <text>;
  --no-deliverables, --no-acceptance-criteria, --no-resources, --no-dependencies and
  --no-handoff empty a field. A field left out keeps its current value. delegation-amend
  --proposal <id> applies the proposal as proposed and takes no changes. These commands read
  the Delegation first, so they also need delegations:read`

/**
 * `openwaggle hive` help. Every subcommand is the Hive tool action of the same name with `_`
 * written as `-` (ADR 0053), so `follow_up` is `hive follow-up` and `delegation_accept` is
 * `hive delegation-accept`. `watch` and `exports-watch` are the CLI's own event streams.
 */
export function sessionsCliUsage() {
  return `OpenWaggle Hive

Coordinate Sessions from the terminal. Each subcommand is the agent's hive tool action and the
openwaggle_hive MCP operation of the same name.

Usage:
  openwaggle hive create <project> [--title <title>]
    [--workspace current|local|existing|new-worktree] [--workspace-id <id>]
  openwaggle hive launch <project> --text <objective> [--attach <path>]...
    [--workspace current|local|existing|new-worktree] [--workspace-id <id>]
    [--title <title>]
    [--authorization ask-for-approval|yolo] [--yolo] [--interaction-timeout-ms <ms>]
  openwaggle hive fork <source-id> [--workspace share-source|local|existing|new-worktree]
    [--workspace-id <id>] [--target-node <node-id>] [--position before|at] [--title <title>]
  openwaggle hive spawn <parent-id> --text <objective> --expected-run <run-id>
    [--title <title>] [--workspace share-parent|local|new-worktree] [--attach <path>]...
    [--deliverable <text>]... [--accept <criterion>]... [--resource <reference>]...
    [--authorization ask-for-approval|yolo] [--yolo] [--interaction-timeout-ms <ms>]
  openwaggle hive message <session-id> --text <message> [--attach <path>]... [--thinking <level>] [--yolo]
  openwaggle hive start <session-id> --text <message> [--attach <path>]... [--thinking <level>] [--yolo]
    [--interaction-timeout-ms <ms>]
  openwaggle hive follow-up <session-id> --text <message> [--attach <path>]...
  openwaggle hive steer <session-id> --text <message> --expected-run <run-id> [--attach <path>]...
  openwaggle hive replace <session-id> --text <message> --expected-run <run-id> [--attach <path>]...
  openwaggle hive interrupt <session-id> --expected-run <run-id>
  openwaggle hive interrupt-descendants <session-id>
  openwaggle hive rename <session-id> <title>
  openwaggle hive archive|unarchive <session-id>
  openwaggle hive handoff <session-id> --workspace local|existing|new-worktree
    [--workspace-id <id>] [--base-ref <ref>] [--start-from-origin]
  openwaggle hive promote <session-id> <follow-up-id> --expected-run <run-id>
  openwaggle hive report <source-session-id> --text <message>
    (--upstream|--queen|--target <id>|--worker <name>)
    [--source-run <run-id>] [--request-reply] [--reply-to <report-id>]
  openwaggle hive delegations-list [--parent <session>] [--worker <session>] [--state <state>]...
    [--limit <n>] [--cursor <cursor>]
  openwaggle hive delegations-read <delegation-id> [--limit <n>] [--cursor <cursor>]
  openwaggle hive delegations-conflicts [--delegation <id>] [--kind live-overlap|merge-overlap]
    [--status unacknowledged|acknowledged|resolved]
  openwaggle hive delegation-submit <worker-id> <delegation-id> <summary> [evidence]
  openwaggle hive delegation-state <worker-id> <delegation-id>
    working|waiting|needs_attention <reason>
  openwaggle hive delegation-claim <worker-id> <delegation-id> <reason> [claims]
  openwaggle hive delegation-conflict-acknowledge <parent-id> <delegation-id>
    <conflict-id> <reason>
  openwaggle hive delegation-dependency <parent-id> <delegation-id> add|remove
    <dependency-id> ready_for_review|accepted <reason>
  openwaggle hive delegation-propose-amendment <worker-id> <delegation-id>
    <base-revision> <reason> <specification changes>
  openwaggle hive delegation-amend <parent-id> <delegation-id> <expected-revision>
    <reason> (specification changes | --proposal <proposal-id>)
  openwaggle hive delegation-request-revision <parent-id> <delegation-id> <revision>
    <feedback> [--revised-objective <text> --deliverable <text>... --accept <criterion>...
    --resource <reference>...]
  openwaggle hive delegation-accept <parent-id> <delegation-id> <revision> [note]
  openwaggle hive delegation-verify <parent-id> <delegation-id> <revision>
    passed|failed|inconclusive <summary> [evidence]
  openwaggle hive delegation-reopen|delegation-cancel <parent-id> <delegation-id> <reason>
  openwaggle hive queue-list <session-id> [--include-bodies]
  openwaggle hive queue-withdraw <session-id> <follow-up-id>...
  openwaggle hive queue-reorder <session-id> <follow-up-id>... --queue-revision <n>
  openwaggle hive queue-pause|queue-resume <session-id> --queue-revision <n>
  openwaggle hive list [--project <path>|--all] [--parent <session>] [--archived] [--limit <n>] [--cursor <cursor>]
  openwaggle hive search <query> [--mode hybrid|lexical|semantic] [--require-fresh]
    [--full-transcript] [--include-archived] [--project <path>|--all]
    [--limit <n>] [--cursor <cursor>] [--timeout-ms <ms>]
    (default: hybrid discovery; lexical with --full-transcript)
  openwaggle hive read <session-id> [--full] [--scope active-branch|tree] [--branch <branch-id>]
  openwaggle hive turns <session-id> [--limit <n>] [--cursor <cursor>]
  openwaggle hive items <session-id> [--run <run-id>] [--scope active-branch|tree]
    [--branch <branch-id>] [--after <created-order>] [--through <created-order>]
    [--snapshot-head <node-id>] [--limit <n>]
  openwaggle hive status <session-id>
  openwaggle hive export <session-id> [--format markdown|jsonl] [--scope active-branch|tree]
    [--branch <branch-id>] [--include-queue-bodies] [--limit <n>]
  openwaggle hive export-create <session-id> <destination> [--format jsonl|markdown|bundle]
    [--scope active-branch|tree] [--branch <branch-id>] [--include-queue-bodies]
    [--resource <relative-path>]... [--overwrite]
  openwaggle hive export-cancel <session-id> <export-operation-id>
  openwaggle hive exports-list <session-id> [--status <status>]... [--limit <n>] [--cursor <cursor>]
    [--include-queue-bodies]
  openwaggle hive exports-read <session-id> <export-operation-id> [--include-queue-bodies]
  openwaggle hive exports-wait <session-id> <export-operation-id> --timeout-ms <ms>
    [--after-host <id> --after-sequence <n>] [--include-queue-bodies]
  openwaggle hive exports-watch <session-id> [export-operation-id]
    [--after-host <id> --after-sequence <n>]
  openwaggle hive requests-list <session-id>
  openwaggle hive request-respond <session-id> <run-id> <interaction-id> <answer>
  openwaggle hive approval-respond <session-id> <run-id> <interaction-id> allow|deny [--for once|session|project]
  openwaggle hive authorization-set <session-id> inherit|ask-for-approval|yolo
  openwaggle hive agent-definitions-list [--project <path>] [--json]
  openwaggle hive agent-definitions-search <query> [--project <path>] [--json]
  openwaggle hive watch [session-id...] [--after-host <id> --after-sequence <n>]
  openwaggle hive wait <session-id>... [--condition idle|queue-empty|state-revision-after|report-delivered|correlated-reply]
    [--after-state-revision <n>] [--report-id <id>] [--correlation-id <id>]
    --timeout-ms <ms> [--after-host <id> --after-sequence <n>]

Session identities: every Session ID operand, --parent, --worker, and --target also accept a
  Session link (openwaggle://sessions/<session-id>), as the desktop app copies it
${STRUCTURED_INPUT_NOTES}
Output: human-readable by default; --json for one response; --jsonl for streams
Authentication: --profile <name> [--credential-stdin|--profile-credential-file <path>]
Mutation replay: --idempotency-key <key> on mutation commands
Specialization (create, launch, spawn): --agent <name> [--model <provider/model>] [--thinking <level>]
Session thinking (message, start): --thinking <level> sets the Session thinking level, only when the
  Session is idle and the command starts a Run; refused while a Run is active
  (thinking_level_requires_idle_session), so follow-up, steer, and replace never accept it
Run authorization (launch, spawn, message, start): --authorization <mode> or --yolo, for that one Run;
  message and start accept it only when they start a Run on an idle Session
  (run_authorization_override_requires_idle_session)
New Worktree (create, launch, fork, spawn, handoff):
  --workspace new-worktree [--base-ref <ref>] [--start-from-origin]
Catalog (list, search, delegations-list, delegations-conflicts): this project and its worktrees by
  default; --project <path> | --all. list --archived lists only archived Sessions
Agent definitions (agent-definitions-list, agent-definitions-search): definitions turned off for
  the project are left out, as spawn and launch refuse them
Unknown, missing-value, command-inapplicable, unexpected positional, and -- passthrough input
fail before files, credentials, or Session Host state change. Documented search/title/reason and
multi-target operands remain positional rest operands.
Scheduled tasks have their own command: openwaggle schedules. Agent-definition authoring stays in
  openwaggle agents (validate, import, explain, create, update, duplicate, delete, refresh).`
}
