# OpenWaggle — One-Page Summary

## What It Is

OpenWaggle is a **desktop coding agent** that connects to multiple AI providers (Anthropic, OpenAI, Google Gemini, Grok, OpenRouter, Ollama) and enables **collaborative AI problem-solving**. Inspired by honeybee waggle dances, it lets you pair two AI models to tackle coding tasks together, trading context and challenging assumptions to reach better solutions than either would achieve alone.

## Core Concept: Waggle Mode

The flagship feature. Configure two AI agents with different models and roles, then watch them collaborate:
- **Sequential turns** — agents build on each other's work in structured rounds
- **Parallel mode** — both tackle the problem simultaneously, then synthesize
- **Consensus detection** — auto-stops when agents converge
- **Team presets** — save and reuse your favorite agent pairings
- **Conflict tracking** — warns when agents edit the same files

## Key Features

### Multi-Provider Support
Six providers out of the box with flexible authentication:
- Anthropic, OpenAI (API key or OAuth subscription)
- Google Gemini, Grok/xAI (API key)
- OpenRouter (API key)
- Ollama (local, no auth required)

### Full Coding Agent Toolkit
- **File operations** — read, write, edit, glob pattern matching, directory listing
- **Shell integration** — execute commands directly in your project
- **Skills system** — extensible behaviors via `.openwaggle/skills/`
- **Git integration** — live diff stats, branch management, commit dialog, side-by-side diffs
- **Approval workflow** — destructive operations (writes, edits, commands) require explicit user approval

### Rich Input & Interaction
- **Attachments** — drag-and-drop text files, PDFs (text extraction), images (OCR)
- **Voice input** — local Whisper transcription (audio never leaves your machine)
- **Slash commands** — type `/` to activate skills inline
- **Built-in terminal** — full PTY terminal emulation with xterm.js (toggle with `Ctrl+J`)

### Local-First & Secure
- All conversations, settings, and API keys stored locally in SQLite
- Project-specific config via `.openwaggle/config.toml`
- No data leaves your machine except API calls to your chosen providers

## Technical Stack

**Platform:** Electron + React 19 + TypeScript (strict mode)

| Layer | Technology |
|-------|-----------|
| Main Process | Effect runtime, TanStack AI adapters, SQLite persistence |
| Renderer | React 19, Zustand (state), Tailwind CSS v4 |
| Validation | Effect Schema (runtime + compile-time types) |
| Bundler | Vite + electron-vite |
| Testing | Vitest, Testing Library, Playwright E2E |

**Three-Process Architecture:**
- **Main** — Node.js agent loop, tool execution, IPC handlers
- **Preload** — Typed `contextBridge` API exposing main capabilities to renderer
- **Renderer** — React SPA with streaming chat UI and settings management

## Use Cases

- **Complex refactoring** — pair a reasoning model with a coding specialist
- **Exploratory debugging** — one agent analyzes, the other proposes fixes
- **Architecture decisions** — different models challenge each other's assumptions
- **Learning** — observe how different AI models approach the same problem
- **Single-agent workflows** — use any provider/model as a traditional coding assistant

## Quick Start

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd openwaggle
pnpm install
pnpm dev
```

1. Open Settings → Connections
2. Add API keys for your providers (or OAuth for Anthropic/OpenAI subscriptions)
3. Select your default model from the header picker
4. Start chatting or configure a Waggle team

## Current Status

**Developer Preview** — Functional for local development, active iteration on core features.

Platform builds (macOS .dmg, Windows NSIS, Linux AppImage) produce local artifacts but require signing/notarization work for public distribution.

---

**Philosophy:** In nature, honeybees don't solve problems alone — they waggle. OpenWaggle brings that collaborative intelligence to AI-assisted coding.
