---
title: "OpenAI"
description: "Using OpenAI's GPT and reasoning models in OpenWaggle — setup, reasoning effort, and ChatGPT subscriptions."
order: 3
section: "Providers"
---

OpenAI is enabled by default. The default model is **GPT-4.1 Mini**.

## Available Models

- GPT-4.1 series
- GPT-5
- GPT-5.1 Codex

## Authentication

- **API key** — Get yours at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **OAuth** — Uses OpenAI OAuth with local callback server. Connect via **Settings > Connections**.

## Reasoning Models

GPT-5 and o-series models use a different reasoning approach. Instead of temperature/topP controls, they use effort levels. The [quality preset](/docs/configuration/quality-presets) maps to reasoning effort automatically.

## ChatGPT Subscription

When using OAuth authentication, OpenAI traffic routes through the ChatGPT Codex backend, which has slightly different capabilities than the direct API.

## Attachment Support

| Type | Support |
|------|---------|
| Images | Native |
| PDFs | Native |
| Text Files | Text extraction |
