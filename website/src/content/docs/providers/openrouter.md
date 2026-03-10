---
title: "OpenRouter"
description: "Using OpenRouter to access 300+ models from multiple providers through a single API key."
order: 6
section: "Providers"
---

Disabled by default. OpenRouter is an aggregator that provides access to 300+ models from many providers through a single API key. The model picker shows a curated list of popular models, but any valid OpenRouter model ID works at runtime.

## Authentication

- **API key** — Get yours at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
- **OAuth** — Uses OpenRouter OAuth (returns a permanent API key). Connect via **Settings > Connections**.

## Attachment Support

| Type | Support |
|------|---------|
| Images | Text fallback |
| PDFs | Text fallback |
| Text Files | Text extraction |

Providers without native support receive extracted text instead, so attachments work everywhere — just with different fidelity.
