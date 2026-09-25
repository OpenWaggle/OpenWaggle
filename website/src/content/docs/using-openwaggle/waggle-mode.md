---
title: "Waggle Mode"
description: "Let two agents take sequential turns on a task in the same conversation."
order: 2
section: "Multiple agents"
---

Waggle Mode is optional. It lets two configured agents take turns on one task in the same conversation. For example, one can propose a change and the other can review it.

The agents work **sequentially**, not in parallel. They share the conversation and working directory. If you want independent sessions with their own transcripts and workspaces, use a [Hive](/docs/using-openwaggle/hives-and-sessions) instead.

## Setting up presets

1. Open **Settings > Waggle Mode**.
2. Choose a model, role, and display color for Agent A and Agent B. Use models you have connected and enabled.
3. Set **Max turns**, from 4 to 20 in the Settings slider, and choose **Consensus** or **Manual** under **Stop when**. The turn limit is a safety cap in either mode.
4. Save the preset.
5. In a conversation, type `/` and select the saved Waggle preset. It appears as a chip beside your prompt and applies to that send only.

Try a bounded task:

```text
Review the error handling in src/api/client.ts.
Agent A: identify failure cases and propose changes.
Agent B: check those proposals against the callers and tests.
Do not edit files. Finish with agreed findings and any unresolved disagreements.
```

Review the agents' findings yourself. Agreement between two agents is not proof that a change is correct, and each turn uses the selected provider's allowance or billing.

## How it works

1. Agent A receives the task and responds, using available tools when needed.
2. Agent B receives the conversation context, including Agent A's output, and responds.
3. They alternate until the configured stopping condition or turn limit is reached.

The execution bar above the message box appears while the collaboration is starting or running. It disappears when the collaboration finishes, stops, or fails. You can stop it rather than waiting for the turn limit.

## Conflict tracking

When both agents modify the same files, the active Waggle status bar can show a warning naming the file and the two agents. Use the [diff panel](/docs/developer-workflow/git-integration) to review the resulting changes. Edits have already happened on disk; overlap tracking does not approve or undo them.

## Runtime behavior

Waggle uses the same Pi runtime, tools, provider metadata, and session history as a standard session. A Pi extension drives the alternating turns. OpenWaggle shows which agent produced each output and keeps internal coordination prompts out of the visible transcript.

A standard agent can also call `waggle_invoke` to hand a task to a Waggle preset. The standard turn finishes first, then Waggle continues in the same session with the preset and a self-contained handoff prompt. Waggle cannot invoke another Waggle run.

Waggle uses the normal session branch and interruption behavior. Closing the GUI does not by itself stop work owned by the local Session Host. If the process executing a run is interrupted, inspect the restored conversation before asking the agent to continue.
