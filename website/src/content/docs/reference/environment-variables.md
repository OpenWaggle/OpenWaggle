---
title: "Environment variables"
description: "Every environment variable OpenWaggle, its command line and its install script read, and the ones it sets for the commands it runs."
section: "Reference"
kind: "reference"
---

This page lists every environment variable that OpenWaggle, the `openwaggle` command and the install script read, and the variables OpenWaggle sets for the commands it starts. A variable reaches only the process started with it and the processes that one starts.

## Where the desktop app gets its environment

An app opened from the Dock, the Start menu or a desktop launcher does not see variables exported in your shell profile. At launch, the desktop app reads only these from your login shell:

| Group | Variables | When the app takes them |
| --- | --- | --- |
| Path | `PATH` | On every platform, merged with the app's own. On Windows it comes from PowerShell with and without your profile, plus common tool folders |
| Sockets and folders | `SSH_AUTH_SOCK`, `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_RUNTIME_DIR` | macOS and Linux, when the app has none |
| Homebrew | `HOMEBREW_PREFIX`, `HOMEBREW_CELLAR`, `HOMEBREW_REPOSITORY` | macOS and Linux, when the app has none |
| Desktop session | `DBUS_SESSION_BUS_ADDRESS`, `XDG_CURRENT_DESKTOP`, `XDG_SESSION_DESKTOP`, `XDG_SESSION_TYPE` | macOS and Linux |
| Locale | `LANG`, `LC_ALL`, `LC_CTYPE` | macOS, when the app has none of them. With none set anywhere, the app uses `LC_CTYPE=en_US.UTF-8` |
| fnm | `FNM_DIR`, `FNM_MULTISHELL_PATH` | Windows, when the app has none |

Any other variable, such as `DO_NOT_TRACK` or a provider API key, reaches the desktop app only if it was in the app's own environment when it started. Values in MCP server files written as `${NAME}` are an exception. OpenWaggle reads them from your login shell. See [MCP](/docs/configuration/mcp).

The Session Host that the desktop app starts keeps the app's environment. A Session Host that an `openwaggle` command starts keeps that command's environment. A Session Host that is already running keeps its own.

## Usage statistics

Any one of these turns off usage statistics and error reports for the process. [Turn them off](/docs/configuration/usage-statistics#turn-them-off) explains how they combine with the Settings switch.

| Variable | Turns statistics off when | Default |
| --- | --- | --- |
| `DO_NOT_TRACK` | Set to anything other than empty, `0`, `false`, `no` or `off`, in any case | Not set |
| `PI_TELEMETRY` | Set to anything other than `1`, `true` or `yes` (`true` and `yes` in any case), even an empty value. Also removes Pi's provider labels | Not set |
| `CI` | Set to anything other than empty, `0`, `false`, `no` or `off`, in any case. CI services set it | Not set |
| `OPENWAGGLE_AUTOMATION` | Set to `1`, which marks an automated test launch. It also stops the app and its Session Host from opening dialogs or browser windows | Not set |

## App and CLI

| Variable | What it does | Default |
| --- | --- | --- |
| `OPENWAGGLE_USER_DATA_DIR` | Uses this folder as the app data folder, for the desktop app, the Session Host and the `openwaggle` command. Logs go to its `logs/` folder | The platform's [app data folder](/docs/reference/data-locations#app-data-folder) |
| `OPENWAGGLE_LOG_LEVEL` | Lowest level written to the logs: `debug`, `info`, `warn` or `error`. The Session Host the app starts gets the same level | `info` |
| `OPENWAGGLE_PROFILE` | Runs `openwaggle` commands as this named access profile, like `--profile`. See [Hive CLI](/docs/developer-workflow/hive-cli#restricted-external-agent-profiles) | Not set, so commands run as you |
| `OPENWAGGLE_PROFILE_CREDENTIAL_FILE` | Reads the access profile's credential from this file, like `--profile-credential-file`. Needs `--profile` or `OPENWAGGLE_PROFILE` | The credential store |
| `OPENWAGGLE_DISABLE_SINGLE_INSTANCE` | Set to `1` to let another copy of the desktop app open while one is running | Not set |
| `OPENWAGGLE_COMPILE_CACHE_DIR` | Keeps the [startup cache](/docs/reference/data-locations#startup-cache) in this folder. Must be an absolute path | The platform's cache folder |
| `OPENWAGGLE_DISABLE_COMPILE_CACHE` | Set to `1` to keep no startup cache. Node's own `NODE_DISABLE_COMPILE_CACHE` works too | Not set |
| `LOCALAPPDATA`, `XDG_CACHE_HOME` | Where the startup cache goes on Windows and Linux | `~\AppData\Local`, `~/.cache` |
| `XDG_CONFIG_HOME` | Where the app data folder goes on Linux | `~/.config` |

## Pi

Pi, the agent engine inside OpenWaggle, reads these itself. [Pi's environment variables](https://pi.dev/docs/latest/environment-variables) lists the rest, and [Pi providers](https://pi.dev/docs/latest/providers#api-keys) lists the API key variable for each provider.

| Variable | What it does | Default |
| --- | --- | --- |
| `PI_CODING_AGENT_DIR` | Pi's [agent folder](/docs/reference/data-locations#pi-agent-folder), with `auth.json`, `models.json`, `settings.json`, `mcp.json` and Waggle presets | `~/.pi/agent` |
| `PI_CODING_AGENT_SESSION_DIR` | Where Pi session files go. OpenWaggle looks for sessions there and stores its new sessions there | `sessions/` in the agent folder, or Pi's `sessionDir` setting |
| `PI_TELEMETRY` | See [Usage statistics](#usage-statistics) | Not set |
| `PI_PACKAGE_DIR` | OpenWaggle always sets this for its own bundled Pi. Terminals and shells it starts get your own value back, or none | Your value, if any |

## Install script

`scripts/install.sh` reads these. Put them before `bash` in the install command, as in `OPENWAGGLE_CHANNEL=beta bash`. See [Installation](/docs/getting-started/installation).

| Variable | What it does | Default |
| --- | --- | --- |
| `OPENWAGGLE_CHANNEL` | Installs the newest release on `stable`, `beta` or `alpha`, and saves that channel for updates | The installed app's channel. On a first install, or when the script can't read the installed app's channel, `stable`, or `beta` while no stable release exists |
| `OPENWAGGLE_RELEASE_TAG` | Installs this exact version once, such as `v1.0.0` or `1.0.0-beta.25`, without changing your saved channel | Not set |
| `OPENWAGGLE_NO_LAUNCH` | Set to `1` to install without opening the app, like `--no-launch` | Not set |
| `OPENWAGGLE_APPLICATIONS_DIR` | macOS only: the folder the app is copied to | `/Applications` |
| `OPENWAGGLE_INSTALL_REPO` | GitHub repository to install from | `OpenWaggle/OpenWaggle` |
| `OPENWAGGLE_RELEASES_API_URL` | Address the script lists releases from | `https://api.github.com/repos/<repository>/releases` |
| `OPENWAGGLE_RELEASE_API_URL` | Address of one release to install, used instead of a channel or tag | Not set |

The script also does not open the app when `CI` is set, over SSH (`SSH_CONNECTION` or `SSH_TTY` set), or on Linux when neither `DISPLAY` nor `WAYLAND_DISPLAY` is set. On Linux it saves the channel under `XDG_CONFIG_HOME`, `~/.config` by default.

## Set for agent shell commands

Commands that the agent runs with its `bash` or `powershell` tool get these, on top of the Session Host's environment.

| Variable | Value |
| --- | --- |
| `TMPDIR`, `TMP`, `TEMP` | The session's private [scratch folder](/docs/reference/data-locations#temporary-files) |
| `OPENWAGGLE_EVIDENCE_DIR` | The session's evidence folder, for files to show you or another session |
| `OPENWAGGLE_HOST_TMPDIR` | The Session Host's own temporary folder. An `openwaggle` command started from the agent's shell uses it for its own temporary files |
| `OPENWAGGLE_PROJECT_ROOT` | The project folder |
| `OPENWAGGLE_WORKTREE_PATH` | The folder the session works in: its worktree, or the project folder |
| `OPENWAGGLE_AGENT_RUN` | `1`. The `openwaggle` command then refuses to act as you, with exit code `4`, unless it names an access profile |

Pi also sets `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL` and `PI_REASONING_LEVEL` for these commands.

## Set for project actions and terminals

| Where | Variables |
| --- | --- |
| Project actions, worktree setup and scheduled task wake checks | `OPENWAGGLE_PROJECT_ROOT` and `OPENWAGGLE_WORKTREE_PATH`, as above |
| Built-in terminal | `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=OpenWaggle` and `TERM_PROGRAM_VERSION` set to the app version |

A built-in terminal starts from a fresh copy of the app's environment. OpenWaggle removes every `OPENWAGGLE_*` variable, the Electron and Node.js variables that can inject code (such as `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `NODE_PATH`), and, on Linux, the AppImage runtime paths. See [Built-in terminal](/docs/developer-workflow/built-in-terminal).

## Removed for GitHub and GitLab commands

When OpenWaggle runs `gh` or `glab`, it removes these so the command uses the account stored in that CLI's own keyring, for the host of the project's Git remote:

| Kind | Variables |
| --- | --- |
| Tokens | `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN`, `GITLAB_PRIVATE_TOKEN`, `OAUTH_TOKEN`, `CI_JOB_TOKEN` |
| Host and repository | `GH_REPO`, `GH_HOST`, `GITLAB_REPO`, `GITLAB_HOST`, `GITLAB_API_HOST`, `GITLAB_SSH_HOST`, `GITLAB_HEAD_REPO`, `GITLAB_URI`, `GITLAB_URL`, `GLAB_REPO`, `GLAB_HOST` |

`GH_CONFIG_DIR`, `GLAB_CONFIG_DIR`, `XDG_CONFIG_HOME` and, on Windows, `APPDATA` tell OpenWaggle where those CLIs keep their host lists.

## Internal

OpenWaggle sets these between its own processes. Do not set them yourself.

| Variable | Use |
| --- | --- |
| `OPENWAGGLE_CLI_OUTPUT_FD` | The file descriptor the `openwaggle` command writes its output to. The Linux command sets it to `3` |
| `OPENWAGGLE_SHELL_ENVIRONMENT_REFRESHED_SINCE` | Tells a Session Host that the desktop app is reading the login shell, so it does not read it again |
| `OPENWAGGLE_STARTUP_TIMINGS` | Set to `1` for a Session Host started by an app that measures its startup with `--openwaggle-startup-timings` |
| `OPENWAGGLE_AUTOMATION_*` | Used by OpenWaggle's own tests |

## Building from source

| Variable | What it does | Default |
| --- | --- | --- |
| `OPENWAGGLE_RELEASE_CHANNEL` | Builds a released channel: `stable`, `beta`, `rc` or `alpha`. Only the release workflow sets it | Not set, so the build is a Dev build |
| `OPENWAGGLE_DEV_SLUG` | Names a Dev build, as in `OpenWaggle Dev (<slug>)`, and its own app data folder | The Git branch, else `local` |
| `ELECTRON_RENDERER_URL` | The development server address `bun run dev` gives the app | Set by `bun run dev` |

See [Building from source](/docs/developer-guide/building-from-source).
