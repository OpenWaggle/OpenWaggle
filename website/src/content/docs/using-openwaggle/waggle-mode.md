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

The command palette can also start a saved Waggle preset.

## Runtime Behavior

Waggle uses the same Pi runtime, tool events, provider metadata, and session projection as standard sessions. A Pi extension drives the two-agent turn loop inside the active Pi session, Pi executes the native tools for each turn, and OpenWaggle stores Waggle attribution metadata in the session projection. Internal collaboration instructions are written through hidden Pi custom messages, so the transcript shows the user request and agent outputs rather than coordination prompts.

Waggle runs use the same branch and interruption behavior as standard runs. If the app closes while a Waggle run is active, OpenWaggle refreshes the latest Pi session snapshot on restart, marks the affected branch as interrupted, and waits for you to continue manually.

## Conflict Tracking

When both agents modify the same files, OpenWaggle tracks those overlaps so you can review them in the diff workflow.
