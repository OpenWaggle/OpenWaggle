---
title: "Providers Overview"
description: "Overview of the 6 supported AI providers, how to set up API keys, and OAuth authentication."
order: 1
section: "Providers"
---

OpenWaggle supports 6 AI providers out of the box. You can use multiple providers simultaneously — each conversation message uses whichever model is selected in the composer toolbar.

## Supported Providers

| Provider | Models | Auth Methods | Local | Dynamic Models |
|----------|--------|-------------|-------|---------------|
| [Anthropic](/docs/providers/anthropic) | Claude Sonnet 4.5, Claude Opus 4, Claude Haiku 4.5 | API key, OAuth | No | No |
| [OpenAI](/docs/providers/openai) | GPT-4.1 series, GPT-5, GPT-5.1 Codex | API key, OAuth | No | No |
| [Google Gemini](/docs/providers/google-gemini) | Gemini 2.0 Flash Lite, Gemini 2.5 Pro | API key | No | No |
| [Grok (xAI)](/docs/providers/grok) | Grok 3 Mini Fast, Grok 3 | API key | No | No |
| [OpenRouter](/docs/providers/openrouter) | 300+ models from multiple providers | API key, OAuth | No | No |
| [Ollama](/docs/providers/ollama) | Any locally installed model | None required | Yes | Yes |

## Setting Up API Keys

1. Open **Settings** via the gear icon in the sidebar or `Cmd+,` / `Ctrl+,`.
2. Navigate to **Connections**.
3. Click **Add API key** next to the provider you want to configure.
4. Paste your API key and click **Save**.

API keys are encrypted using your operating system's secure keychain (macOS Keychain, Windows Credential Store, or Linux Secret Service) and never leave your machine.

### Where to Get API Keys

| Provider | Get your key at |
|----------|----------------|
| Anthropic | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Google Gemini | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| Grok (xAI) | [console.x.ai/team/default/api-keys](https://console.x.ai/team/default/api-keys) |
| OpenRouter | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Ollama | No key needed (runs locally) |

## OAuth Subscriptions

Three providers support OAuth authentication as an alternative to API keys. This lets you use your existing subscription (e.g., Claude Pro, ChatGPT Plus) without a separate API key.

### Supported OAuth Providers

- **Anthropic** — Uses Claude.ai OAuth (scopes: API key creation, profile, inference)
- **OpenAI** — Uses OpenAI OAuth with local callback server
- **OpenRouter** — Uses OpenRouter OAuth (returns a permanent API key)

### How to Connect via OAuth

1. Go to **Settings > Connections**.
2. Find the provider's subscription row.
3. Click **Subscribe** or **Connect**.
4. A browser window opens for authentication.
5. After authorizing, you're redirected back to OpenWaggle.

If the automatic redirect fails, you can manually paste the authorization code.

### Token Management

- OAuth tokens are stored securely in the system keychain.
- Tokens refresh automatically before expiry.
- Disconnecting restores your previous API key (if one existed).
- OpenRouter subscriptions provide a permanent API key rather than expiring tokens.

## Selecting a Model

The model picker is available in the composer toolbar. Click it to open a panel with:

- **Provider tabs** (left rail) — Filter by provider using logo icons.
- **Favorites tab** — Quick access to starred models.
- **Search** — Type to filter models by name.
- **Star toggle** — Click the star on any model to add it to favorites.

When you select a model from a disabled provider that has valid credentials, OpenWaggle automatically enables that provider.

Models that require a missing API key appear disabled with a note explaining why.
