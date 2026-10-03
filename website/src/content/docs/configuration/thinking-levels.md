---
title: "Thinking levels"
description: "Choose how much reasoning effort a supported model uses for a task."
order: 14
section: "Customize"
---

A thinking level asks a model how much reasoning effort to spend before answering. Higher levels can help with difficult debugging or planning, but may take longer and use more of your provider's quota. They do not guarantee a correct answer.

## Choose a level

1. Select a model beside the message box.
2. Open the thinking-level control next to the model controls. It shows the current level, such as **Medium**.
3. Choose one of the available levels. The control is unavailable while a Run is starting, running, or stopping. You can still change the level while a Session is only waiting on queued messages. In a new conversation that has no Session yet, your choice becomes the default and the Session starts with it.

Start with the current level for ordinary work. Try a higher level when the model misses an important constraint or needs to reason through a difficult problem. Check its work either way.

The choices depend on the selected model. **Off**, **Extra High**, and **Max** appear only when supported; you cannot enable an unsupported level by changing its name in a configuration file. If you switch models, the effective level may be adjusted to one the new model supports. Hover over the control for details.

## Level names

These are all possible labels, not a list every model provides:

| In the app | In configuration |
|------------|------------------|
| Off | `off` |
| Minimal | `minimal` |
| Low | `low` |
| Medium | `medium` |
| High | `high` |
| Extra High | `xhigh` |
| Max | `max` |

The thinking level belongs to the Session, like its model. Every Run in the Session uses it, including queued messages when their turn comes; a queued message never keeps the level that was selected when you sent it. Changing it never affects your other Sessions.

The level you choose also becomes the default for new Sessions. Pi keeps that default in its global settings, and every new Session starts from it in every project. OpenWaggle ignores a project-level `defaultThinkingLevel` in `.pi/settings.json` or in the `pi` object of `.openwaggle/settings.json`, and it no longer reads the old `thinkingLevel` project preference. Until you choose a level, the default is **Medium**.

Agents and CLI callers can set a Session's level when they create, launch, or spawn it, or with a message that starts a Run on an idle Session. Their choice applies to that Session only and never changes your default. Extensions can read the default but cannot change it.

Pi, the agent engine included with the app, supplies the supported levels. The model and provider determine what each effort level means. It is not a fixed time limit or token budget.

## If the control is unavailable

Choose a model first and let its capabilities load. A model that supports only **Off** cannot be made to reason at a higher level. If you expected other choices, check that you selected the intended provider and model.
