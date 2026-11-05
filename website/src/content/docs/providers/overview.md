---
title: "Providers and models"
description: "Connect a provider account, enable models, and choose a model for your conversation."
order: 1
section: "Customize"
kind: "guide"
---

A provider is the company or server that runs the AI models OpenWaggle talks to. You bring your own account, so the provider's prices and usage limits still apply. Getting a model ready takes two steps: connect the provider, then turn on the models you want. For a first setup, connect one provider and enable one model. You can add more later.

## Connect a provider and pick a model

1. Click the gear icon in the sidebar and open **Connections**.
2. Expand **API Key Providers** to paste a key, or **OAuth Providers** to sign in through your browser. Use whichever your account supports.
3. Under **Available Models**, turn on the models you want to use.
4. Go back to your conversation and pick one of them in the model selector beside the message box.

To paste a key, expand **API Key Providers** and open a provider's key field:

![Settings > Connections with API Key Providers expanded and a provider's Auth key field open with a made-up key](/screenshots/settings-api-key-providers.png)

Settings can list models your account cannot use. The model selector shows only the models you turned on that Pi, the agent engine inside OpenWaggle, reports as available. Turning a model on does not buy access or change what your provider lets you use.

For models that can reason before answering, the thinking-level menu sits beside the model selector. See [Thinking levels](/docs/configuration/thinking-levels).

## Choose how to sign in

An API key is a secret your provider issues for apps to use its service. A chat subscription does not always include API access or API credits. See [API key authentication](/docs/providers/api-key-auth) to save, test and clear a key.

Browser sign-in (OAuth) lets you log in on the provider's website instead of pasting a key. Whether a subscription works this way depends on the provider and your plan. See [Browser sign-in](/docs/providers/oauth-auth) to connect and disconnect.

For a private endpoint, a local model server or a gateway that is not in the list, see [Custom providers](/docs/providers/custom-providers).

## Tell models apart

A model's full name includes its provider:

```text
provider/modelId
```

The same model can appear under several providers. Pick the one you connected. Each route can have its own credentials, prices, limits and model access.

## If a model is missing or fails

If a model is not in the model selector, check that it is turned on under **Available Models** and that its provider has working credentials in the project you have open. If a connected model fails, read the error before you change settings. A bad key, a missing plan, billing, rate limits and network trouble each need a different fix.

Your conversation history stays on your computer, but requests to a hosted model leave it. They can include your messages, file contents and tool output. See [Security and privacy](/docs/configuration/security-privacy).

OpenWaggle takes its provider and model list from Pi, so the providers on offer can change with an app update or your own configuration. For provider-specific setup, see Pi's documentation:

- [Pi providers](https://pi.dev/docs/latest/providers)
- [Pi custom models](https://pi.dev/docs/latest/models)
- [Pi custom providers](https://pi.dev/docs/latest/custom-provider)

The [Settings reference](/docs/reference/settings#connections) lists every setting on the **Connections** page.
