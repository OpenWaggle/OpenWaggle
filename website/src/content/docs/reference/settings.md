---
title: "Settings reference"
description: "Every setting in the Settings window, with its values and default."
section: "Reference"
kind: "reference"
---

Every setting in the Settings window, section by section, in the order the sidebar lists them. To open Settings, click the gear icon in the sidebar. For what each section is for and the changes people make most, see [Settings](/docs/configuration/app-settings).

Settings apply to the whole app unless the table says otherwise. A section with a project picker shows one project at a time. Picking a project there does not switch your conversation to it.

## General

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| **Open web links in** | **System browser**, **OpenWaggle** | **System browser** | Where web links open. Terminal links and detected local ports use it too. |
| **Automatic compaction threshold** | 1 to 100 % | 80 % | Compacts before the next model request once context reaches this share of the model's window. |
| **Pi sessions** | **Ask**, **OpenWaggle**, **pi** (per project) | **Ask** | What happens when you send in a session the `pi` CLI used last. Kept in your app settings, not in the project. |
| **Codemode** | On, off | On, or your Pi `defaultTools` | Lets the agent write a short script that calls several tools in one step. |
| **Keep prompt caches warm** | **Off**, **While working**, **Between runs** | **While working**, or your Pi `cacheWarming` | When Pi resends the conversation so the provider keeps it cached. |
| **Update channel** | **Stable**, **Beta**, **Alpha** | The build's own channel | Which releases the app and `openwaggle update` install. Choosing **Alpha** asks you to confirm. |
| **Share anonymous usage statistics and error reports** | On, off | On in released builds | Sends anonymous usage statistics and error reports. Off deletes statistics not yet sent. |

Automatic compaction also runs by 400,000 tokens at the latest, whatever the percentage.

**Version** shows the installed version. **Latest version** shows the update status, with **Check now** and, once an update has downloaded, **Restart to update**.

Until you choose a channel, a Stable build follows Stable, an Alpha or Beta build follows its own channel, and a release candidate follows Beta.

Until you change **Codemode** or **Keep prompt caches warm** here, each follows your own Pi setting in `~/.pi/agent/settings.json` when you have set it, and the default above otherwise. Once you choose here, your OpenWaggle choice wins. OpenWaggle never writes either value to Pi's files.

| Pi value | Label |
| --- | --- |
| `off` | **Off** |
| `streaming` | **While working** |
| `idle` | **Between runs** |

The usage statistics switch is off and locked in a Dev build, during an automated test launch, and when `DO_NOT_TRACK`, `PI_TELEMETRY` or `CI` turns statistics off. See [Usage statistics and error reports](/docs/configuration/usage-statistics).

## Browser

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| **Let agents open and drive the preview browser** | On, off | On | Off withholds the browser tools and their instructions from agents. Your own browser panel still works. |
| **New preview tabs use** | Any browser profile | **Default** | The profile a new preview tab opens with. You can change it per tab. |
| **Viewport** | **Fill available space**, or a device size | **Fill available space** | The device size of a new tab. |
| **Zoom** | 25 % to 500 % | 100 % | The page zoom of a new tab. |
| **Appearance** | **System**, **Light**, **Dark** | **System** | The color scheme pages see in their media queries. |
| **Recording** | 30 FPS, 60 FPS | 30 FPS | Frames per second for preview recordings. |
| **Show agent-opened previews** | On, off | On | Shows a floating preview when an agent opens one without saying where. |

The zoom steps are 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400 and 500 %.

**Profiles** lists the built-in **Default** and **Incognito** profiles and the ones you add. Default and your own profiles keep logins and site data. Incognito is cleared when OpenWaggle quits. You can add up to 24 profiles, each with a name of up to 48 characters. **Import from** copies cookies from a browser installed on your computer into a profile. See [Browser preview](/docs/developer-workflow/browser-preview).

## Project actions

This section has a project picker. It lists the project's saved actions and the **Workspace preparation** setup and cleanup for worktrees OpenWaggle creates. A new action is saved for **Just me** unless you choose **Everyone working on this project**, which saves it in `.openwaggle/actions.json`. See [Project actions](/docs/configuration/project-actions).

## Shortcuts

Lists every keyboard command and Project Action binding, with search, **Add binding** and **Reset defaults**. The **Panels** group holds a shortcut for each right panel view. For the default keys and how bindings combine, see [Keyboard shortcuts](/docs/getting-started/keyboard-shortcuts).

## Appearance

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| **Color and syntax** | A theme for each of **Light**, **Dark**, **High Contrast Light** and **High Contrast Dark** | Light+, Dark+, GitHub Light High Contrast, GitHub Dark High Contrast | Code colors in the editor, Markdown, diffs, search and data views. |
| **Terminal colors** | A color for **Background**, **Foreground**, **Cursor**, **Selection** and **Scrollbar** | The active syntax theme's colors | Terminal-only colors. **Reset to theme** removes your changes. |
| **Interface** font | A font from the list, or a CSS font stack | System UI | Navigation and controls. |
| **Documents** font | A font from the list, or a CSS font stack | System UI | Chat and Markdown. |
| **Code** font | A font from the list, or a CSS font stack | System monospace | Code. |
| **Terminal** font | A font from the list, or a CSS font stack | Follows the Code font | The built-in terminal. |
| **Interface scale** | 85 to 125 %, in steps of 5 | 100 % | The size of the whole interface. |
| **Document text** | 12 to 22 px | 14 px | Chat and Markdown text size. |
| **Code text** | 10 to 24 px | 12 px | Code text size. |
| **Document spacing** | 120 to 200 %, in steps of 5 | 150 % | Line height of chat and Markdown text. |
| **Code line height** | 14 to 36 px, and at least 2 px more than the code text | 20 px | Line height of code. |
| **Terminal text** | 10 to 24 px | 14 px | Terminal text size. |
| **Code ligatures** | On, off | Off | Uses programming ligatures when the font has them. |
| **Terminal follows Code font** | On, off | On | Keeps the terminal font the same as the Code font. |
| **When the panel is closed** | **Keep rail visible**, **Hide rail** | **Keep rail visible** | Whether the panel rail stays on the right edge while the right panel is closed. |
| **Diff layout** | **Unified**, **Side by side** | **Unified** | One column, or old and new side by side. |
| **Wrap long lines** | On, off | Off | Wraps long diff lines instead of scrolling sideways. |
| **Reduce motion** | On, off | Off, following the operating system | On always keeps animation to a minimum. |

**Import** in **Color and syntax** adds VS Code JSON or JSONC themes, TextMate themes and grammars, VS Code extensions, and OpenWaggle theme packages. **Reset** in **Typography** puts every font and size back to its default. A custom font stack can be up to 240 characters. **Diff layout** and **Wrap long lines** also change from the diff panel's own controls. Appearance choices apply in every project and are not read from project files.

## Waggle Mode

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| Preset | A built-in or saved preset | None loaded | Loads two agents and their settings. **Save Changes** and **New Custom Preset** save to a presets file. |
| Agent A, Agent B | A name, a model and a role description each | Named Agent A and Agent B, using the session's model | The two agents that take turns. |
| **Stop when** | **Consensus**, **Manual** | **Consensus** | Whether the agents stop once they agree, or only when you stop them. |
| **Max turns** | 4 to 20 | 8 | The most turns before Waggle stops. |

See [Waggle](/docs/using-openwaggle/waggle-mode).

## Extensions

Lists your OpenWaggle and Pi extension packages, with controls to review, enable, update, disable and remove them. See [Extensions](/docs/extending/plugins).

## Skills

Has a project picker. Lists the skills found in the project's `.openwaggle/skills` and `.agents/skills` folders, with a switch to turn each one off for that project. See [Skills](/docs/extending/skills-system).

## Agents

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| **Agent-created Workers** | On, off | On | Lets agents start worker sessions to share a task. |
| **Workers per parent** | 1 or more | 4 | The most worker runs active at once under one parent session. |
| **Active agent runs** | 1 or more | 16 | The most runs active at once across the app, in every session and Hive. |

OpenWaggle refuses a new run that would pass either limit, with an error you can retry. It does not queue the run. Saved sessions, queued follow-ups, searches, waits and exports do not count toward the limits. A project's `.openwaggle/settings.json` can set its own **Agent-created Workers** and **Workers per parent**, and the file wins.

**Saved project overrides** appears only when an older version saved per-project values. **Clear saved value** removes one. It does not change a project file.

Below the limits, pick a project to read its agent definitions and turn each one on or off for new sessions. See [Agent definitions](/docs/extending/agent-definitions).

## Scheduled tasks

Lists scheduled tasks for **All projects** or one project. See [Scheduled tasks](/docs/using-openwaggle/scheduled-tasks).

## Permissions

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| **Default access mode** | **YOLO (Full Access)**, **Ask for Approval** | **YOLO (Full Access)** | The access mode of every project and session that has not chosen its own. |
| **Selected project** | **Use default**, **YOLO (Full Access)**, **Ask for Approval** | **Use default** | The access mode of the project chosen in the picker. Saved in the project's `.openwaggle/settings.json`. |
| **Saved approvals** | A list, with **Revoke** on each | Empty | The approvals you kept with **Always allow** for the selected project. |

In `.openwaggle/settings.json`, the modes are `yolo` and `ask-for-approval`. See [Approvals and permissions](/docs/configuration/approvals-permissions).

## MCP

Lists your MCP servers with controls to add, turn off, sign in to and inspect them, and to choose how the agent reaches their tools. See [MCP connections](/docs/configuration/mcp).

## Worktrees

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| **New Sessions run in** | **Current checkout**, **A new worktree** | **Current checkout** | Where a new session works. You can change it before the session's first message. |
| **Remove worktrees of archived Sessions automatically** | On, off | Off | Removes a worktree once every session in it has been archived long enough. |
| **After archiving for** | 7, 14, 30, 60 or 90 days | 30 days | How long every session in a worktree must stay archived before it is removed. |

The rest of the section lists the worktrees of every project in three groups, **Safe to remove**, **Needs a decision** and **In use**, with the space each would free. See [Settings](/docs/configuration/app-settings#clean-up-worktrees).

## Archived items

Lists archived sessions and branches, with **Search**, filters for **Project**, **Archived date** and **Type**, and **Sort**. You can restore or open each item, and delete archived sessions for good. You can select up to 1,000 matches at once. See [Settings](/docs/configuration/app-settings#find-and-restore-archived-sessions).

## Connections

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| **API Key Providers** | A key per provider, with **Test**, **Save** and **Clear** | None | Saves a provider's API key through Pi. |
| **OAuth Providers** | A switch per provider | Off | Signs in to a provider in your browser. |
| **Source control** | Hosts, each with a provider and accounts | None | Which hosts use GitHub or GitLab, through the `gh` and `glab` CLIs. **Add host…** adds one. |
| **Open pull and merge requests in** | **OpenWaggle**, **Provider website** | **OpenWaggle** | Where a click on a pull or merge request opens. Cmd or Ctrl-click opens the other one. |
| **Available Models** | A checkbox per model | None | Which models appear in the model selector. |
| **Title model** | **Automatic**, **Off**, or any enabled model | **Automatic** | Which model writes session titles. |

A key test sends one short prompt and gives up after 15 seconds. See [API key authentication](/docs/providers/api-key-auth) and [Browser sign-in](/docs/providers/oauth-auth). For source control hosts and accounts, see [Session Summary](/docs/developer-workflow/pull-requests#how-openwaggle-recognizes-a-host).

| **Title model** choice | What happens |
| --- | --- |
| **Automatic** | The cheapest available model from each session's own provider and model family writes its title, with the same sign-in and region. |
| A model | That model writes every title. Each session's opening message and each worker's task go to that model's provider, and so does up to about 8,000 characters of the conversation when a title is refined or regenerated. If the model fails, the session's own model is tried. |
| **Off** | No titles are generated. Sessions keep their opening message as the title, and **Regenerate title** is hidden. |

Titles use the models of each session's project, so a provider or virtual model that a project's Pi extension adds can write titles for that project's sessions.
