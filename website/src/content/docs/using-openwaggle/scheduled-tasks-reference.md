---
title: "Scheduled tasks reference"
description: "Limits, openwaggle schedules commands and options, and the export format for scheduled tasks."
section: "Reference"
kind: "reference"
---

This page lists the exact values for [scheduled tasks](/docs/using-openwaggle/scheduled-tasks): limits, the `openwaggle schedules` command, and the JSON that `export` prints and `import` reads.

## Limits

| Limit | Value |
| --- | --- |
| Shortest Heartbeat interval | 5 minutes |
| Shortest Launch schedule interval | 15 minutes |
| Longest interval | 31 days |
| Firing spread | Within 5 minutes either side, for tasks that run hourly or less often |
| Task name | 120 characters |
| Prompt | 16,000 characters |
| Recurrence rule | 512 characters, RFC 5545 without `DTSTART`, `UNTIL` or `COUNT` |
| Maximum runs | 1 to 100,000 |
| Idle runs before a Heartbeat pauses itself | 1 to 20, default 3 |
| Wake check run time | 30 seconds |
| Wake check output kept | 16 KiB |
| Busy session recheck | Every minute |
| Runs in progress per task | 1 |

## Run triggers

| Trigger | Meaning |
| --- | --- |
| Scheduled | The task's schedule came due. |
| Catch-up | The task came due while the Session Host was not running or the computer slept. One catch-up covers every missed time, and the history says how many. |
| Run now | Someone chose **Run now**, ran `openwaggle schedules run`, or the agent called `schedule_run_now`. It fires at once, not at a scheduled time. |

The task's **Last run** line, `openwaggle schedules list` and `show`, and the agent's `schedule_list` and `schedule_read` name the trigger of the last run.

## Heartbeat run outcomes

| Outcome | Meaning |
| --- | --- |
| acted | The run did work. A run that reports no outcome counts as acted when it used a tool other than a read-only one, or ran a shell command. |
| idle | The run found nothing to do. A firing the wake check skipped also counts as idle. |
| done | The stop condition is met. The Heartbeat pauses at once. |

## Commands

A `<session>` can be a session ID or a session link, `openwaggle://sessions/<session-id>`. Every command takes `--json` for versioned machine output, and `--profile <name>` with `--credential-stdin` or `--profile-credential-file <path>` to act as an access profile.

| Command | What it does |
| --- | --- |
| `list [--project <path>] [--session <session>]` | Lists tasks, optionally for one project or one session's Heartbeats. |
| `show <task-id>` | Shows a task's settings, next run and last run. |
| `runs <task-id> [--limit <n>] [--before <iso\|ms>]` | Lists a task's run history. |
| `create heartbeat <session> --name <name> <schedule> <end> [prompt...]` | Creates a Heartbeat into a session. |
| `create launch <project-path> --name <name> <schedule> [prompt...]` | Creates a Launch schedule for a project. |
| `update <task-id> [--name <name>] [<schedule>] [prompt...]` | Changes a task. |
| `approve-wake-check <task-id>` | Approves the command the Heartbeat's wake check runs now, and prints it. An access profile cannot approve one. |
| `pause <task-id>`, `resume <task-id>` | Turns a task off or on. |
| `run <task-id>` | Runs a task now. |
| `delete <task-id>` | Deletes a task. |
| `export [--project <path>] [--session <session>]` | Prints tasks as JSON for `import`. |
| `import [<file>\|-]` | Creates tasks from exported JSON, under your identity. `-` reads standard input. |

All of these follow `openwaggle schedules`, for example `openwaggle schedules list`. `create` also takes `--idempotency-key <key>`, so a repeated create with the same key makes the task only once.

## Options

| Option | Meaning |
| --- | --- |
| `--every <30, 30m, 2h>` | Interval in minutes or hours. |
| `--daily <HH:MM>` | A clock time every day. Add `--weekdays 1,2,3` or `--weekdays weekdays` for ISO weekdays, where 1 is Monday. |
| `--rrule <rule>` | A recurrence rule. |
| `--prompt <text>`, `--prompt-file <path>` | The prompt. You can also give it as the remaining words. |
| `--time-zone <zone>` | An IANA time zone. The default is your computer's. |
| `--ends <iso\|ms\|none>`, `--max-runs <n\|none>` | Stop after a date or a number of runs. `none` clears either. |
| `--stop-when <text\|none>`, `--indefinite`, `--finite` | A Heartbeat's stop condition, or that it never ends. `--finite` undoes `--indefinite` on update. A new Heartbeat needs one of these, `--ends` or `--max-runs`. |
| `--wake-if <command\|none>` | A Heartbeat's wake check. `none` removes it. |
| `--wake-on-failure wake\|skip` | What a failed or timed-out wake check does. The default is `wake`. |
| `--idle-pause-after <1-20>` | Idle runs in a row after which a Heartbeat pauses itself. The default is 3. |
| `--notify every-run\|failures-only` | Which runs send a notification. |
| `--paused` | Creates the task turned off. |
| `--model <id>`, `--thinking <level>` | The task's own model and thinking level, for its runs only. |
| `--workspace new-worktree\|local`, `--agent <name>`, `--archive-finished` | Launch schedule options: where each session works, its agent definition, and archiving finished sessions. |

## Export format

`openwaggle schedules export` prints a JSON array with one object per task. `--project <path>` limits it to one project, and `--session <session>` to one session's Heartbeats. This export holds a Heartbeat and a Launch schedule:

```json
[
  {
    "name": "Watch CI",
    "prompt": "Fix the failing checks.",
    "enabled": true,
    "schedule": { "kind": "interval", "everyMinutes": 30 },
    "timeZone": "Europe/Madrid",
    "endsAt": null,
    "maxRuns": null,
    "target": {
      "kind": "heartbeat",
      "sessionId": "3f6c1b9e-2d4a-4c8e-9b71-5a0e6d2f8c13"
    },
    "notificationPolicy": "failures-only",
    "heartbeat": {
      "stopWhen": "CI is green",
      "indefinite": false,
      "idlePauseAfter": 3,
      "wakeCheck": {
        "command": "gh pr checks 42 | grep -i fail || true",
        "onFailure": "wake"
      }
    }
  },
  {
    "name": "Morning triage",
    "prompt": "Triage the issues opened since yesterday.",
    "enabled": true,
    "schedule": { "kind": "daily", "at": "09:00", "weekdays": [1, 2, 3, 4, 5] },
    "timeZone": "Europe/Madrid",
    "endsAt": null,
    "maxRuns": null,
    "target": {
      "kind": "launch",
      "projectPath": "/Users/you/code/shop",
      "workspace": "new-worktree",
      "archiveFinishedSessions": true
    },
    "notificationPolicy": "every-run"
  }
]
```

| Key | Value |
| --- | --- |
| `schedule` | `{ "kind": "interval", "everyMinutes" }`, `{ "kind": "daily", "at", "weekdays" }` with ISO weekdays (1 is Monday), or `{ "kind": "rrule", "rule" }`. |
| `endsAt` | A time in milliseconds since 1970, or `null`. |
| `maxRuns` | A number of runs, or `null`. |
| `target` | For a Heartbeat, the `sessionId` it wakes. For a Launch schedule, the `projectPath`, `workspace`, `archiveFinishedSessions`, and `agentDefinitionName` when it has one. A task with its own model or thinking level also has `modelId` or `thinkingLevel` here. |
| `notificationPolicy` | `every-run` or `failures-only`. |
| `heartbeat` | Only on a Heartbeat: `stopWhen`, `indefinite`, `idlePauseAfter`, and `wakeCheck` with `command` and `onFailure`. |

The export leaves out task IDs, run history and status. A Heartbeat's `sessionId` names a session on the computer that exported it. Importing that Heartbeat where no session has that ID fails with `That Session was not found.`

## Access profile capabilities

| Capability | Allows |
| --- | --- |
| `schedules:read` | Listing and reading tasks and their runs. |
| `schedules:manage` | Creating, changing, running, pausing and deleting tasks. |
