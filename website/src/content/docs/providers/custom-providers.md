---
title: "Custom providers"
description: "Use a private endpoint, local model server, or gateway with OpenWaggle."
order: 12
section: "Customize"
kind: "guide"
---

Add a custom provider when the endpoint or model you need is not listed in **Settings > Connections**: a local model server, a private endpoint or a company gateway. You need the server's address, the model's name on that server, the API format it speaks and any credentials it wants. This is an advanced setup. If your provider is already listed, use [API key authentication](/docs/providers/api-key-auth) or [browser sign-in](/docs/providers/oauth-auth) instead.

## Add a model and try it

OpenWaggle reads custom models and providers through Pi, the agent engine inside the app.

1. Write a `models.json` for your endpoint, following [Pi's custom models guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md). Pi reads it from `~/.pi/agent/models.json`, or from the folder in [`PI_CODING_AGENT_DIR`](/docs/reference/environment-variables#pi) when you set that variable. See [Pi's agent folder](/docs/reference/data-locations#pi-agent-folder).
2. If the endpoint needs login or request handling that the file cannot describe, write a Pi extension that calls `pi.registerProvider()`. [Pi's custom provider guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md) shows how.
3. Open the project where the file or extension applies.
4. Open **Settings > Connections**, add credentials if the provider needs them, and turn on the model under **Available Models**.
5. Pick the model beside the message box and send a small request before you give it a big task.

Keep credentials in Pi's credential file or in environment variables, never in examples you commit. Load only provider extensions you trust, because an extension runs code on your computer.

## Example: a local OpenAI-compatible server

LM Studio, Ollama, vLLM and SGLang all answer OpenAI-style chat requests. This `~/.pi/agent/models.json` adds a model served by LM Studio on its default port:

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

The file uses Pi's format, so Pi's docs describe it: [Choose a model](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md) covers compatible endpoints, and [Models configuration](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models-configuration.md) lists every field. The `$schema` line lets your editor check the file against Pi's schema.

## Models that only one project has

`models.json` applies to every project. A provider that a project's own extension adds is different. Its models show up only while that project is open. If a model seems to have vanished, check which project you have open first.

Listing models, testing API keys and running the agent all load the project's provider extensions. Saving an API key and browser sign-in do not. They use Pi's default setup, without project extensions. So if a project-only provider cannot save a key or sign in from **Connections**, give it credentials the way its own docs describe, through an environment variable or its configuration. A provider can appear in the model list even when its custom login is not available here.

## Name your provider

Custom and built-in models use the same name format:

```text
provider/modelId
```

Give your custom provider its own name and pick that entry in the model selector. A model you reach directly from its vendor and the same model reached through a gateway are two separate choices, each with its own credentials and usage limits.

## If requests fail

Check the address, the API format, the model name and the account's permissions. A server that handles plain chat is not enough for coding work. It must also accept tool definitions and send back tool calls in the format Pi expects. When a server rejects them, OpenWaggle shows the error. It does not quietly drop the tools or switch to another model.

A local server keeps the model's work on your computer, but the rest of a session can still go online. Tools, MCP servers, extensions and browser pages can all contact outside services. See [Security and privacy](/docs/configuration/security-privacy).
