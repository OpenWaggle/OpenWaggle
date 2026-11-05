---
title: "Codemode"
description: "Let the agent write a short script that calls several tools in one step, and read what the script did."
order: 4
section: "Using OpenWaggle"
kind: "guide"
---

Codemode lets the agent write a small JavaScript program that calls its other tools. Instead of reading ten files one at a time, the agent can read all ten in one script and keep only the lines it needs. Only what the script prints reaches the model, so long output stays out of the conversation and the work finishes sooner.

Codemode comes from Pi, the agent inside OpenWaggle, and works the same way as in the `pi` command.

## Turn codemode on or off

Codemode is on in every session by default, whether or not you use MCP servers. The agent decides when a script helps, and most turns still use ordinary tool calls.

To turn it off, open **Settings > General > Agent tools** and switch off **Codemode**. New runs stop offering it.

If you also use Pi on its own, OpenWaggle follows your Pi settings until you choose in OpenWaggle. When `~/.pi/agent/settings.json` names codemode in `defaultTools`, for example `"defaultTools": ["-codemode"]`, the switch starts in that position. Once you flip the switch, your OpenWaggle choice wins over that file, and OpenWaggle never writes it there.

Two things override the switch:

- An MCP server whose tools run through codemode, which is the default, turns codemode on, because its tools can only be called from scripts. OpenWaggle also runs a server set to `direct` this way. See [MCP](/docs/configuration/mcp).
- A project's `.pi/settings.json` that lists its own tools by name replaces the tool list, as Pi documents. A project that leaves codemode out of that list runs without it.

## What the agent can do in a script

A script runs in a sandbox with no file system, network or timers of its own. It reaches the outside world only through tools. In a script, the agent can:

- Call any tool the session can call, such as `read`, `bash`, `edit`, project actions, the browser preview and MCP tools.
- Run several calls at once and combine the results.
- Show images with `image()`, such as a screenshot it read or a picture an image model made.
- Use models that aren't chat models, with your own provider credentials: a classifier that labels feedback through `models.classify()`, or an image model that draws a picture through `models.generateImages()`.
- Keep small values between scripts in the same branch of the conversation.

A script's tool calls are real. If a script fails halfway, the calls it already made are not undone.

## What a script looks like

Say you ask where the API client throws errors. Instead of three `read` calls that each put a whole file into the conversation, the agent can send one script:

```js
const paths = ['src/api/client.ts', 'src/api/retry.ts', 'src/api/errors.ts']
const files = await Promise.all(paths.map((path) => tools.read({ path })))

paths.forEach((path, index) => {
  const throws = files[index]
    .split('\n')
    .flatMap((line, number) => (line.includes('throw ') ? [`  ${number + 1}: ${line.trim()}`] : []))
  text(`${path}: ${throws.length} throw statements\n${throws.join('\n')}`)
})
```

The three reads run at the same time. Each tool is a function on `tools` that takes the same arguments as a direct call, and `text()` adds a line to the output. The model gets back three short lists of line numbers instead of three files. The card in the conversation shows the three `read` calls, and its details show the script and what it printed.

## Approvals still apply

Every tool call in a script goes through the same approval as a direct call. With **Ask for approval**, a script that starts two project actions asks you twice, once for each action, and a call you decline fails inside the script without running. With **YOLO**, the calls run without asking, as direct calls do. See [Approvals and permissions](/docs/configuration/approvals-permissions).

## Read a codemode card

A script appears in the conversation as **Ran a script**, or **Running a script…** while it works. A failed script keeps that label and ends with a red **×**. The card shows:

- Each tool call the script made, with its icon, its arguments, how long it took, and a red **×** if it failed or was cancelled. The list fills in while the script runs.
- The cost of any model calls the script made, beside each call and in the card's header.
- The images the script showed.
- The error, if the script failed.

Click the card to see the script and its full output, and to copy either. The card looks the same when you reopen the session.

![An expanded Ran a script card with three reads and a grep, one read failed with its error, then the script and its output](/screenshots/codemode-script-card.png)

## Cost and usage

Model calls from scripts count toward the session's cost and tokens. Hover the context meter to see them. See [Context management](/docs/using-openwaggle/context-management#check-the-context-meter).
