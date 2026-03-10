---
title: "Anthropic"
description: "Using Anthropic's Claude models in OpenWaggle — setup, extended thinking, and configuration."
order: 2
section: "Providers"
---

Anthropic is enabled by default. The default model is **Claude Sonnet 4.5**.

## Authentication

- **API key** — Get yours at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys)
- **OAuth** — Uses Claude.ai OAuth (scopes: API key creation, profile, inference). Connect via **Settings > Connections**.

## Extended Thinking

Claude models support extended thinking, where the model reasons through complex problems before responding. Thinking budget scales with the [quality preset](/docs/configuration/quality-presets):

- **Opus models**: 2,048 to 16,384 tokens
- **Other models**: 1,024 to 10,240 tokens

## Attachment Support

| Type | Support |
|------|---------|
| Images | Native |
| PDFs | Native |
| Text Files | Text extraction |
