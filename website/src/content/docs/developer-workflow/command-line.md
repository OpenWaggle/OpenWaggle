---
title: "Command line"
description: "Open the app, run an agent headlessly, check the Session Host, and find every openwaggle command."
order: 5
section: "Developer docs"
kind: "reference"
---

The `openwaggle` command opens the desktop app, and runs everything else without it. The installed app includes the command; [Installation](/docs/getting-started/installation) explains how to put it on your `PATH`. From a source checkout, run `pnpm cli:dev -- <command>` instead.

## Open the app

| Command | What it does |
| --- | --- |
| `openwaggle` | Opens the desktop app, or brings it to the front if it is already open |
| `openwaggle .` | Opens the desktop app on the project in the current folder |
| `openwaggle <path>` | Opens the desktop app on the project at `<path>` |
| `openwaggle openwaggle://sessions/<session-id>` | Opens the desktop app on that session, like clicking its [session link](/docs/using-openwaggle/chat-and-tools#session-links) |
| `openwaggle --help` | Lists every command |
| `openwaggle --version` | Prints the installed version |
| `openwaggle help <command>` | Prints the usage of one command. `openwaggle <command> --help` does the same |

`openwaggle <path>` accepts any existing folder. It selects that project and starts a new draft session in it, as choosing the project in the sidebar does. A file opens the folder that contains it. If the app is already open, the open app takes the project and comes to the front, so you never get a second copy. On macOS it opens a new window when none is open.

A command name wins over a folder with the same name, so write `./hive` to open a folder called `hive`. After a session link, any further argument is a mistake, and so is an `openwaggle:` value that is not a session link. Neither opens the app.

## Mistakes

A mistake never opens the app. `openwaggle` prints the error, a suggestion when one is close, and the full help to stderr, then exits with status 2. For `openwaggle hvie list` it prints:

```text
openwaggle: unknown command 'hvie'. Did you mean 'hive'?

OpenWaggle 0.4.0

Usage:
  openwaggle                    Open the desktop app, or focus it if it is already open
  ...
```

| Input | Example | Result |
| --- | --- | --- |
| Unknown command | `openwaggle hvie list` | Exit 2 with a suggestion |
| Unknown short option | `-x` | Exit 2 |
| Mistyped or differently cased help or version switch | `--hlep`, `--HELP`, `--h`, `--verison`, `--v` | Exit 2 |
| A value after `--help` or `--version` | `--help hive` | Exit 2 |
| A path that does not exist | `openwaggle ./missing` | Exit 2 |
| Unknown long option followed by a word | `openwaggle --json hive list` | Exit 2 in the installed app. A development build passes it to Electron, which needs such arguments |
| A command written as a switch | `--status` | Exit 2, naming the command it meant |
| A command renamed before 1.0 | `sessions list`, `delegations accept` | Does not run. Names the `hive` command it became, such as `hive list` or `hive delegation-accept`. With `--json` or `--jsonl` the report is a JSON error envelope instead of the usage text |
| Any other long switch on its own | `--remote-debugging-port=9222` | Passed to Electron, which starts the app. Automation, debugging, and the updater rely on this |

## Commands

| Command | What it does |
| --- | --- |
| `run` | Runs an agent in a project and streams its reply to the terminal |
| `status` | Shows whether the Session Host is running and which runs are active |
| `host` | Checks on, starts, or stops the background Session Host |
| `hive` | Finds, starts, messages, steers, waits for, and exports sessions, and reviews worker delegations. See [Hive CLI](/docs/developer-workflow/hive-cli) |
| `schedules` | Creates and manages [scheduled tasks](/docs/using-openwaggle/scheduled-tasks) |
| `agents` | Validates, imports, explains, and edits [Agent definitions](/docs/extending/agent-definitions) |
| `access` | Manages named access profiles for agents and scripts |
| `mcp` | Adds, lists, and signs in to [MCP servers](/docs/configuration/mcp-reference#command-line), or serves OpenWaggle over MCP |
| `update` | Checks for and installs updates |
| `recovery` | Inspects or restores the copy of the database made before a migration |

None of these open a window. They talk to the Session Host, the background process that runs sessions and agent runs. The Session Host starts when a command needs it and keeps running while work is active. A session you start from the terminal shows up in the desktop app whenever you open it, with its live progress.

[Environment variables](/docs/reference/environment-variables#app-and-cli) lists the variables the app and the `openwaggle` command read, such as `OPENWAGGLE_USER_DATA_DIR` and `OPENWAGGLE_PROFILE`.

## run

`openwaggle run` starts a new session in the current folder, or in `--project`, and waits for its run to finish. It is how you run an agent without the app.

```sh
openwaggle run fix the failing unit tests
```

Name a project and a model:

```sh
openwaggle run --project ../api --model anthropic/claude-sonnet-4-5 "summarize the open TODOs"
```

Send the prompt on stdin, here a diff to review:

```sh
git diff | openwaggle run --stdin --title "Review this diff"
```

The prompt is the words after `run`, or the value of `--text`, `--stdin`, or `--input-file`. Use one of these, not both. Words after `--` are part of the prompt, which helps when the prompt contains something that looks like an option.

### Options

| Option | What it does |
| --- | --- |
| `--project <path>` | Project folder. Without it, `run` uses the current folder |
| `--text <prompt>` | The prompt |
| `--stdin` | Reads the prompt from stdin |
| `--input-file <path>` | Reads the prompt from a file |
| `--attach <path>` | Attaches a file. Repeat it for more files |
| `--title <title>` | Session title |
| `--workspace current\|local\|existing\|new-worktree` | Where the session works. Goes with `--workspace-id <id>`, `--base-ref <ref>`, and `--start-from-origin` |
| `--agent <name>` | Uses an [Agent definition](/docs/extending/agent-definitions) |
| `--model <provider/model>` | Model for the session |
| `--thinking <level>` | Thinking level the new session starts with |
| `--authorization ask-for-approval\|yolo` | Agent access for the session. `--yolo` is short for `--authorization yolo` |
| `--interaction-timeout-ms <ms>` | Stops waiting for an unanswered question after `<ms>` milliseconds. The command then exits with status 7 |
| `--jsonl` | Prints the session's Session Host events as versioned records instead of text |
| `--idempotency-key <key>` | Reusing a key attaches to the run that key first started, instead of starting another |
| `--profile <name>` | Runs as a named access profile. Goes with `--credential-stdin` or `--profile-credential-file <path>` |

`--project` and `--jsonl` work only with `run`. The other options match `openwaggle hive launch`; see [Hive CLI](/docs/developer-workflow/hive-cli).

### Output

The agent's reply streams to stdout, so you can pipe it. Progress lines, tool calls, and questions go to stderr. With `--jsonl`, stdout gets the session's events instead, ending with a `run-settled` record that carries the exit status and, when there is one, the reason.

Text the agent controls, such as tool arguments and approval messages, can contain characters that change what a terminal shows. `run` prints control characters, text-direction overrides, and invisible characters (zero-width spaces, byte-order marks, variation selectors, tag characters, line separators) as escapes such as `\x1b` or `\u202e`. That way they cannot rewrite, reorder, or hide part of the line you are about to approve. Emoji, including joined sequences and subdivision flags, print normally. The reply on stdout gets the same treatment when stdout is a terminal, and is left untouched when you pipe it.

When the reader of stdout goes away, as with `openwaggle run ... | head -1`, `run` interrupts the run and exits.

### Questions and approvals

When the agent asks for approval and `run` is in an interactive terminal, it asks `Allow? [y/N]` on the spot. Anything but `y` declines. You can answer in the desktop app instead, and the terminal prompt goes away when you do.

Without a terminal to ask in, `run` prints the command that answers the question and keeps waiting. That is `openwaggle hive request-respond`, or `openwaggle hive approval-respond` for an approval.

### Stopping

Press Ctrl-C once to interrupt the run and wait for it to stop. Press it again to stop waiting; the run may still be finishing in the Session Host. Either way the session stays saved. Continue it with `openwaggle hive follow-up <session-id> --text "..."`, or open it in the app.

If another client replaces or deletes the run, `run` says so and exits instead of waiting.

### Exit status

| Status | Meaning |
| --- | --- |
| `0` | The run completed |
| `1` | The run failed, or its result could not be read |
| `2` | Usage error |
| `3` | Authentication error |
| `4` | Authorization error |
| `5` | Not found |
| `6` | Conflict |
| `7` | A question was not answered before `--interaction-timeout-ms` ran out |
| `8` | The Session Host is unavailable, or exited during the run |
| `130` | The run was interrupted |

## status

```sh
openwaggle status
```

`status` never starts the Session Host. It says whether the Session Host is running and lists each active run with its session, run ID, model, how long it has run, and whether it is waiting for an answer. Add `--json` for machine-readable output.

```text
OpenWaggle 0.4.0
Session Host: running
Active runs: 1
  6f1c2a9e-4b7d-4f0e-9c1a-2d3e4f5a6b7c  Fix tests  (anthropic/claude-sonnet-4-5, 3m, waiting for an answer)
    Run 0b9d8c7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f  in /Users/you/code/app
```

- When scheduled tasks are enabled, `status` also lists each one and when it fires next. An enabled task keeps the Session Host running, so look here when the Session Host stays up with no window open.
- If the running Session Host is an older version, `status` says that it hands over to this version once its active runs end. Any command, `status` included, asks an older Session Host to hand over.
- A detail `status` could not read, such as a session title, shows as unavailable. It is never guessed.
- `openwaggle host status` is the same command. Checking the status counts as activity, so an idle Session Host waits a little longer before it exits.
- An agent running inside OpenWaggle must pass an access profile with `--profile`, as with `openwaggle hive`. It should normally use its `hive` tool instead.

## host start

```sh
openwaggle host start
```

`host start` starts the Session Host with no window if it is not running, then returns. With no scheduled task enabled, the Session Host exits again a few minutes later. To start it at login, so scheduled tasks keep firing after a restart, see [Scheduled tasks](/docs/using-openwaggle/scheduled-tasks#keep-tasks-running-after-a-restart).

## host stop

You rarely need this. The Session Host exits on its own a few minutes after its last work ends, unless a scheduled task is enabled, and every update stops it before installing.

```sh
openwaggle host stop
```

`host stop` makes the Session Host refuse new work at once. It exits as soon as its active runs, running actions, exports, and other work it owns finish. It never interrupts a run, and the command says what the Session Host is waiting for. Follow-ups already queued behind an active run still run first. To stop sooner, pause the queue with `openwaggle hive queue-pause <session-id> --queue-revision <n>`; `openwaggle hive queue-list <session-id>` shows the revision.

While it stops, the Session Host still answers the commands that end work. You can read sessions (but not wait on them), answer a run's questions and approvals, interrupt a run with `openwaggle hive interrupt <session-id> --expected-run <run-id>` (`openwaggle status` lists both IDs), and stop an action in the desktop app, which keeps showing your sessions. Commands that start work fail with a message that the Session Host is stopping.

If the desktop app is open, it starts a new Session Host the next time it needs one. Only you can stop the Session Host. Named access profiles and agents cannot.

To wait until the Session Host has exited, add `--wait`. `--timeout-ms` sets how long to wait:

```sh
openwaggle host stop --wait --timeout-ms 60000
```

### Stop for an update

```sh
openwaggle host stop --update
```

This is the stop an update uses. **Restart to update**, `openwaggle update`, and the install script all stop the Session Host this way before they replace the app.

1. If agent runs are active, it asks whether to wait until they finish (the default), stop them now, or cancel.
2. Stopping them now gives the Session Host 10 seconds to finish its work. Then it interrupts any run still active, which is recorded as interrupted, and exits. So stopping now ends the runs within about 13 seconds.
3. The command returns once the Session Host process is gone.

It asks on the terminal, so it also works under `curl … | bash`. Without a terminal, as on Windows, it waits for the runs. An older Session Host that is handing over to this version cannot be told to stop its runs, so the command only waits for them.

Ctrl-C at the question cancels, like answering `c`. While it waits, Ctrl-C cancels the update too, though a stop already sent to the Session Host still goes ahead. While the desktop app is open, the command leaves the Session Host alone, because the app owns it then.

### Options and exit status

| Option | What it does | Default |
| --- | --- | --- |
| `--wait` | Returns only once the Session Host has exited | Off |
| `--timeout-ms <ms>` | How long `--wait` waits | `120000` (2 minutes) |
| `--update` | Stops the Session Host for an update, as described above | Off |
| `--json` | Prints the report as JSON | Off |

| Status | `host stop` | `host stop --update` |
| --- | --- | --- |
| `0` | The Session Host accepted the stop, or with `--wait`, exited | The Session Host exited |
| `1` | | The Session Host refused the stop |
| `6` | | You cancelled, the desktop app is open, or another OpenWaggle process, such as `openwaggle mcp serve`, keeps starting a new Session Host |
| `7` | With `--wait`, its work outlasted `--timeout-ms` | The Session Host had not exited after 20 seconds |
| `130` | | Ctrl-C while it waits |
