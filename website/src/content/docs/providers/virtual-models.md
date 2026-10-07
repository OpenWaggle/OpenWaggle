---
title: "Virtual models"
description: "Use a router model that sends each request to a different real model, and see which model answered."
order: 3
section: "Customize"
---

A virtual model is a model you pick like any other, but it does not answer by itself. A small program called a router looks at each request and sends it to a real model. A router might send quick questions to a small, cheap model and hard problems to a large one, while you keep one model selected for the whole session.

Virtual models come from Pi extensions. OpenWaggle shows whatever virtual models your Pi extensions register, so a router you already use with the Pi command line works here unchanged. To write one, see [Pi virtual models](https://pi.dev/docs/latest/virtual-models).

## Turn one on

1. Install or enable the Pi extension that provides the router. See [Pi extensions](/docs/extending/pi-extensions).
2. Open **Settings > Connections** and, under **Available Models**, enable the virtual model. It is listed under the provider the extension chose, for example **Auto** under `router`.
3. Pick it in the model picker beside the message box.

A virtual model listed under a real provider, such as `openai-codex/auto`, is available when that provider is connected. One listed under its own name is always available, but the models it routes to still need their providers connected.

## See which model answered

After the virtual model has answered, the model picker shows where the latest request went, for example **Auto → GPT-6 Luna**. Hover it to read the full sentence. The label updates when each run ends and is still there after you reopen the session. Right after you switch to a virtual model it shows no destination until that model has answered.

## Context meter and cost

Different real models have different context windows. The context meter always measures against the window of the real model that produced the latest response, never the virtual model's. Before the first response, it uses the limits the router declared, if any.

Hover the context meter to see the session's total tokens and cost, split by the real models that answered. Costs land on the models the router used, not on the virtual model. See [Context management](/docs/using-openwaggle/context-management).

## Things to know

- Switching real models between turns loses the provider's prompt cache, which can make the next request slower and more expensive. Good routers keep follow-up requests on the model that started the turn.
- If the extension that provides the virtual model is removed, a session that used it falls back to the real model that answered last.
- Waggle agents can pin a virtual model like any other model.
