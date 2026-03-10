---
title: "Ollama (Local Models)"
description: "Running AI models locally with Ollama — no API key or internet connection required."
order: 7
section: "Providers"
---

Disabled by default. Ollama runs models locally on your machine — no API key or internet connection required.

## Setup

1. [Install Ollama](https://ollama.ai/) on your machine.
2. Pull a model: `ollama pull llama3.2` (or any model you prefer).
3. In OpenWaggle **Settings > Connections**, enable Ollama.
4. The default base URL is `http://localhost:11434`. Change it if your Ollama instance runs elsewhere.

## Dynamic Model Discovery

OpenWaggle automatically detects all models installed in your Ollama instance. The model list refreshes when you open the model picker.

## Custom Base URL

Point OpenWaggle to a remote Ollama instance by changing the base URL in settings (e.g., `http://192.168.1.100:11434`).

## Attachment Support

| Type | Support |
|------|---------|
| Images | Text fallback |
| PDFs | Text fallback |
| Text Files | Text extraction |

Providers without native support receive extracted text instead, so attachments work everywhere — just with different fidelity.
