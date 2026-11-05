---
title: "Waggle Mode"
description: "Let two agents take turns on a task in the same conversation."
order: 2
section: "Multiple agents"
kind: "guide"
---

Waggle Mode lets two agents take turns on one task in the same conversation. One can propose a change while the other checks it, or the two can argue opposite sides of a design. Use it when a second opinion on each step is worth paying for. You choose the two agents, their models and their roles in a saved preset.

The agents work one after the other, never at the same time. They share the conversation and the working directory. If you want agents to work side by side, each in its own session and optionally its own worktree, use a [Hive](/docs/using-openwaggle/hives-and-sessions) instead.

```mermaid
%% alt: A Waggle takes turns inside one session, while a Hive runs separate sessions side by side
flowchart LR
  subgraph waggle["Waggle: one session"]
    direction LR
    A1["Agent A turn"] --> B1["Agent B turn"] --> A2["Agent A turn"]
  end
  subgraph hive["Hive: separate sessions"]
    direction TB
    Q["Queen session"] --> W1["Worker session<br/>own transcript; shared checkout or own worktree"]
    Q --> W2["Worker session<br/>own transcript; shared checkout or own worktree"]
  end
```

## Set up a preset

OpenWaggle comes with three presets, **Code Review**, **Debate** and **Red Team**. You can edit them or add your own.

1. Open **Settings > Waggle Mode**.
2. Pick a preset, or choose **New Custom Preset**.
3. For **Agent A** and **Agent B**, set a **Label**, a **Model**, a **Role description** and a **Color**. Use models you have connected and turned on.
4. Under **Collaboration**, choose **Consensus** or **Manual** for **Stop when**, and set **Max turns** between 4 and 20. The turn limit applies in both modes, so a Waggle never runs forever.
5. Choose **Save Changes**.

When you change a preset, it shows **Edited** until you save. **New Custom Preset** saves the form as a new preset instead of changing the one you started from.

![Settings > Waggle Mode with the Code Review preset marked Edited, its two agents, and Collaboration set to stop on Consensus within 8 turns](/screenshots/settings-waggle-mode.png)

## Start a Waggle

In a conversation, type `/` and select your Waggle preset. It appears as a chip beside your prompt and applies to that message only. Then write the task. A bounded task works best:

```text
Review the error handling in src/api/client.ts.
Agent A: identify failure cases and propose changes.
Agent B: check those proposals against the callers and tests.
Do not edit files. Finish with agreed findings and any unresolved disagreements.
```

Agent A answers first, using tools when it needs them. Agent B then reads the conversation, including Agent A's reply, and answers in turn. They keep alternating until they reach consensus, you stop them, or they hit the turn limit.

Each turn starts with its number, the agent's label and its model, in that agent's color. While the Waggle runs, a bar above the message box names both agents and shows the current turn, such as `Turn 3/8`. It disappears when the Waggle finishes, stops or fails.

![A Waggle conversation in its third turn, with Architect and Reviewer turns in their colors and the Waggle bar above the message box](/screenshots/waggle-conversation.png)

Read the result yourself. Two agents agreeing does not prove a change is correct, and every turn uses your provider's allowance or billing.

## Stop a Waggle

Choose the **×** at the end of the Waggle bar (**Stop & dismiss Waggle**) to stop it without waiting for the turn limit. Stopping works like stopping any run.

Closing the app window does not stop a Waggle by itself, because the local Session Host runs it. If the process running the turn is interrupted, read the restored conversation before you ask the agents to continue.

## Check files both agents changed

When both agents edit the same file, the Waggle bar can show a warning that names the file and the two agents. Review those changes in the [diff panel](/docs/developer-workflow/git-integration). The edits are already on disk. The warning does not approve or undo them.

## Share presets with your team

Settings saves your presets as JSON. With a project open, they go to `.pi/waggle-presets.json` in the project, so you can commit them for your team. Without a project, they go to `~/.pi/agent/waggle-presets.json`.

The list in Settings and in the `/` menu combines the built-in presets, your user file and the project file. A preset with the same `id` as a built-in or user preset replaces it, and the project file wins.

```json
{
  "wagglePresets": [
    {
      "id": "api-review",
      "name": "API review",
      "description": "One agent proposes changes, the other checks them against callers and tests.",
      "config": {
        "mode": "sequential",
        "agents": [
          {
            "label": "Proposer",
            "model": "$inherit",
            "roleDescription": "Identify failure cases and propose concrete changes.",
            "color": "blue"
          },
          {
            "label": "Checker",
            "model": "anthropic/claude-sonnet-4-5",
            "roleDescription": "Check each proposal against the callers and tests. Reject what they do not support.",
            "color": "amber"
          }
        ],
        "stop": {
          "primary": "consensus",
          "maxTurnsSafety": 8
        }
      },
      "isBuiltIn": false,
      "createdAt": 1767225600000,
      "updatedAt": 1767225600000
    }
  ],
  "hiddenBuiltInPresetIds": ["debate"]
}
```

- `config.agents` holds Agent A and Agent B, in turn order. `model` is `$inherit` for the session's model, or a `provider/model` id. `color` is `blue`, `amber`, `emerald` or `violet`.
- `stop.primary` is `consensus` for **Consensus** or `user-stop` for **Manual**. `stop.maxTurnsSafety` is the turn limit, from 1 to 100 in the file.
- `mode` is always `sequential`.
- `isBuiltIn`, `createdAt` and `updatedAt` are required. Use `false` for `isBuiltIn`. `createdAt` and `updatedAt` are times in milliseconds since 1970, and Settings sets `updatedAt` each time it saves the preset.
- `hiddenBuiltInPresetIds` hides built-in presets by id: `code-review`, `debate` or `red-team`.

Settings skips a preset that does not match this format, without an error. It also removes that preset from the file the next time it saves or deletes a preset in that file, because it writes back only the presets it could read. A JSON syntax error hides every preset in the file, and saving a preset to that file fails until you fix it. After you edit the file by hand, check the list in **Settings > Waggle Mode**.

The format has a JSON Schema, [`waggle-presets.schema.json`](https://openwaggle.ai/schemas/waggle-presets.schema.json). Settings rewrites the file without a `"$schema"` key, so associate the schema in your editor instead, as [Per-project configuration](/docs/configuration/per-project-config#json-schemas-for-editors) shows.

## Hand a task to Waggle from an agent

A normal agent can call `waggle_invoke` to hand a task to a Waggle preset. The agent's own turn finishes first. Then the Waggle continues in the same session, with the preset and a handoff prompt that holds everything the agents need. A Waggle cannot start another Waggle.

Waggle uses the same Pi runtime, tools, provider settings and session history as a normal session; a Pi extension takes care of the turns. OpenWaggle shows which agent wrote each reply and keeps its own coordination prompts out of the visible transcript. Branching and stopping work as in any session.
