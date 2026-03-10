---
title: "OpenAI"
description: "Using OpenAI's GPT and reasoning models in OpenWaggle — setup, reasoning effort, and ChatGPT subscriptions."
order: 3
section: "Providers"
---

OpenAI is enabled by default. The default model is **GPT-4.1 Mini**.

## Authentication

- **API key** — Get yours at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **OAuth** — Uses OpenAI OAuth with local callback server. Connect via **Settings > Connections**.

## Reasoning Models

Some OpenAI models use reasoning effort levels instead of temperature/topP controls. The [quality preset](/docs/configuration/quality-presets) maps to reasoning effort automatically when applicable.

## ChatGPT Subscription

When using OAuth authentication, OpenAI traffic routes through the ChatGPT Codex backend, which has slightly different capabilities than the direct API.

## Attachment Support

| Type | Support |
|------|---------|
| Images | Native |
| PDFs | Native |
| Text Files | Text extraction |
