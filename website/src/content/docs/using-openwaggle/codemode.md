---
title: "Codemode"
description: "Let the agent write a short script that calls several tools in one step, and read what the script did."
order: 4
section: "Using OpenWaggle"
---

Codemode is a tool that lets the agent write a small JavaScript program that calls its other tools. Instead of reading ten files one at a time, the agent can read all ten in one script and keep only the lines it needs. Only what the script prints reaches the model, so long outputs stay out of the conversation and the work finishes sooner.

Codemode comes from Pi, the agent runtime under OpenWaggle. It works the same way in OpenWaggle as in the Pi command line.

## When it is on

Codemode is on in every session by default, whether or not you use MCP servers. The agent decides when a script helps. Most turns still use ordinary tool calls.

To turn it off, open **Settings > General > Agent tools** and switch off **Codemode**. New runs stop offering it.

If you also use Pi on its own, OpenWaggle follows your Pi settings until you choose in OpenWaggle: when `~/.pi/agent/settings.json` names codemode in `defaultTools` (for example `"defaultTools": ["-codemode"]`), the switch starts in that position. Once you flip the switch, your OpenWaggle choice wins over that file, and OpenWaggle never writes it there.

Two exceptions still apply:

- MCP servers whose tools are set to the `codemode` exposure still turn it on, because their tools can only be called from scripts. See [MCP](/docs/configuration/mcp).
- A project's `.pi/settings.json` that lists its own tools by name replaces the tool list, as Pi documents, so a project without codemode in that list runs without it.

## What the agent can do in a script

A script runs in a sandbox with no file system, network, or timers of its own. It can only reach the outside world through tools:

- Call any tool the session can call, such as `read`, `bash`, `edit`, project actions, the browser preview, and MCP tools.
- Run several calls at once and combine the results.
- Show images with `image()`, for example a screenshot it read or a picture an image model made.
- Use non-chat models with your own provider credentials, such as a classifier that labels feedback or an image model that draws a picture. These run through `models.classify()` and `models.generateImages()`.
- Keep small values between scripts in the same branch of the conversation.

Calls a script makes are real. If a script fails halfway, the calls it already made are not undone.

## Approvals still apply

Every tool call a script makes goes through the same approval as a direct call. In **Ask for Approval**, a script that starts two project actions asks you twice, once per action, and a declined call fails inside the script without running. In **YOLO**, the calls run without asking, just as direct calls do. See [Approvals and permissions](/docs/configuration/approvals-permissions).

## Reading a codemode card

A codemode call appears in the conversation as **Ran a script** (or **Running a script…** while it works). The card shows:

- Each tool call the script made, with its arguments, whether it finished, failed or was cancelled, and how long it took. The list fills in while the script runs.
- The cost of any model calls the script made, next to the call and in the card header.
- The images the script showed.
- The error, when the script failed.

Click the card to see the script itself and its full output, and to copy either. The card looks the same after you reopen the session.

## Cost and usage

Model calls made from scripts count toward the session's cost and tokens, which you can see by hovering the context meter. See [Context management](/docs/using-openwaggle/context-management).
