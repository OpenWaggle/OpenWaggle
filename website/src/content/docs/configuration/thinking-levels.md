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
3. Choose one of the available levels before sending your next message.

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

The default requested level is **Medium**. Choose a different level with the control beside the message box.

Pi, the agent engine included with the app, supplies the supported levels. The model and provider determine what each effort level means. It is not a fixed time limit or token budget.

## If the control is unavailable

Choose a model first and let its capabilities load. A model that supports only **Off** cannot be made to reason at a higher level. If you expected other choices, check that you selected the intended provider and model.
