# AI Providers & Models

OpenWaggle supports 6 AI providers out of the box. You can use multiple providers simultaneously — each conversation message uses whichever model is selected in the composer toolbar.

## Supported Providers

| Provider | Models | Auth Methods | Local | Dynamic Models |
|----------|--------|-------------|-------|---------------|
| Anthropic | Claude Sonnet 4.5, Claude Opus 4, Claude Haiku 4.5 | API key, OAuth | No | No |
| OpenAI | GPT-4.1 series, GPT-5, GPT-5.1 Codex | API key, OAuth | No | No |
| Google Gemini | Gemini 2.0 Flash Lite, Gemini 2.5 Pro | API key | No | No |
| Grok (xAI) | Grok 3 Mini Fast, Grok 3 | API key | No | No |
| OpenRouter | 300+ models from multiple providers | API key, OAuth | No | No |
| Ollama | Any locally installed model | None required | Yes | Yes |

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

## Provider Details

### Anthropic

Anthropic is enabled by default. The default model is **Claude Sonnet 4.5**.

**Extended thinking**: Claude models support extended thinking, where the model reasons through complex problems before responding. Thinking budget scales with the quality preset:
- Opus models: 1,024 to 16,384 tokens
- Other models: 1,024 to 10,240 tokens

### OpenAI

OpenAI is enabled by default. The default model is **GPT-4.1 Mini**.

**Reasoning models**: GPT-5 and o-series models use a different reasoning approach. Instead of temperature/topP controls, they use effort levels. The quality preset maps to reasoning effort automatically.

**ChatGPT subscription**: When using OAuth authentication, OpenAI traffic routes through the ChatGPT Codex backend, which has slightly different capabilities than the direct API.

### Google Gemini

Disabled by default. Enable it in Settings > Connections after adding your API key.

### Grok (xAI)

Disabled by default. Enable it in Settings > Connections after adding your API key.

### OpenRouter

Disabled by default. OpenRouter is an aggregator that provides access to 300+ models from many providers through a single API key. The model picker shows a curated list of popular models, but any valid OpenRouter model ID works at runtime.

### Ollama (Local Models)

Disabled by default. Ollama runs models locally on your machine — no API key or internet connection required.

**Setup:**

1. [Install Ollama](https://ollama.ai/) on your machine.
2. Pull a model: `ollama pull llama3.2` (or any model you prefer).
3. In OpenWaggle Settings > Connections, enable Ollama.
4. The default base URL is `http://localhost:11434`. Change it if your Ollama instance runs elsewhere.

**Dynamic model discovery**: OpenWaggle automatically detects all models installed in your Ollama instance. The model list refreshes when you open the model picker.

**Custom base URL**: Point OpenWaggle to a remote Ollama instance by changing the base URL in settings (e.g., `http://192.168.1.100:11434`).

## Selecting a Model

The model picker is available in the composer toolbar. Click it to open a panel with:

- **Provider tabs** (left rail) — Filter by provider using logo icons.
- **Favorites tab** — Quick access to starred models.
- **Search** — Type to filter models by name.
- **Star toggle** — Click the star on any model to add it to favorites.

When you select a model from a disabled provider that has valid credentials, OpenWaggle automatically enables that provider.

Models that require a missing API key appear disabled with a note explaining why.

## Attachment Support by Provider

Different providers support different types of native attachments:

| Provider | Images | PDFs | Text Files |
|----------|--------|------|------------|
| Anthropic | Native | Native | Text extraction |
| OpenAI | Native | Native | Text extraction |
| Gemini | Native | Native | Text extraction |
| Grok | Text fallback | Text fallback | Text extraction |
| OpenRouter | Text fallback | Text fallback | Text extraction |
| Ollama | Text fallback | Text fallback | Text extraction |

Providers without native support receive extracted text instead, so attachments work everywhere — just with different fidelity.
