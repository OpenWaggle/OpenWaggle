---
title: "API Key Auth"
description: "How OpenWaggle exposes Pi-supported API-key provider authentication."
order: 2
section: "Providers"
---

OpenWaggle shows API-key provider rows for providers that Pi can run through API keys, environment variables, or custom provider configuration.

OpenWaggle reads provider names and API-key capabilities from Pi `ModelRuntime`. It does not maintain a parallel list of provider ids. Newly installed Pi providers therefore appear without an OpenWaggle code change when they expose models and API-key metadata.

## API-Key Provider Families

The API-key rows are an OpenWaggle Settings view over Pi-supported provider authentication.

Pi's current provider key mapping is documented in [Pi providers](https://pi.dev/docs/latest/providers#api-keys).

## Saving A Key

1. Open **Settings > Connections**.
2. Expand **API key providers**.
3. Edit the provider row.
4. Paste the key and save.

OpenWaggle writes the key through Pi `ModelRuntime`. By default, Pi stores credentials under `~/.pi/agent/auth.json`. Runtime model construction still happens inside the Pi adapter boundary.

Pi documents auth-file storage, environment variables, shell-command key resolution, and credential precedence in [Providers > API Keys](https://pi.dev/docs/latest/providers#api-keys).

## Environment And Custom Providers

Some providers can become available without a key being saved in OpenWaggle. Pi may resolve them from environment variables or project/custom provider configuration. OpenWaggle marks these as configured when Pi reports available models for that provider.

## Testing Keys

The key test path runs a minimal Pi-backed provider probe for the selected project path, so project-scoped custom provider configuration is visible to the same runtime service construction used by normal agent runs.
