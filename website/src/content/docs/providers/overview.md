---
title: "Providers and models"
description: "Connect a provider account, enable models, and choose a model for your conversation."
order: 1
section: "Customize"
---

A provider gives OpenWaggle access to AI models. You bring your own account, and the provider's charges and usage limits still apply. Connecting an account and choosing a model are separate steps.

For a first setup, connect one provider and enable one model. You can add more later.

## Settings flow

1. Click the sidebar gear icon and open **Connections**.
2. Expand **API Key Providers** to enter a key, or **OAuth Providers** to sign in through your browser. Use the method supported by your account.
3. Under **Available Models**, enable the models you want to use.
4. Return to your conversation and select an enabled model beside the message box.

The model list in Settings can include models your account cannot use. The message-box selector shows only enabled models that Pi currently reports as available. Enabling a model does not buy access or change your provider's permissions.

## API key auth

An API key is a secret issued by a provider for applications to use its service. A chat subscription does not necessarily include API access or API credits.

See [API key authentication](/docs/providers/api-key-auth) for saving, testing, and clearing a key.

## OAuth auth

OAuth lets you sign in on the provider's website rather than paste an API key into OpenWaggle. Subscription support depends on the provider and your account.

See [Browser sign-in](/docs/providers/oauth-auth) for connecting and disconnecting.

## Provider-qualified models

A model's full identifier includes its provider:

```text
provider/modelId
```

The same model may appear through several providers. Choose the provider you connected. Each route can have different credentials, prices, usage limits, and model access.

## Custom providers

Use a custom provider for a private endpoint, local model server, or gateway that is not already listed. See [Custom providers](/docs/providers/custom-providers).

## Availability

If a model is missing from the message box, check that it is enabled under **Available Models** and that its provider has usable credentials in the selected project. If a connected model fails, read the error before changing settings. Authentication, account access, billing, rate limits, and network failures need different fixes.

Your conversation history is stored locally, but requests to a hosted model leave your machine. Those requests can include messages, file contents, and tool output. See [Security and privacy](/docs/configuration/security-privacy).

OpenWaggle uses Pi, the agent engine included with the app, for its provider and model catalog. The available providers can change with app updates or custom configuration. For provider-specific setup and supported authentication methods, use these references:

- [Pi providers](https://pi.dev/docs/latest/providers)
- [Pi custom models](https://pi.dev/docs/latest/models)
- [Pi custom providers](https://pi.dev/docs/latest/custom-provider)
