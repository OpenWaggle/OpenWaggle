---
title: "Configuration files"
description: "Every file OpenWaggle reads its configuration from, with its JSON Schema."
section: "Reference"
kind: "reference"
---

This page lists every file OpenWaggle and Pi read configuration from, where it lives, what it holds, and its JSON Schema. `<project>` is the project's root folder. `~` is your home folder. For when to use a project file instead of Settings, see [Per-project configuration](/docs/configuration/per-project-config). For logs, the session database and other data OpenWaggle writes, see [Data and file locations](/docs/reference/data-locations).

## OpenWaggle files

| File | Purpose | Written by | JSON Schema |
| --- | --- | --- | --- |
| `<project>/.openwaggle/settings.json` | Project settings: worker limits, the project's access mode, saved approvals, source control hosts, and Pi settings in a `pi` object. | You, and Settings | [`project-settings.schema.json`](https://openwaggle.ai/schemas/project-settings.schema.json) |
| `<project>/.openwaggle/actions.json` | Shared project actions, setup profiles, and worktree setup and cleanup. | **Settings > Project actions**, when you share an action | [`project-actions-v1.schema.json`](https://openwaggle.ai/schemas/project-actions-v1.schema.json) |
| `<project>/.openwaggle/mcp.json` | The project's MCP servers. | You, and **Settings > MCP** | [`mcp.schema.json`](https://openwaggle.ai/schemas/mcp.schema.json) |
| `~/.openwaggle/mcp.json` | Your MCP servers for every project. | You, and **Settings > MCP** | [`mcp.schema.json`](https://openwaggle.ai/schemas/mcp.schema.json) |
| `<project>/.openwaggle/agents/*.md` | The project's agent definitions. | You | [`agent-definition-v1.schema.json`](https://openwaggle.ai/schemas/agent-definition-v1.schema.json), for the frontmatter |
| `<project>/.agents/agents/*.md` | More project agent definitions, shared with other tools. | You | [`agent-definition-v1.schema.json`](https://openwaggle.ai/schemas/agent-definition-v1.schema.json), for the frontmatter |
| `~/.openwaggle/agents/*.md` | Your agent definitions for every project. | You | [`agent-definition-v1.schema.json`](https://openwaggle.ai/schemas/agent-definition-v1.schema.json), for the frontmatter |
| `<project>/.openwaggle/skills/`, `extensions/`, `prompts/`, `themes/` | Skills, extensions, prompts and themes for OpenWaggle only. | You | None |
| `<project>/AGENTS.md` | Instructions the agent reads in every session. See [Project instructions](/docs/extending/agents-md). | You | None |

Every schema lives at `https://openwaggle.ai/schemas/` followed by its file name.

## Pi files

Pi is the agent engine inside OpenWaggle, and it reads its own files too. Paths under `~/.pi/agent/` move to the folder in [`PI_CODING_AGENT_DIR`](/docs/reference/environment-variables#pi) when you set that variable.

| File | Purpose | Written by | JSON Schema |
| --- | --- | --- | --- |
| `~/.pi/agent/settings.json` | Pi's global settings, such as the default thinking level, `defaultTools` and `cacheWarming`. | Pi, and you | None. See [Pi's settings reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md). |
| `<project>/.pi/settings.json` | Pi's settings for one project. | You | None |
| `~/.pi/agent/auth.json` | Provider API keys and sign-ins. Keep it secret. | **Settings > Connections**, and Pi | None |
| `~/.pi/agent/models.json` | Custom providers and models. See [Custom providers](/docs/providers/custom-providers). | You | [`models.schema.json`](https://pi.dev/schemas/models.schema.json) |
| `~/.pi/agent/mcp.json` | Your MCP servers, shared with Pi. | You | None |
| `<project>/.pi/mcp.json` | The project's MCP servers, shared with Pi. | You | None |
| `<project>/.mcp.json` | The project's MCP servers, in the file other tools also read. | You | None |
| `~/.pi/agent/waggle-presets.json` | Your Waggle presets for every project. | **Settings > Waggle Mode** | [`waggle-presets.schema.json`](https://openwaggle.ai/schemas/waggle-presets.schema.json) |
| `<project>/.pi/waggle-presets.json` | The project's Waggle presets. | **Settings > Waggle Mode** | [`waggle-presets.schema.json`](https://openwaggle.ai/schemas/waggle-presets.schema.json) |
| `<project>/.pi/skills/`, `extensions/`, `prompts/`, `themes/` | Pi skills, extensions, prompts and themes. | You | None |
| `<project>/.agents/skills/`, `extensions/`, `prompts/`, `themes/` | Skills, extensions, prompts and themes shared with other agent tools. | You | None |

The thinking level is never read from a project file. OpenWaggle ignores `defaultThinkingLevel` in `<project>/.pi/settings.json` and in the `pi` object of `.openwaggle/settings.json`. See [Thinking levels](/docs/configuration/thinking-levels).

## The `$schema` key

| File | `"$schema"` key |
| --- | --- |
| `.openwaggle/settings.json` | Allowed. OpenWaggle keeps it when it writes the file. |
| `mcp.json` in `~/.openwaggle/` or `.openwaggle/` | Allowed. OpenWaggle keeps it when it writes the file. |
| Agent definition frontmatter | Allowed. See [Agent definitions](/docs/extending/agent-definitions#openwaggle-v1-format). |
| `.openwaggle/actions.json` | Not allowed. OpenWaggle rejects any unknown key, `"$schema"` included. |
| `waggle-presets.json` | Removed when Settings saves the file. |

For the two files that cannot keep the key, point your editor at the schema instead. See [JSON Schemas for editors](/docs/configuration/per-project-config#json-schemas-for-editors).

## `.openwaggle/settings.json` keys

Top-level keys belong to OpenWaggle. Pi's own settings go in the `pi` object, with Pi's names.

| Key | Type | What it does |
| --- | --- | --- |
| `$schema` | string | The file's JSON Schema. |
| `sessionHost.multiAgentEnabled` | boolean | Lets agents create worker sessions in this project. Overrides **Agent-created Workers**. |
| `sessionHost.parentConcurrencyLimit` | integer, 1 or more | The most runs one parent session's direct workers can have at the same time. Overrides **Workers per parent**. |
| `preferences.authorizationMode` | `yolo` or `ask-for-approval` | The project's access mode, written by **Settings > Permissions > Selected project**. |
| `authorizationGrants` | array | Saved approvals, written when you choose **Always allow**. Revoke them in **Settings > Permissions**. |
| `sourceControl.hosts` | object | The provider of each host, `github` or `gitlab`, by host name. |
| `sourceControl.changeRequestOpenDestination` | `inspector` or `website` | Where pull and merge requests open for this project: in OpenWaggle or on the provider's site. |
| `pi` | object | Pi settings for this project. The schema does not check it. |
| `actions` | array | An older format for project actions. OpenWaggle reads it only to move the actions to their new home. |
| `preferences.model` | string | No longer used. OpenWaggle moves it into its own storage the next time it writes the file. |

A value in this file wins over a value saved in the app, which wins over the app-wide default.

These `pi` keys affect OpenWaggle:

| Key | What it does |
| --- | --- |
| `treeFilterMode` | The Session Tree filter to start with. |
| `branchSummary.skipPrompt` | Skips the summary question when you go back to an earlier point in the conversation. |
| `compaction.enabled` | Turns automatic compaction on or off. |
| `compaction.reserveTokens` | Tokens compaction keeps free for the model's reply. |
| `compaction.keepRecentTokens` | Recent tokens compaction keeps without summarizing. |

OpenWaggle ignores these, and sets them elsewhere instead:

| Key | Set it in |
| --- | --- |
| `pi.compaction.thresholdPercent` | **Settings > General > Context compaction**, for every project. |
| `pi.defaultThinkingLevel` | The thinking-level menu beside the message box. |
| `thinkingLevel` | The thinking-level menu beside the message box. |

Appearance, the default for **New Sessions run in**, and how long the background Session Host stays running when idle are app-wide and cannot be set in a project file.

## MCP file order

OpenWaggle reads MCP servers from these files in this order. For a server name that appears in more than one file, the later file wins, so a project file beats a global one.

| Order | File |
| --- | --- |
| 1 | `~/.pi/agent/mcp.json` |
| 2 | `~/.openwaggle/mcp.json` |
| 3 | `<project>/.mcp.json` |
| 4 | `<project>/.pi/mcp.json` |
| 5 | `<project>/.openwaggle/mcp.json` |

Only the two OpenWaggle files can hold SSE and WebSocket servers and secret references. Names that differ only in `-` and `_` count as the same server. See [MCP connections](/docs/configuration/mcp#where-servers-are-configured).

## Resource folder order

When a skill, extension, prompt or theme with the same name is in more than one project folder, the first folder wins:

| Order | Folder |
| --- | --- |
| 1 | `<project>/.openwaggle/` |
| 2 | `<project>/.pi/` |
| 3 | `<project>/.agents/` |

Skills match by the `name` in their frontmatter, not by folder name. Enabled OpenWaggle extension packages can add skill folders between `.openwaggle/skills/` and `.pi/skills/`. See [Skills](/docs/extending/skills-system).

## Agent definition order

Agent definitions match by the `name` in their frontmatter. When two have the same name, the first location wins, and an invalid file there does not fall through to the next one:

| Order | Location |
| --- | --- |
| 1 | `<project>/.openwaggle/agents/*.md` |
| 2 | `<project>/.agents/agents/*.md` |
| 3 | `~/.openwaggle/agents/*.md` |

See [Agent definitions](/docs/extending/agent-definitions).
