---
title: "Providers Overview"
description: "How OpenWaggle surfaces Pi providers, models, API keys, and OAuth authentication."
order: 1
section: "Providers"
---

OpenWaggle does not maintain a fixed provider catalog. Provider and model metadata comes from Pi.

OpenWaggle focuses on the Settings and composer workflow. Pi owns the provider/model catalog, credential resolution, and runtime routing details.

Primary Pi references:

- [Pi providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md)
- [Pi custom models](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- [Pi custom providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)

## Provider-Qualified Models

Models are identified as:

```text
provider/modelId
```

This is intentional. The same underlying model can be hosted by multiple providers, and those are distinct runtime choices with different credentials, routing, pricing, and entitlements.

## Settings Flow

1. Open **Settings > Connections**.
2. Authenticate providers through the relevant method group:
   - **API key providers**
   - **OAuth providers**
3. Enable the models you want to show in the composer.
4. Select one of the enabled provider-qualified models from the composer dropdown.

All available Pi models are visible in Settings. The composer only shows models you pre-select, which keeps the normal chat UI quiet.

## API Key Auth

API-key providers are shown separately from OAuth providers. OpenWaggle saves keys through Pi auth storage and lets Pi resolve credentials during runtime model construction.

See [API Key Auth](/docs/providers/api-key-auth).

## OAuth Auth

OAuth providers come directly from Pi `AuthStorage.getOAuthProviders()`. OpenWaggle starts the same browser-based login flow through a nicer settings UI.

See [OAuth Auth](/docs/providers/oauth-auth).

## Custom Providers

Project-scoped Pi provider configuration can add provider/model entries that are not part of the built-in registry.

See [Custom Providers](/docs/providers/custom-providers).

## Availability

The Settings page distinguishes between models Pi knows about and models Pi reports as available with your current credentials. If a provider is authenticated but a specific model still fails, the upstream account may lack entitlement or the provider may reject that model.
