---
title: "Command line"
description: "Open the app, run an agent headlessly, check the Session Host, and find every openwaggle command."
order: 5
section: "Developer docs"
---

The `openwaggle` command opens the desktop app and runs everything else without it. The installed app includes the command; see [Installation](/docs/getting-started/installation) for putting it on your `PATH`. From a source checkout, use `pnpm cli:dev -- <command>`.

```sh
openwaggle              # open the desktop app, or focus it if it is already open
openwaggle .            # open the desktop app on this project
openwaggle --help       # list every command
openwaggle --version    # print the installed version
```

`openwaggle <path>` accepts any existing directory. It selects that project and starts a new draft Session in it, as choosing the project in the sidebar does. A file opens the folder that contains it. If the app is already open, it takes the project and comes to the front instead of starting a second copy; on macOS it opens a new window when none is open. A command name wins over a folder with the same name, so write `./sessions` to open a folder called `sessions`.

## Help and mistakes

`openwaggle help <command>` and `openwaggle <command> --help` print the usage for one command, for example `openwaggle help sessions`.

A mistyped command never opens the app. OpenWaggle prints the error, a suggestion when one is close, and the full help to stderr, then exits with status 2:

```text
$ openwaggle sesions list
openwaggle: unknown command 'sesions'. Did you mean 'sessions'?

OpenWaggle 0.4.0

Usage:
  openwaggle                    Open the desktop app, or focus it if it is already open
  ...
```

The same applies to an unknown short option such as `-x`, a mistyped or differently cased `--hlep`, `--HELP`, `--h`, `--verison`, or `--v`, a value given to `--help` or `--version`, and a path that does not exist. In the installed app, an unknown long option followed by a word, such as `openwaggle --json sessions list`, is a mistake too; a development build passes it to Electron, which needs such arguments. A command written as a switch, such as `--status`, is reported with the command it meant. Other long switches on their own, such as `--remote-debugging-port=9222`, still go to Electron and start the app, because automation, debugging, and the updater rely on them.

## Commands

| Command | Purpose |
| --- | --- |
| `run` | Run an agent in a project and stream its reply to the terminal |
| `status` | Show whether the Session Host is running and which Runs are active |
| `host` | Check on or stop the background Session Host |
| `sessions` | Find, start, message, steer, wait for, and export Sessions. See [Sessions CLI](/docs/developer-workflow/sessions-cli) |
| `delegations` | List, review, and resolve Worker Delegations |
| `agents` | List, validate, and manage [Agent definitions](/docs/extending/agent-definitions) |
| `access` | Manage named access profiles for agents and scripts |
| `mcp` | Manage [MCP servers](/docs/configuration/mcp), or serve OpenWaggle over MCP |
| `update` | Check for and install updates |
| `recovery` | Inspect or restore the pre-migration database copy |

None of these open a window. They talk to the Session Host, the background process that owns Sessions and agent Runs. The Host starts on demand and keeps running while work is active, so a Session started from the terminal shows up in the desktop app whenever you open it, with its live progress.

## Run an agent without the app

```sh
openwaggle run fix the failing unit tests
openwaggle run --project ../api --model anthropic/claude-sonnet-4-5 "summarize the open TODOs"
git diff | openwaggle run --stdin --title "Review this diff"
```

`run` launches a new Session in the current directory (or `--project`) and waits for its Run to finish. The reply streams to stdout, so you can pipe it. Progress lines, tool calls, and questions go to stderr. It accepts the same options as `sessions launch`: `--attach`, `--title`, `--workspace`, `--agent`, `--model`, `--thinking`, `--authorization` or `--yolo`, and `--interaction-timeout-ms`. Words after `--` are part of the prompt, which helps when the prompt contains something that looks like an option.

When the agent asks for approval and the command runs in an interactive terminal, `run` asks `Allow? [y/N]` inline. Anything but `y` declines. Answering in the desktop app works too, and the terminal prompt goes away when you do. When there is no terminal to ask, `run` prints the `openwaggle sessions requests respond` command that answers the question, and keeps waiting.

Press Ctrl-C once to interrupt the Run and wait for it to stop. Press it again to stop waiting; the Run may still be finishing in the Host. Either way, the Session stays saved. Continue it with `openwaggle sessions follow-up <session-id> --text "..."` or open it in the app.

`run` exits with 0 when the Run completes, 1 when it fails or its result cannot be read, 2 for a usage error, 3 to 6 for authentication, authorization, not-found, and conflict errors, 7 when a question outlasts `--interaction-timeout-ms`, 8 when the Session Host is unavailable or exits, and 130 when the Run is interrupted. If another client replaces or deletes the Run, `run` reports that and exits instead of waiting. Reusing `--idempotency-key` attaches to the Run the key first started. Add `--jsonl` to get the Session's Host events as versioned records instead of text, ending with a `run-settled` record that carries the exit status and, when there is one, the reason.

Agent-controlled text written to your terminal, such as tool arguments and approval messages, shows control characters, text-direction overrides, and invisible characters (zero-width spaces, byte-order marks, tag characters) as escapes such as `\x1b` or `\u202e`, so it cannot rewrite, reorder, or hide part of the line you are about to approve. Emoji, including joined sequences and subdivision flags, print normally. The reply on stdout is treated the same way when stdout is a terminal, and left untouched when you pipe it. When the reader of stdout goes away, as with `openwaggle run ... | head -1`, `run` interrupts the Run and exits.

## Check the Session Host

```sh
openwaggle status
openwaggle status --json
```

`status` never starts the Host. It reports whether the Host is running and lists each active Run with its Session, Run ID, model, how long it has run, and whether it is waiting for an answer:

```text
OpenWaggle 0.4.0
Session Host: running
Active runs: 1
  6f1c2a9e-4b7d-4f0e-9c1a-2d3e4f5a6b7c  Fix tests  (anthropic/claude-sonnet-4-5, 3m, waiting for an answer)
    Run 0b9d8c7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f  in /Users/you/code/app
```

If the Session Host is an older version, `status` reports that it hands over to this version once its active Runs end. Any command, including `status`, asks an older Host to do that. Details `status` could not read, such as a Session title, are shown as unavailable rather than guessed.

An agent running inside OpenWaggle must pass an access profile with `--profile`, as with `openwaggle sessions`. It should normally use its native `sessions` tool instead.

## Stop the Session Host

```sh
openwaggle host stop
openwaggle host stop --wait --timeout-ms 60000
```

The Session Host exits on its own a few minutes after its last work ends, so stopping it is rarely needed. `host stop` makes it refuse new work at once and exit as soon as its active Runs, running Actions, exports, and other owned work finish. It never interrupts a Run. Follow-ups already queued behind an active Run still run first; pause the queue with `openwaggle sessions queue pause <session-id> --queue-revision <n>` to stop sooner (`openwaggle sessions queue list <session-id>` shows the revision). The command says what the Host is waiting for.

While it stops, the Host still answers the commands that end work: you can read Sessions (but not wait on them), answer a Run's questions and approvals, interrupt a Run with `openwaggle sessions interrupt <session-id> --expected-run <run-id>` (`openwaggle status` lists both IDs), and stop an Action in the desktop app, which keeps showing your Sessions. Commands that start work fail with a message that the Host is stopping.

With `--wait` the command returns once the Host has exited, or exits with status 7 if its work outlasts the timeout (2 minutes by default). If the desktop app is open, it starts a new Host the next time it needs one. Only you can stop the Host; named access profiles and agents cannot. `openwaggle host status` is the same as `openwaggle status`. Checking the status counts as activity, so an idle Host waits a little longer before it exits.
