---
title: "Scheduled tasks"
description: "Send a prompt on a schedule, into an existing Session or as a new Session each time."
order: 8
section: "Using OpenWaggle"
---

A Scheduled task delivers a prompt for you on a schedule. There are two kinds:

| Kind | Each time it fires |
| --- | --- |
| Heartbeat | Sends the prompt into one Session you already have. Use it to keep watching something, such as a pull request's checks. |
| Launch schedule | Starts a new Session in a project, with its own model and workspace. Use it for recurring jobs such as a morning triage. |

The Session Host runs Scheduled tasks. It keeps running while any task is enabled, even with every window closed, and it runs nothing while the machine is asleep or the Host is not running.

## Where to find tasks

| Place | What it shows |
| --- | --- |
| **Scheduled** in the Right panel | The tasks of the project you are in. Heartbeats into the open Session come first. |
| **Settings > Scheduled tasks** | Every task in every project, with **Background start**. |
| **Scheduled** in the Session Summary | The Heartbeats that run in this Session, or the Launch schedule that started it. Hover a row to see the next run. Right-click it for **Run now**, **Pause**, **Edit** and **Delete**. |

Opening a task shows its settings and run history in the place you opened it. Editing it, or choosing **New task**, replaces the detail with the editor in that same place.

## Create a task

Choose **New task** in the Scheduled panel or in Settings, or **+** in the Session Summary's Scheduled section to add a Heartbeat for that Session. Then fill in:

1. **Prompt**: what the agent should do each time. The task takes its name from the start of the prompt until you give it one.
2. **Runs**: **Into a Session** for a Heartbeat, or **New Session each time** for a Launch schedule.
3. **When**: the schedule and its time zone. The editor shows the next three times it would fire.
4. The collapsed line under it sets an end date, a maximum number of runs and notifications.

You can also ask an agent: "check this PR's CI every 30 minutes and tell me when it is green". The agent creates a Heartbeat for its own Session through its `sessions` tool. It creates a task only when you ask for recurring work. Work it can finish in the current turn, it finishes there instead. Agents connected over MCP (`openwaggle mcp serve`) cannot manage Scheduled tasks: their access ends when the MCP server stops, so a later run would have no access left to check.

## Schedules

| Schedule | Example |
| --- | --- |
| Every N minutes or hours | Every 30 minutes |
| Daily at a time | Every day at 09:00 |
| Chosen weekdays at a time | Monday to Friday at 09:00 |
| Recurrence rule | `FREQ=MONTHLY;BYDAY=1MO;BYHOUR=10;BYMINUTE=0` (the first Monday of each month at 10:00) |

A Heartbeat fires at most every 5 minutes and a Launch schedule at most every 15. Times are wall-clock times in the time zone stored with the task, which is your machine's zone when you create it. A 09:00 task stays at 09:00 in that zone when you travel. Intervals count elapsed time. When clocks go forward, a time inside the skipped hour fires once, just after the gap. When clocks go back, a repeated time fires the first time only.

Recurrence rules follow RFC 5545 without `DTSTART`, `UNTIL`, or `COUNT`. Use the task's end date or maximum number of runs to stop it instead.

Tasks that run hourly or less often fire within 5 minutes of their time, so many tasks set for 09:00 do not all reach your provider in the same second. The run history shows the planned time beside the actual one.

## When a task cannot fire

| Situation | What happens |
| --- | --- |
| The machine slept or the Host was not running | The task runs once when the Host is back, marked as a catch-up, never once per missed time. |
| A Heartbeat's Session is busy (a Run is active, messages are queued, or a question waits for you) | The Heartbeat waits and checks again every minute. It never steers or jumps the queue. If it is still waiting at its next time, the earlier firing is recorded as skipped. |
| The `pi` command line wrote to the Heartbeat's Session last | The Heartbeat waits as if the Session were busy. Continue the Session in OpenWaggle to resume it. |
| A Launch schedule's previous Session is still running | That firing is skipped. A task has at most one run in progress. |
| The Host is running as many Runs as it may | That firing is skipped and recorded. |
| The Heartbeat's Session was archived | The Heartbeat pauses and asks for attention. Deleting the Session deletes the Heartbeat. |
| The access profile or agent that created the task lost its authority | The task stops and asks for attention. |

## What a run is allowed to do

A Scheduled task never does more than whoever created it could do by hand. Each run checks the creator's authority again, so revoking a CLI access profile stops that profile's tasks.

A run uses the Authorization mode of its target: the Session's for a Heartbeat, the project's for a Launch schedule. With **YOLO (Full Access)** it works within its workspace unattended. With **Ask for Approval**, a request waits for you like any other, and the Session shows that it needs attention. There is no unattended mode that skips approvals.

The agent sees which task started its Run, when it fired, and when the task last ran. The transcript never presents the prompt as something you typed.

## Launch schedules

A Launch schedule starts each Session in a new worktree by default, so unattended edits stay out of the checkout you work in. Choose **Local checkout** to run in the project folder instead. Workspace setup runs only if you enabled it for the project.

Each Session is titled with the task name and the date, and its sidebar row shows a calendar icon. Its Session Summary names the task that started it. Turn on **Archive finished runs** to archive a Session once its Run completed, nothing in it needs attention, and you never sent it anything yourself.

If the task's model is no longer available, or its Agent definition no longer works, the task stops and asks for attention. It never falls back to another model.

## Background start

To keep tasks firing after a restart or logout, turn on **Background start** in **Settings > Scheduled tasks**. OpenWaggle then starts only the Session Host, with no window, when you log in. OpenWaggle offers this after you create your first task. It works in installed builds on macOS (a LaunchAgent), Windows (a login item), and Linux (an autostart entry).

`openwaggle status` lists the enabled tasks and when each fires next, so you can always see why a Host is running.

## Notifications

A Heartbeat tells you about failures and tasks that need attention only, so a quiet monitor stays quiet. A Launch schedule tells you about every run. Change this per task. **Open** on a notification opens the task in the Scheduled panel when you are in its project, and in Settings otherwise. The Scheduled rail icon and the Settings tab show a dot while a task needs attention.

## From the command line

```sh
openwaggle schedules list
openwaggle schedules create heartbeat <session> --name "Watch CI" --every 30m "Check the PR checks and report only changes."
openwaggle schedules create launch . --name "Morning triage" --daily 09:00 --weekdays weekdays --prompt-file triage.md
openwaggle schedules show <task-id>
openwaggle schedules runs <task-id> --limit 20
openwaggle schedules pause <task-id>
openwaggle schedules resume <task-id>
openwaggle schedules run <task-id>
openwaggle schedules update <task-id> --every 1h
openwaggle schedules delete <task-id>
openwaggle schedules export > tasks.json
openwaggle schedules import tasks.json
```

| Option | Meaning |
| --- | --- |
| `--every <30, 30m, 2h>` | Interval in minutes or hours |
| `--daily <HH:MM> [--weekdays 1,2,3 \| weekdays]` | Wall-clock time, optionally on ISO weekdays (1 is Monday) |
| `--rrule <rule>` | Recurrence rule |
| `--prompt <text>`, `--prompt-file <path>` | The prompt; or give it as the remaining words |
| `--time-zone <zone>` | IANA time zone; the machine's by default |
| `--ends <date>`, `--max-runs <n>` | Stop after a date or number of runs; `none` clears either |
| `--notify every-run \| failures-only` | Notification policy |
| `--paused` | Create the task turned off |
| `--workspace new-worktree \| local`, `--model`, `--thinking`, `--agent`, `--archive-finished` | Launch schedule options |

Add `--json` for versioned machine output. `export` prints tasks as JSON that `import` creates again under your identity. Tasks are stored only by the Session Host. No file creates one, and a project cannot share one.

An access profile needs the `schedules:read` capability to list tasks and `schedules:manage` to change them. See [Sessions CLI](/docs/developer-workflow/sessions-cli) for `--profile`.
