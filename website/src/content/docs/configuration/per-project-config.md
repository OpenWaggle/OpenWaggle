---
title: "Per-project configuration"
description: "Configure project resources, shared actions, and advanced options without changing every project."
order: 13
section: "Customize"
---

Use Settings for ordinary changes such as connecting a model, choosing an access mode, or changing fonts. Use a project configuration file when you need settings that apply only to one repository.

OpenWaggle reads `.openwaggle/settings.json` in the project root. Keep your real settings file gitignored. If your team needs shared examples, commit a separate non-secret template rather than a file containing personal preferences or credentials.

## Settings file

Use `.openwaggle/settings.json` for advanced project options, such as Worker limits and runtime configuration. Include only the values you need. Top-level keys belong to OpenWaggle; the nested `pi` object configures Pi, the agent engine included with the app:

```json
{
  "sessionHost": {
    "multiAgentEnabled": true,
    "parentConcurrencyLimit": 8
  },
  "pi": {
    "treeFilterMode": "default",
    "branchSummary": {
      "skipPrompt": false
    },
    "compaction": {
      "enabled": true,
      "reserveTokens": 16384,
      "keepRecentTokens": 20000
    }
  }
}
```

`sessionHost.multiAgentEnabled` lets agents create sessions to share work in this project. `sessionHost.parentConcurrencyLimit` is a positive integer limiting simultaneous direct Worker runs under one parent session, not the number of saved conversations. See [Hives and sessions](/docs/using-openwaggle/hives-and-sessions).

For these project controls, values in the file take precedence over older saved project overrides, then app-wide defaults. **Settings > Agents** changes the defaults. Its **Saved project overrides** list can clear older overrides but does not edit your project file.

Pi may also read `.pi/settings.json`. Keep that real settings file untracked too. Prefer `.openwaggle/settings.json` for OpenWaggle configuration, and do not put Pi settings at its top level.

## Resource precedence

Skills, extensions, prompts, and themes can live in these project folders. When the same resource name exists in several locations, OpenWaggle prefers them in this order:

```text
.openwaggle > .pi > .agents
```

For example, `.openwaggle/skills/review/SKILL.md` takes precedence over a same-name skill in `.agents/skills`. This is useful when you need an OpenWaggle-specific version without changing files used by other tools.

A project might contain:

```text
your-project/
  .openwaggle/
    settings.json
    actions.json
    mcp.json
    skills/
    extensions/
    prompts/
    themes/
  .pi/
    settings.json
    waggle-presets.json
    skills/
    extensions/
    prompts/
    themes/
  .agents/
    skills/
    extensions/
    prompts/
    themes/
  .mcp.json
```

You do not need to create every folder. Keep personal settings untracked. Shared resources and `.openwaggle/actions.json` can follow your team's version-control policy. OpenWaggle does not save its automatically added resource paths back into your project settings.

## Project actions and workspace preparation

Manage these in **Settings > Project actions**, which has its own project picker. Actions and preparation definitions are local to the selected project by default. Saving a private definition does not create a repository file or make it available to unrelated projects.

Choose **In the project** for an action, or project storage for setup or cleanup, to save that definition in `.openwaggle/actions.json`. This file is separate from `.openwaggle/settings.json` and is intended for sharing through version control. It contains definitions, not authorization grants, prepared environment values, or run history. Keep secrets out of commands and do not ignore the entire `.openwaggle/` folder if you intend to share resources from it.

Each action, setup, and cleanup has its own storage choice. A private override can customize a shared definition without changing the repository copy. **Restore shared version** removes that override.

Discovering shared setup or cleanup does not enable it. Review and enable the definition locally before automatic execution. Worktrees retain their selected preparation profile's snapshot until you explicitly adopt an update. See [Project actions](/docs/configuration/project-actions) for creating tasks, running services, and preparing workspaces.

## MCP config precedence

MCP server definitions have their own files. OpenWaggle merges them by server name in this order, with later sources winning:

```text
~/.openwaggle/mcp.json
<project>/.mcp.json
<project>/.openwaggle/mcp.json
```

A project file can define a server but cannot silently enable it. Enabling a server in Settings also records trust; OpenWaggle keeps those choices outside the project configuration. Turning off a server does not delete its definition.

Older Pi, `.agents`, and `.openwaggle/agent/mcp.json` files are migration sources, not the current active precedence chain. Use **Settings > MCP > Migrate existing MCP configuration** to inspect and import them. See [MCP configuration](/docs/configuration/mcp#configuration-files) for examples and secret handling.

## Thinking level

Choose the thinking level with the control beside the message box. Available levels depend on the selected model. See [Thinking levels](/docs/configuration/thinking-levels) for using this control.

## Runtime settings

The nested `pi` object is for advanced configuration. Use Pi's JSON setting names:

- `treeFilterMode` remembers a Session Tree filter.
- `branchSummary.skipPrompt` skips the summary choice when navigating from an earlier conversation-tree point.
- `compaction.reserveTokens` and `compaction.keepRecentTokens` affect how much space compaction reserves and how much recent context it keeps.

The automatic compaction percentage is app-wide. Set it in **Settings > General > Context compaction**. A project `pi.compaction.thresholdPercent` does not override it.

Appearance preferences and the default **Session environment mode** are also app-wide, not project-file overrides. The background session service's idle grace period is an internal global setting, not a project option.

The old `actions` key is a migration source only. Create and edit new actions through **Settings > Project actions**, using private storage or the dedicated `.openwaggle/actions.json` sharing file.
