---
title: "Waggle Mode"
description: "Two Pi-backed agents taking structured turns on the same task."
order: 3
section: "Using OpenWaggle"
---

Waggle Mode pairs two configured agents on the same task. Each turn runs through the same `AgentKernelService` port used by standard sessions.

## How It Works

1. Agent A receives the task and produces a response.
2. Agent B receives the same session context plus Agent A's output and responds.
3. The agents alternate for the configured turn limit or until consensus is detected.

The current collaboration style is sequential turns.

## Setting Up Presets

Open **Settings > Waggle Mode** and configure:

- Agent A model, role, and color.
- Agent B model, role, and color.
- Maximum turns.
- Consensus behavior.

The slash command menu can invoke a saved Waggle preset for the current prompt. The preset appears as a composer chip and applies to that send only.

## Runtime Behavior

Waggle uses the same Pi runtime, tool events, provider metadata, and session projection as standard sessions. A Pi extension drives the two-agent turn loop inside the active Pi session, Pi executes the native tools for each turn, and OpenWaggle stores Waggle attribution metadata in the session projection. Internal collaboration instructions are written through hidden Pi custom messages, so the transcript shows the user request and agent outputs rather than coordination prompts.

The standard agent can also invoke the visible `waggle_invoke` tool when a task materially benefits from two-agent collaboration. The standard turn settles first, then Waggle continues in the same session with the resolved preset and a self-contained handoff prompt. Waggle cannot invoke another Waggle run.

The execution bar above the composer is visible only while the collaboration is starting or running. It disappears on completion, stop, cancellation, or failure.

Waggle runs use the same branch and interruption behavior as standard runs. If the app closes while a Waggle run is active, OpenWaggle refreshes the latest Pi session snapshot on restart, marks the affected branch as interrupted, and waits for you to continue manually.

## Conflict Tracking

When both agents modify the same files, OpenWaggle tracks those overlaps so you can review them in the diff workflow.
