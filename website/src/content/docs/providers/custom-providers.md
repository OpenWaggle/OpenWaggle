---
title: "Custom providers"
description: "Use a private endpoint, local model server, or gateway with OpenWaggle."
order: 12
section: "Customize"
---

Use a custom provider when the endpoint or model you need is not already available in **Settings > Connections**. You will need its API address, model identifier, supported API format, and any required credentials.

This is an advanced setup. If your provider is already listed, use [API key authentication](/docs/providers/api-key-auth) or [browser sign-in](/docs/providers/oauth-auth) instead.

## Configure and try a model

OpenWaggle reads custom models and providers through Pi, the agent engine included with the app.

1. Follow [Pi's custom models guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md) for a `models.json` configuration supported by your endpoint. Its default location is `~/.pi/agent/models.json`. If you set `PI_CODING_AGENT_DIR`, use that directory instead.
2. If the endpoint needs custom authentication or request handling that configuration cannot express, follow [Pi's custom provider guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md). This uses an extension and `pi.registerProvider()`.
3. Open the project where the configuration or extension applies.
4. Open **Settings > Connections**, configure credentials if needed, and enable the custom model under **Available Models**.
5. Select it beside the message box and try a small request before using it on a larger task.

Keep credentials in supported credential storage or environment variables, not checked-in examples. Only load provider extensions you trust, because they execute code.

## Example: a local OpenAI-compatible server

LM Studio, Ollama, vLLM, and SGLang can all answer OpenAI-style chat requests. This `~/.pi/agent/models.json` adds a model served by LM Studio on its default port:

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "lmstudio": {
      "name": "LM Studio",
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "lm-studio",
      "models": [
        {
          "id": "qwen2.5-coder-7b-instruct",
          "contextWindow": 32768
        }
      ]
    }
  }
}
```

- The key under `providers`, here `lmstudio`, is the provider part of the model's identity, so the model above is `lmstudio/qwen2.5-coder-7b-instruct`.
- `id` must be the model name the server expects. Ask the server for its list, for example `curl http://localhost:1234/v1/models`.
- A new provider needs `baseUrl` and `api`. `openai-completions` sends OpenAI Chat Completions requests.
- The server ignores `apiKey`, but Pi offers only models whose provider has a key. For a server that checks it, write `"$NAME"` to read an environment variable instead of the key itself.
- `contextWindow` is optional. Pi assumes 128000 tokens when you leave it out, so set it when the server's limit is smaller.

The file is Pi's format, so Pi's documentation is the reference: [Choose a model](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md) covers compatible endpoints and [Models configuration](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models-configuration.md) lists every field. The `$schema` line points your editor at Pi's published schema.

## Project scope

The default `models.json` is user-wide, not a project-local file. Providers registered by project extensions can appear only while that project is selected. Check the project before assuming a missing model was removed.

Model listing, API key tests, and agent requests load the project's provider extensions. Saving API keys and running OAuth sign-in use Pi's default model runtime rather than that project-extension runtime. If a project-only provider cannot save credentials or sign in from Connections, use its documented environment or configuration-based credentials; appearing in the catalog does not guarantee its custom login flow is available here.

## Model identity

Custom and built-in models use the same identifier format:

```text
provider/modelId
```

Give your custom provider a distinct identity and choose that entry in the model selector. A model reached directly through its vendor and the same model reached through a gateway are separate choices with separate credentials and usage limits.

## If requests fail

Check the exact endpoint, API format, model identifier, and account permissions. A server accepting ordinary chat requests is not enough for coding-agent work: it must also accept the tool definitions and return tool calls in the format Pi expects. OpenWaggle reports incompatible requests rather than silently removing tools or switching models.

A local endpoint can keep model inference on your machine, but that does not make the whole workflow offline. Tools, MCP servers, extensions, and browser pages can still contact external services. See [Security and privacy](/docs/configuration/security-privacy).
