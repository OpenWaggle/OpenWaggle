---
title: "Waggle Mode"
description: "Two Pi-backed agents taking structured turns on the same task."
order: 2
section: "Using OpenWaggle"
---

Waggle Mode pairs two configured agents on the same task. Each turn runs through the same `AgentKernelService` port used by standard sessions.

## How It Works

1. Agent A receives the task and produces a response.
2. Agent B receives the task plus Agent A's output and responds.
3. The agents alternate for the configured turn limit or until consensus is detected.
4. A synthesis step produces the final response.

The current collaboration style is sequential turns.

## Setting Up A Team

Open **Settings > Waggle Mode** and configure:

- Agent A model, role, and color.
- Agent B model, role, and color.
- Maximum turns.
- Consensus behavior.

The command palette can also start a saved Waggle preset.

## Runtime Behavior

Waggle does not introduce a separate custom approval token, tool runtime, or provider system. Pi executes the native tools for each turn, and OpenWaggle stores Waggle attribution metadata in the session projection. Internal collaboration instructions are written through hidden Pi custom messages, so the transcript shows the user request and agent outputs rather than coordination prompts.

## Synthesis

After the turn loop, OpenWaggle asks a configured model to synthesize the result. The current implementation tries the globally selected model first, then falls back to the first agent model if needed.

## Conflict Tracking

When both agents modify the same files, OpenWaggle tracks those overlaps so you can review them in the diff workflow.
