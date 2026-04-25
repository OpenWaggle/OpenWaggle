# OpenWaggle — One-Page Summary

## What It Is

OpenWaggle is a **desktop coding workspace** built on Pi's agent runtime and model ecosystem. It enables **collaborative AI problem-solving** by pairing two Pi-supported provider/model references on the same task, trading context and challenging assumptions to reach better solutions than either would achieve alone.

## Core Concept: Waggle Mode

The flagship feature. Configure two AI agents with different models and roles, then watch them collaborate:
- **Sequential turns** — agents build on each other's work in structured rounds
- **Structured turns** — both agents alternate over the same Pi-backed session projection
- **Consensus detection** — auto-stops when agents converge
- **Team presets** — save and reuse your favorite agent pairings
- **Conflict tracking** — warns when agents edit the same files

## Key Features

### Pi-Derived Provider Support
Provider/model/auth metadata comes from Pi `ModelRegistry` and `AuthStorage`:
- API-key providers, environment/custom provider credentials, and cloud providers are surfaced from Pi metadata.
- OAuth providers are whatever Pi reports through its auth storage.
- Model ids are provider-qualified (`provider/modelId`) so the same hosted model through different providers remains distinct.

### Pi-Native Coding Agent Toolkit
- **Native Pi tools** — read, write, edit, search/listing, and shell activity provided by Pi
- **Tool timeline** — OpenWaggle renders Pi-emitted tool calls without a parallel runtime layer
- **Skills/resources** — Pi-native resource loading via `.pi/skills` / `.agents/skills`, plus OpenWaggle runtime support and catalog UI for `.openwaggle/skills`
- **Git integration** — live diff stats, branch management, commit dialog, side-by-side diffs

### Rich Input & Interaction
- **Attachments** — drag-and-drop text files, PDFs (text extraction), images (OCR)
- **Voice input** — local Whisper transcription (audio never leaves your machine)
- **Slash commands** — type `/` to reference cataloged skills, start Waggle, or run `/compact`
- **Built-in terminal** — full PTY terminal emulation with xterm.js (toggle with `Ctrl+J`)

### Local-First & Secure
- Sessions and settings are stored locally; Pi credentials are resolved by Pi auth storage/environment/custom provider configuration
- Project-specific config via `.openwaggle/settings.json`, with Pi runtime settings nested under `pi`
- No data leaves your machine except API calls to your chosen providers

## Technical Stack

**Platform:** Electron + React 19 + TypeScript (strict mode)

| Layer | Technology |
|-------|-----------|
| Main Process | Effect runtime, Pi SDK adapters, SQLite session projection |
| Renderer | React 19, Zustand (state), Tailwind CSS v4 |
| Validation | Effect Schema (runtime + compile-time types) |
| Bundler | Vite + electron-vite |
| Testing | Vitest, Testing Library, Playwright E2E |

**Three-Process Architecture:**
- **Main** — Node.js Pi runtime adapters, persistence, IPC handlers
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
2. Authenticate with API-key or OAuth providers shown by Pi
3. Enable the models you want in the composer
4. Pick a model in the composer and start a session or configure a Waggle team

## Current Status

**Developer Preview** — Functional for local development, active iteration on core features.

Platform builds (macOS .dmg, Windows NSIS, Linux AppImage) produce local artifacts but require signing/notarization work for public distribution.

---

**Philosophy:** In nature, honeybees don't solve problems alone — they waggle. OpenWaggle brings that collaborative intelligence to AI-assisted coding.
