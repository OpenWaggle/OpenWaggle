---
title: "Data and file locations"
description: "Where OpenWaggle keeps its data, logs, worktrees, sessions and temporary files on each platform."
section: "Reference"
kind: "reference"
---

This page lists where OpenWaggle and Pi keep their files on macOS, Windows and Linux. For the format of each configuration file, such as `settings.json`, `mcp.json`, `auth.json` or `models.json`, see [Configuration files](/docs/reference/configuration-files). In the paths below, `~` is your home folder, `%USERPROFILE%` on Windows.

## App data folder

The app data folder holds the session database, app settings, logs and the other files in [What is in the app data folder](#what-is-in-the-app-data-folder).

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Application Support/openwaggle/` |
| Windows | `%APPDATA%\openwaggle\` |
| Linux | `$XDG_CONFIG_HOME/openwaggle/`, which is `~/.config/openwaggle/` when `XDG_CONFIG_HOME` is not set |

Every released channel, Stable, Beta, RC and Alpha, uses the same folder. A Dev build, such as one you run from a source checkout, uses its own folder beside it, named `OpenWaggle Dev (<branch>)`, so it never reads or changes your installed app's sessions, settings or credentials.

Set `OPENWAGGLE_USER_DATA_DIR` to use another folder. The desktop app, the Session Host and the `openwaggle` command all read it. See [Environment variables](/docs/reference/environment-variables#app-and-cli).

## What is in the app data folder

| Path | Contents |
| --- | --- |
| `session-host/session-host.sqlite` | The session database: sessions, transcripts, the session tree, app settings, pinned sessions and their order, Hives, delegations, scheduled tasks, and each project's private project actions and overrides |
| `session-host/pre-cutover-openwaggle.sqlite` | The recovery copy kept when an upgrade migrated an older `openwaggle.db`. See [Recover an older session database](/docs/configuration/session-recovery#recover-an-older-session-database) |
| `session-host/` | Also the Session Host's ownership files and access profile credentials, and its socket. See [The Session Host's socket](#the-session-hosts-socket) |
| `logs/` | Log files on Windows and Linux, and on macOS when `OPENWAGGLE_USER_DATA_DIR` is set. See [Logs](#logs) |
| `mcp/` | MCP secrets and sign-ins, encrypted, and the tool catalogs of your MCP servers. Each build keeps its own, because builds encrypt with different keys |
| `extensions/<extension ID>/` | Global extension packages. See [Build an extension](/docs/extending/openwaggle-extensions) |
| `visualizations/<session ID>/` | The HTML of each session's inline visualizations |
| `session-resources/` | Copies of files and images listed in a session's **Sources & outputs** |
| `browser-preview-artifacts/` | Screenshots, recordings and annotations from the browser preview |
| `temp-attachments/` | Temporary copies of attachments and prompt files |
| `terminal-logs/` | Recent terminal scrollback, at most 5,000 lines and 10 MiB per terminal |
| `action-logs/` | Output of project actions |
| `preparation/` | Worktree setup and other preparation state, for each workspace |
| `worktree-removal/` | A record of the last 20 automatic worktree removals |
| `models/` | The speech model for voice input, downloaded on first use |
| `syntax-resources/` | Syntax themes and grammars you imported in **Settings > Appearance** |
| `usage-statistics/` | Usage statistics recorded today and not yet sent. See [When statistics are sent](/docs/configuration/usage-statistics#when-statistics-are-sent). Also `last-known-setting.json`, the **Share anonymous usage statistics and error reports** value the Session Host last loaded. See [Error reports](/docs/configuration/usage-statistics#error-reports) |
| `session-data/` | The window's browser profile: local storage, cookies and cache |
| `shell-environment.json` | The environment read from your login shell at the last launch, so the next launch starts faster |

The sidebar's sort order, which projects are collapsed, and the **Pinned** section's sort live in the window's local storage under `session-data/`, so OpenWaggle remembers them between launches. Pinned sessions and their dragged order are in the session database. OpenWaggle does not remember text filters and state chips, so an old filter never keeps sessions hidden.

Older versions kept `openwaggle.db` and `session-host.sqlite` at the top of the folder. Current versions write neither.

The session database is not a full backup. Provider credentials live in Pi's `auth.json`, in environment variables or in custom provider configuration, and your project files live in your project and its worktrees.

## Logs

| Platform | Desktop app log | Session Host log |
| --- | --- | --- |
| macOS | `~/Library/Logs/openwaggle/` | `~/Library/Logs/openwaggle/` |
| Windows | `logs\` in the app data folder | `logs\` in the app data folder |
| Linux | `logs/` in the app data folder | `logs/` in the app data folder |

The desktop app writes `openwaggle-YYYY-MM-DD.log` and the Session Host writes `openwaggle-host-YYYY-MM-DD.log`. Each line starts with its time in UTC, such as `16:54:22.855Z`, and the date in the file name is the UTC date too. With `OPENWAGGLE_USER_DATA_DIR` set, both logs go to `logs/` in that folder.

When agent work fails, the error display can open the desktop app's log folder. Review logs for secrets and private project details before you share them.

## Pi agent folder

Pi, the agent engine inside OpenWaggle, keeps its files in `~/.pi/agent/`, or in the folder `PI_CODING_AGENT_DIR` names. The `pi` command uses the same folder, so both share credentials, models and sessions.

| Path | Contents |
| --- | --- |
| `auth.json` | Provider API keys and sign-ins saved through Pi. Plain JSON, so protect it as a secret file |
| `models.json` | Custom providers and models |
| `settings.json` | Pi's settings |
| `mcp.json` | Pi's MCP servers for all projects |
| `waggle-presets.json` | Your Waggle presets |
| `sessions/` | Pi session files, one folder per working directory |

Session files move to the folder named by `PI_CODING_AGENT_SESSION_DIR`, or by the `sessionDir` setting in the project's `.pi/settings.json` or Pi's global `settings.json`. OpenWaggle stores its new sessions there too, so `pi --resume` finds them. See [Pi runtime](/docs/developer-workflow/pi-runtime).

## OpenWaggle home folder

`~/.openwaggle/` holds files that every OpenWaggle build shares.

| Path | Contents |
| --- | --- |
| `mcp.json` | OpenWaggle's MCP servers for all projects |
| `mcp/` | The MCP Registry cache, backups of `mcp.json`, and `mcp.log` |
| `agents/` | Your agent definitions |
| `worktrees/` | Managed worktrees. See [Managed worktrees](#managed-worktrees) |
| `cache/tesseract/` | The text-recognition cache for image attachments |

## Managed worktrees

OpenWaggle creates each managed worktree outside your project, at `~/.openwaggle/worktrees/<project folder name>/<workspace ID>`. A new worktree's branch is `ow/session-<workspace ID>`, the same ID as its folder. It can differ from the session ID. Sessions that share a workspace use the same checkout. Worktrees made by older versions keep the names they were created with, so check **Session Summary > Environment** for a session's real path and branch. See [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees).

## Temporary files

Each session gets a private scratch folder for temporary files, and an evidence folder for screenshots and other files an agent shows you or another session.

| Folder | Location |
| --- | --- |
| Scratch | `<temp>/ow-scratch-<user ID>/<profile>/<session>/` |
| Evidence | `<temp>/ow-scratch-<user ID>/<profile>/evidence/<session>/` |

`<temp>` is your temporary folder. On macOS and Linux it is `/tmp` when a path under your own temporary folder would be too long for a Unix socket, which is usual on macOS. On Windows it is `%TEMP%`, and the folder is named `ow-scratch` without a user ID. `<profile>` is a short code for the app data folder, so two profiles never share these folders. `<session>` is a short code for the session.

OpenWaggle points `TMPDIR`, `TMP` and `TEMP` at the scratch folder for the agent's shell tools, and `OPENWAGGLE_EVIDENCE_DIR` at the evidence folder. It deletes the scratch folder when you archive or delete the session. It keeps the evidence folder after archiving, and removes it once nothing has been added to it for a week. See [Hives and sessions](/docs/using-openwaggle/hives-and-sessions).

## The Session Host's socket

The desktop app and the `openwaggle` command reach the Session Host through a local socket.

| Case | Location |
| --- | --- |
| macOS, Linux | `session-host/host.sock` in the app data folder |
| Long path | `owsh-<hash>/host.sock` in your temporary folder, or in `/tmp` when that path is also too long |
| Windows | A named pipe, `\\.\pipe\openwaggle-<code>-session-host` |

On macOS and Linux, the socket moves out of the app data folder when its path there would be longer than 100 bytes, which keeps it under the Unix socket path limit (104 bytes on macOS). `<hash>` comes from the app data folder's path, so each profile gets its own socket. On Windows, `<code>` is a random code that OpenWaggle keeps in `session-host/endpoint.capability`, readable only by your user account.

## Startup cache

OpenWaggle keeps compiled code between launches so the app starts faster. AppImage builds on Linux keep none.

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Caches/OpenWaggle/compile-cache/<channel>/` |
| Windows | `%LOCALAPPDATA%\OpenWaggle\Cache\compile-cache\<channel>\` |
| Linux | `$XDG_CACHE_HOME/openwaggle/compile-cache/<channel>/`, which is `~/.cache/openwaggle/compile-cache/<channel>/` when `XDG_CACHE_HOME` is not set |

## Installed files

| Platform | App | `openwaggle` command |
| --- | --- | --- |
| macOS | `/Applications/OpenWaggle.app`, or the folder `OPENWAGGLE_APPLICATIONS_DIR` names when you install with the script | `~/.local/bin/openwaggle` |
| Linux | `~/.local/lib/openwaggle/OpenWaggle.AppImage`, with a desktop entry in `~/.local/share/applications/openwaggle.desktop` | `~/.local/bin/openwaggle` |
| Windows | Where the installer puts it | Registered by the installer |

The install script saves an update channel in `install-update-channel`, in `~/Library/Application Support/openwaggle/` on macOS or `$XDG_CONFIG_HOME/openwaggle/` (`~/.config/openwaggle/`) on Linux. It saves the channel `OPENWAGGLE_CHANNEL` names, or the default when there is no installed channel to keep. A re-run that keeps the installed app's channel writes nothing. See [Installation](/docs/getting-started/installation).

## Project folders

A project can hold OpenWaggle and Pi files of its own, such as `.openwaggle/settings.json`, `.openwaggle/actions.json`, `.openwaggle/mcp.json`, `.openwaggle/agents/`, `.pi/mcp.json` and `.pi/waggle-presets.json`. [Configuration files](/docs/reference/configuration-files) lists each one.
