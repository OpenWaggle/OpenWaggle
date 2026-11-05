---
title: "Project actions reference"
description: "Every project action option and its default, script suggestions, run states, and the fields of .openwaggle/actions.json."
section: "Reference"
kind: "reference"
---

Exact values for project actions. To save, run, or share an action, or set up worktrees, start with the [Project actions](/docs/configuration/project-actions) guide.

## Optional settings

The questions under **Optional settings** in the action panel, with their answers and defaults.

| Question | Answers | Default |
| --- | --- | --- |
| **Does it stop on its own?** | **Yes, it finishes by itself** (**Stops when done**), **No, it keeps running until I stop it** (**Keeps running**) | Finishes by itself. Keeps running for a [long-running script](#script-suggestions). |
| **If you click it while it is still running** | **Show me the run that is already going**, **Start another copy** | Show the run already going. Only for an action that finishes by itself. |
| **Open it in the browser preview?** | **Yes, open the preview when the server is ready**, **No, I will open it myself**, and an optional preview URL | Yes for a long-running script, otherwise no. Only for an action that keeps running. |
| **Who should have this action?** | **Just me**, **Everyone working on this project** | **Just me** |
| **Who should get these changes?** | **Only me**, **Everyone on the project** | Asked instead of the question above when you edit a shared action. |
| **Which folder should it run in?** | A folder inside the workspace | The project folder, or a script's package folder |
| **Keyboard shortcut** | One key combination, or **More shortcut options** | None |
| **Icon in Project Actions** | `play`, `test`, `lint`, `configure`, `build`, `debug` | From the script name, otherwise `play` |

Setup and cleanup ask **Who should have this setup?** or **Who should have this cleanup?**, with **Just me** as the default, and a folder.

## Script suggestions

When you pick a script, OpenWaggle fills in a name, an icon, and whether it keeps running.

| Script | Suggested name |
| --- | --- |
| `dev` | Start dev server |
| `start` | Start |
| `serve` | Start server |
| `preview` | Preview build |
| `test` | Run tests |
| `build` | Build |
| `lint` | Lint |
| `typecheck` | Check types |
| `check` | Run checks |
| `format` | Format code |

Another script gets its own name with `:`, `_`, and `-` turned into spaces and the first letter capitalized. A script in a package folder adds the folder's name, as in **Start dev server (website)**.

A script is long-running, so it gets **Keeps running** and opens the preview, when its name starts with `dev`, `start`, `serve`, `watch`, or `preview`, alone or followed by `:`, or ends in `:dev`, `:watch`, or `:serve`.

The icon comes from the first rule that matches the script name:

| Name contains | Icon |
| --- | --- |
| `test`, `spec`, `e2e`, `vitest`, `jest` | `test` |
| `lint`, `check`, `format`, `typecheck`, `biome` | `lint` |
| `build`, `bundle`, `compile`, `package` | `build` |
| `debug`, `inspect` | `debug` |
| `prepare`, `setup`, `install`, `configure`, `generate`, `bootstrap` | `configure` |
| Anything else | `play` |

## Run states

The state of an action's latest run, shown in the Project Actions panel.

| State | Meaning |
| --- | --- |
| **Starting** | The command is starting. |
| **Running** | The command is running. |
| **Ready** | An action that keeps running is running, and its server answers. |
| **Stopping** | **Stop** or **Restart** is ending the run. |
| **Completed** | The command exited successfully. |
| **Failed** | The command exited with an error, or could not start. |
| **Stopped** | You stopped it. |
| **Interrupted** | The background Session Host stopped while the run was going, for example when the computer restarted. Choose **Restart** to run it again. |

## The actions.json file

`.openwaggle/actions.json` holds the actions, setup, and cleanup shared with everyone on the project. The [Project actions](/docs/configuration/project-actions#what-the-shared-file-contains) guide has an example file. Its JSON Schema is [`project-actions-v1.schema.json`](https://openwaggle.ai/schemas/project-actions-v1.schema.json).

| Field | Meaning |
| --- | --- |
| `version` | Always `1`. |
| `actions` | Up to 100 actions. Each `id` must be different. |
| `actions[].id` | Up to 128 letters, digits, `.`, `_`, and `-`, starting with a letter or digit. Settings generates it. |
| `actions[].name` | The name in the Project Actions panel, up to 120 characters. |
| `actions[].icon` | `play`, `test`, `lint`, `configure`, `build`, or `debug`. |
| `actions[].invocation` | What runs: a command or a project script. See [Invocations](#invocations). |
| `actions[].kind` | `task` for **Stops when done**, `service` for **Keeps running**. |
| `actions[].allowConcurrent` | `true` for **Start another copy**. Must be `false` for a `service`. |
| `actions[].autoOpenPreview` | `true` opens the browser preview when the server is ready. |
| `actions[].previewUrl` | Optional. The `http` or `https` address to preview instead of the one found in the output, without a user name or password. |
| `actions[].shortcutRules` | Optional. Keyboard shortcuts, recorded in the panel or in **Settings > Shortcuts**. At most 256 in a project. |
| `profiles` | Up to 20 extra setup profiles, each `{ "id", "name" }`. The `default` profile needs no entry. |
| `preparation` | Setup and cleanup commands. |
| `preparation[].id` | An identifier, with the same rules as an action's. |
| `preparation[].profileId` | `default`, or the `id` of an entry in `profiles`. |
| `preparation[].phase` | `setup`, which runs when a managed worktree is created and before the agent's first turn, or `cleanup`, which runs before the worktree is removed. A profile has at most one of each. |
| `preparation[].invocation` | What runs, as for an action. |

Every key is required except `previewUrl`, `shortcutRules`, and a task's `environment`. A missing or unknown key, `"$schema"` included, makes the whole file invalid: **Settings > Project actions** shows the error, and none of the project's actions work, your own included, until you fix it.

### Invocations

| Field | Meaning |
| --- | --- |
| `type` | `command` for a command you typed, `task` for a project script. |
| `command` | With `command`: the command line, run by your shell, up to 8,192 characters. |
| `directory` | With `command`: the folder it runs in. |
| `task.provider` | With `task`: `package-script` for a `package.json` script, `hatch-script` for a Hatch environment script, or `cargo-alias` for a Cargo alias. |
| `task.source` | The file that defines the script, such as `packages/web/package.json`. |
| `task.task` | The script's name, such as `test`, up to 120 characters. |
| `task.directory` | The folder the script runs in. For a package script, the folder of its `package.json`. |
| `task.environment` | Optional. The Hatch environment of a `hatch-script`. |

Folders and files are relative to the workspace root, with forward slashes, up to 4,096 characters. `.` is the root, and `..` is not allowed.

### Shortcut rules

| Field | Meaning |
| --- | --- |
| `shortcut.key` | The key. |
| `shortcut.mod`, `ctrl`, `shift`, `alt`, `meta` | Optional. `true` for each modifier the shortcut uses. |
| `when` | Optional. A condition, using context names with `!`, `&&`, `\|\|`, and parentheses, up to 256 characters. |
| `order` | Optional. Precedence among project action shortcuts. A later order wins. |
