---
title: "API Key Auth"
description: "How OpenWaggle exposes Pi-supported API-key provider authentication."
order: 2
section: "Providers"
---

OpenWaggle shows API-key provider rows for providers that Pi can run through API keys, environment variables, or custom provider configuration.

Pi currently exposes OAuth provider metadata directly, but it does not expose an equivalent API-key provider list. OpenWaggle keeps a small adapter-local mirror of Pi's API-key-capable provider ids so Settings can present a complete UI while the runtime still resolves credentials through Pi.

## API-Key Provider Families

The API-key rows are an OpenWaggle Settings view over Pi-supported provider authentication. If Pi exposes first-class API-key provider metadata later, OpenWaggle should consume that instead of maintaining adapter-local metadata.

Pi's current provider key mapping is documented in [Pi providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#api-keys), including the linked `env-api-keys.ts` source reference.

## Saving A Key

1. Open **Settings > Connections**.
2. Expand **API key providers**.
3. Edit the provider row.
4. Paste the key and save.

OpenWaggle writes the key through Pi `AuthStorage`. By default, Pi stores credentials under `~/.pi/agent/auth.json`. Runtime model construction still happens inside the Pi adapter boundary.

Pi documents auth-file storage, environment variables, shell-command key resolution, and credential precedence in [Providers > API Keys](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#api-keys).

## Environment And Custom Providers

Some providers can become available without a key being saved in OpenWaggle. Pi may resolve them from environment variables or project/custom provider configuration. OpenWaggle marks these as configured when Pi reports available models for that provider.

## Testing Keys

The key test path runs a minimal Pi-backed provider probe for the selected project path, so project-scoped custom provider configuration is visible to the same runtime service construction used by normal agent runs.
