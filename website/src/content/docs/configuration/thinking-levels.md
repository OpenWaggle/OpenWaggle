---
title: "Thinking levels"
description: "Choose how much reasoning effort a supported model uses for a task."
order: 14
section: "Customize"
kind: "guide"
---

The thinking level tells a model how hard to think before it answers. A higher level can help with tricky debugging or planning, but the answer takes longer and uses more of your provider's quota. It does not guarantee a correct answer. Use the level you have for ordinary work, and raise it when the model misses an important constraint or has to reason through a hard problem.

## Choose a level

1. Pick a model beside the message box.
2. Open the thinking-level menu next to the model selector. It shows the current level, such as **Medium**.
3. Choose a level.

![The composer's thinking-level menu open, listing the levels the selected model supports](/screenshots/composer-thinking-menu.png)

The menu lists only the levels the selected model supports. **Off**, **Extra High** and **Max** appear only for models that have them, and renaming a level in a configuration file does not unlock one. When you switch to a model that lacks your level, OpenWaggle uses a level the new model supports, and hovering the menu tells you, for example "High is not available for this model; using Medium".

You cannot change the level while a run is starting, running or stopping. You can while the session is only waiting on queued messages.

## Know where the level applies

The level belongs to the session, like its model. Every run in the session uses it, including queued messages when their turn comes. A queued message does not keep the level you had when you sent it. Changing the level in one session never affects your other sessions.

The level you choose also becomes the default for new sessions, in every project. Pi, the agent engine inside OpenWaggle, keeps that default in its global settings. In a new conversation that has no session yet, your choice becomes the default and the session starts with it. Until you choose a level, the default is **Medium**.

No project file can set the level. OpenWaggle ignores a `defaultThinkingLevel` in `.pi/settings.json` or in the `pi` object of `.openwaggle/settings.json`, and it no longer reads the old `thinkingLevel` project preference.

Agents and CLI callers can set a session's level when they create, launch or spawn it, or with a message that starts a run on an idle session. Their choice applies to that session only and never changes your default. Extensions can read the default but cannot change it.

## Level names

These are every possible level. No model offers all of them.

| In the app | In configuration |
| --- | --- |
| **Off** | `off` |
| **Minimal** | `minimal` |
| **Low** | `low` |
| **Medium** | `medium` |
| **High** | `high` |
| **Extra High** | `xhigh` |
| **Max** | `max` |

Pi supplies the levels a model supports. The model and its provider decide what each level means, so a level is not a fixed time limit or token budget.

## If the menu is unavailable

Pick a model first and give its capabilities a moment to load. While they load, hovering the menu says so. A model that supports only **Off** cannot reason at a higher level, and the menu says the model does not support thinking. If you expected more choices, check that you picked the right provider and model.
