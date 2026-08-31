export function sessionsCliUsage() {
  return `OpenWaggle Sessions

Usage:
  openwaggle sessions create <project> [--title <title>]
    [--workspace current|local|existing|new-worktree] [--workspace-id <id>]
  openwaggle sessions launch <project> --text <objective> [--attach <path>]...
    [--workspace current|local|existing|new-worktree] [--workspace-id <id>]
    [--title <title>]
    [--authorization ask-for-approval|yolo] [--yolo] [--interaction-timeout-ms <ms>]
  openwaggle sessions fork <source-id> [--workspace share-source|local|existing|new-worktree]
    [--workspace-id <id>] [--target-node <node-id>] [--position before|at] [--title <title>]
  openwaggle sessions spawn <parent-id> --text <objective> --expected-run <run-id>
    [--workspace share-parent|local|new-worktree] [--attach <path>]...
    [--deliverable <text>]... [--accept <criterion>]... [--resource <reference>]...
    [--authorization ask-for-approval|yolo] [--yolo] [--interaction-timeout-ms <ms>]
  openwaggle sessions message <session-id> --text <message> [--attach <path>]...
  openwaggle sessions start <session-id> --text <message> [--attach <path>]... [--yolo] [--interaction-timeout-ms <ms>]
  openwaggle sessions follow-up <session-id> --text <message> [--attach <path>]... [--yolo]
  openwaggle sessions steer <session-id> --text <message> --expected-run <run-id> [--attach <path>]...
  openwaggle sessions replace <session-id> --text <message> --expected-run <run-id> [--attach <path>]... [--yolo]
  openwaggle sessions interrupt <session-id> --expected-run <run-id>
  openwaggle sessions interrupt-descendants <session-id>
  openwaggle sessions rename <session-id> <title>
  openwaggle sessions archive|unarchive <session-id>
  openwaggle sessions handoff <session-id> --workspace local|existing|new-worktree
    [--workspace-id <id>] [--base-ref <ref>] [--start-from-origin]
  openwaggle sessions promote <session-id> <follow-up-id> --expected-run <run-id>
  openwaggle sessions report <source-session-id> --text <message>
    (--upstream|--queen|--target <id>|--worker <name>)
    [--source-run <run-id>] [--request-reply] [--reply-to <report-id>]
  openwaggle sessions delegation submit <worker-id> <delegation-id> <summary> [--evidence-json <json>]...
  openwaggle sessions delegation state <worker-id> <delegation-id>
    working|waiting|needs_attention <reason>
  openwaggle sessions delegation claim <worker-id> <delegation-id> <reason> [--claim-json <json>]...
  openwaggle sessions delegation acknowledge-conflict <parent-id> <delegation-id>
    <conflict-id> <reason>
  openwaggle sessions delegation dependency <parent-id> <delegation-id> add|remove
    <dependency-id> ready_for_review|accepted <reason>
  openwaggle sessions delegation propose-amendment <worker-id> <delegation-id>
    <base-revision> <reason> --specification-json <json>
  openwaggle sessions delegation amend <parent-id> <delegation-id> <expected-revision>
    <reason> --specification-json <json> [--proposal <proposal-id>]
  openwaggle sessions delegation request-revision <parent-id> <delegation-id> <revision>
    <feedback> [--revised-objective <text> --deliverable <text>... --accept <criterion>...
    --resource <reference>...]
  openwaggle sessions delegation accept <parent-id> <delegation-id> <revision> [note]
  openwaggle sessions delegation verify <parent-id> <delegation-id> <revision>
    passed|failed|inconclusive <summary> [--evidence-json <json>]...
  openwaggle sessions delegation reopen|cancel <parent-id> <delegation-id> <reason>
  openwaggle sessions queue withdraw <session-id> <follow-up-id>...
  openwaggle sessions queue reorder <session-id> <follow-up-id>... --queue-revision <n>
  openwaggle sessions queue pause|resume <session-id> --queue-revision <n>
  openwaggle sessions queue update-authorization <session-id> <follow-up-id>
    --authorization inherit|ask-for-approval|yolo
  openwaggle sessions list [--project <path>|--all] [--archived] [--limit <n>] [--cursor <cursor>]
  openwaggle sessions search <query> [--mode hybrid|lexical|semantic] [--require-fresh]
    [--full-transcript] [--include-archived] [--project <path>|--all]
    [--limit <n>] [--cursor <cursor>] [--timeout-ms <ms>]
    (default: hybrid discovery; lexical with --full-transcript)
  openwaggle sessions read <session-id> [--full]
  openwaggle sessions turns <session-id> [--limit <n>] [--cursor <cursor>]
  openwaggle sessions items <session-id> [--run <run-id>] [--after <created-order>] [--limit <n>]
  openwaggle sessions export <session-id> [--format markdown|jsonl] [--scope active-branch|tree]
    [--branch <branch-id>] [--include-queue-bodies] [--limit <n>]
  openwaggle sessions export create <session-id> <destination> [--format jsonl|markdown|bundle]
    [--scope active-branch|tree] [--branch <branch-id>] [--include-queue-bodies]
    [--resource <relative-path>]... [--overwrite]
  openwaggle sessions export list <session-id> [--status <status>]... [--limit <n>] [--cursor <cursor>]
  openwaggle sessions export read|cancel <session-id> <export-operation-id>
  openwaggle sessions export wait <session-id> <export-operation-id> --timeout-ms <ms>
    [--after-host <id> --after-sequence <n>]
  openwaggle sessions export watch <session-id> [export-operation-id]
    [--after-host <id> --after-sequence <n>]
  openwaggle sessions status <session-id>
  openwaggle sessions queue list <session-id> [--include-bodies]
  openwaggle sessions requests list <session-id>
  openwaggle sessions requests respond <session-id> <run-id> <interaction-id>
    --response-json <json> [--approve]
  openwaggle sessions authorization set <session-id> ask-for-approval|yolo
  openwaggle sessions authorization clear <session-id>
  openwaggle sessions watch [session-id...] [--after-host <id> --after-sequence <n>]
  openwaggle sessions wait <session-id>... [--condition idle|queue-empty|state-revision-after]
    [--after-state-revision <n>] --timeout-ms <ms> [--after-host <id> --after-sequence <n>]

Message input: exactly one of --text <text>, --stdin, --input-file <path>, --request-json <path|->
Output: human-readable by default; --json for one response; --jsonl for streams
Authentication: --profile <name> [--credential-stdin|--profile-credential-file <path>]
Mutation replay: --idempotency-key <key> on mutation commands
Specialization (create, launch, spawn): --agent <name> [--model <provider/model>] [--thinking <level>]
Run thinking (message, start, follow-up, replace): --thinking <level>
Run authorization (launch, spawn, start, follow-up, replace): --authorization <mode> or --yolo
New Worktree (create, launch, fork, spawn, handoff):
  --workspace new-worktree [--base-ref <ref>] [--start-from-origin]
Unknown, missing-value, command-inapplicable, unexpected positional, and -- passthrough input
fail before files, credentials, or Session Host state change. Documented search/title/reason and
multi-target operands remain positional rest operands.`
}
