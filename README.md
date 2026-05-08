<p align="center">
  <img src="build/branding/openwaggle-logo-lockup.svg" width="528" alt="OpenWaggle" />
</p>

<p align="center">
  <strong>A desktop coding agent that pairs AI models to solve problems together.</strong>
  <br />
  <a href="https://openwaggle.ai">Website</a> &middot; <a href="https://openwaggle.ai/docs/getting-started/installation">Docs</a> &middot; <a href="https://github.com/OpenWaggle/OpenWaggle/releases/latest">Download</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-vite-purple" alt="Electron Vite" />
  <img src="https://img.shields.io/badge/react-19-61dafb" alt="React 19" />
  <img src="https://img.shields.io/badge/typescript-strict-blue" alt="TypeScript" />
</p>

---

## What is OpenWaggle?

In nature, honeybees don't solve problems alone — they waggle.

When a forager bee discovers nectar, it doesn't keep the knowledge to itself. It returns to the hive and performs a **waggle dance**: a figure-eight that encodes direction, distance, and quality. Other bees read the dance, verify the source, and the colony converges on the best path forward. No single bee has the full picture, but through structured communication the hive finds the optimal outcome every time.

OpenWaggle works the same way. It's a desktop coding workspace built on Pi's agent runtime and model ecosystem. Pair two Pi-supported models on the same problem, give them roles, and watch them waggle: trading context, challenging each other's assumptions, and converging on solutions no single model would reach alone.

- **Pi-native model catalog** — Use the providers, authentication methods, and model metadata reported by the installed Pi SDK
- **Waggle Mode** — Pair two AI agents with different strengths and let them collaborate in structured turns
- **Full coding agent** — File operations, shell commands, and git integration built in
- **Local-first** — Your sessions, settings, and provider credentials stay on your machine

## Features

### Multi-Model Support

OpenWaggle reads provider and model metadata from Pi. Use OpenWaggle's Settings UI to choose the Pi-reported providers and models you want available in the composer. For provider and model mechanics, use Pi's provider and model docs as the source of truth.

Settings separates provider authentication by method:

- **API key providers** — all Pi providers that support key-based, environment, or custom-provider credentials
- **OAuth providers** — the OAuth providers Pi reports through its auth storage
- **Available models** — the full Pi model catalog, with user-selected models controlling what appears in the composer dropdown

### Waggle Mode

The flagship feature. Pair two AI agents, configure their roles, and let them collaborate:

- **Sequential turns** — agents take turns, each building on the other's work
- **Structured turns** — agents alternate over the same Pi-backed session projection
- **Consensus detection** — automatically stops when agents converge on a solution
- **Manual stop** — take back control at any time
- **Waggle presets** — save your favorite agent pairings (3 built-in, unlimited custom)
- **Conflict tracking** — warns when agents edit the same files

Open Settings > Waggle Mode to configure Waggle presets and agent roles, or use the command palette (`Ctrl+K` / `Cmd+K`) and search for "waggle" to start a session.

### Pi-Native Agent Runtime

OpenWaggle is now a UI and product shell over Pi's coding-agent runtime:

- **Native Pi tools** — file reads, writes, edits, shell commands, and search/listing tools are provided by Pi
- **Session tree projection** — Pi sessions, nodes, and branches are projected into OpenWaggle's SQLite read model
- **Session Tree panel** — inspect and navigate Pi session branches through a right-side tree view
- **Skills/resources** — project resources load with `.openwaggle > .pi > .agents` precedence for skills, extensions, prompts, and themes
- **Live tool timeline** — OpenWaggle renders the tool events Pi emits as part of the session stream

### Git Integration

- **Live diff stats** — see changed files and line counts in real time
- **Git branch management** — switch, create, and manage repository branches from the branch row below the composer
- **Commit dialog** — stage files, write messages, and commit without leaving the app
- **Diff panel** — inline view of all working tree changes

### Rich Input

- **Attachments** — drag and drop text files, PDFs, and images (with OCR extraction)
- **Voice input** — local Whisper transcription (no audio leaves your machine)
- **Slash commands** — type `/` to reference cataloged skills, start Waggle flows, or run `/compact`

### Built-in Terminal

Full PTY terminal emulation powered by xterm.js. Toggle with `Ctrl+J` / `Cmd+J`.

## Install

### macOS

```bash
# One-liner
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh | bash
```

Or download the `.dmg` from the [latest release](https://github.com/OpenWaggle/OpenWaggle/releases/latest). Since the app is unsigned, right-click → **Open** on first launch to bypass Gatekeeper.

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh | bash
```

Or download the `.AppImage` from [releases](https://github.com/OpenWaggle/OpenWaggle/releases/latest), `chmod +x`, and run.

### Windows

Download the `.exe` installer from the [latest release](https://github.com/OpenWaggle/OpenWaggle/releases/latest) and run it. Windows SmartScreen may warn about an unsigned app — click **More info** → **Run anyway**.

### From Source

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd OpenWaggle
pnpm install
pnpm dev
```

Requires [Node.js](https://nodejs.org/) 24.x and [pnpm](https://pnpm.io/) 10+.

## Quick Start

### Configure providers

1. Open **Settings** (gear icon in the sidebar)
2. Go to **Connections**
3. Expand **API Key Providers** or **OAuth Providers** and authenticate through the method Pi supports
4. Select which models should appear in the composer from **Available Models**
5. Pick a model from the composer toolbar

## Configuring Providers

OpenWaggle does not hardcode a fixed provider catalog. It displays whatever Pi's project-scoped model registry reports, including built-in providers and extension/custom-provider additions.

Pi credentials are stored in Pi's auth storage (`~/.pi/agent/auth.json`) or resolved from environment/custom provider configuration according to Pi's own resolution rules. OpenWaggle app preferences and session projections are stored in SQLite in your OS app data directory.

Pi references for this behavior:

- [Pi providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md)
- [Pi custom models](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md)
- [Pi custom providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)

## Using OpenWaggle

### Chat

Start a session, send a message, and the agent responds with Pi's native coding-agent tool access to your project. Use the model selector in the composer to choose from the models you enabled in Settings.

### Session Tree & Branches

Open the Session Tree from the header tree icon or command palette to inspect Pi session nodes and branches. Session branches are Pi runtime branches inside a Pi session; they are separate from repository Git branches.

### Waggle Mode

1. **Configure a team** — Go to Settings > Waggle Mode, or create one on the fly
2. **Pick two models** — Assign each agent a model, role description, and color
3. **Set collaboration rules** — sequential turns, consensus/manual stop behavior, and max turns
4. **Save as preset** — Reuse your favorite configurations
5. **Start a session** — Open the command palette (`Ctrl+K`) and search "waggle", or select a preset directly

When Waggle Mode is active, the collaboration status bar appears above the composer showing turn progress, active agent, and file conflict warnings.

### Tools

The agent can read files, write code, and run shell commands through Pi's native coding-agent tools. OpenWaggle displays those tool calls directly in the transcript.

Pi documents the default built-in tool set and SDK integration points in the [Pi coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md) and [Pi SDK guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md).

### Attachments

Drag and drop files onto the composer, or use the attachment button:

- **Text files** — content extracted directly
- **PDF** — text extracted with page metadata
- **Images** — OCR extraction for text content; image-capable Pi models also receive image payloads

### Skills

Pi-native skills extend the agent's prompt context with specialized knowledge and workflows. Current project resource discovery uses `.openwaggle > .pi > .agents` precedence. OpenWaggle exposes catalog UI for `.openwaggle/skills` and root `.agents/skills`, while Pi-native discovery still governs Pi-owned/global resources.

- **Discover** — open the Skills panel from the sidebar
- **Enable/disable** — toggle skills per project
- **Slash reference** — type `/skill-name` in the composer to reference a cataloged skill
- **Create custom** — use `.openwaggle/skills/<skill-id>/SKILL.md`, `.pi/skills/<skill-id>/SKILL.md`, or `.agents/skills/<skill-id>/SKILL.md`

For runtime extensions beyond instruction skills, use Pi's extension system; see [Pi extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md).

### Git Workflow

- **Git branch picker** — click the branch name in the row below the composer to switch or create repository branches
- **Diff panel** — toggle with `Ctrl+D` to see all working tree changes
- **Commit dialog** — select files, write a message, commit — all from the header

## Project Configuration

OpenWaggle supports per-project configuration via `.openwaggle/settings.json`. OpenWaggle-owned settings live at the top level, while Pi runtime settings are nested under `pi`:

```json
{
  "preferences": {
    "model": "openai-codex/gpt-5.5",
    "thinkingLevel": "medium"
  },
  "pi": {
    "treeFilterMode": "default",
    "branchSummary": {
      "skipPrompt": false
    },
    "compaction": {
      "enabled": true
    }
  }
}
```

The Pi adapter passes the nested `pi` object to Pi's settings manager. Pi's project-local `.pi/settings.json` can also be read by the Pi settings loader, but `.openwaggle/settings.json` is the primary OpenWaggle-facing file. Project resources use `.openwaggle > .pi > .agents` precedence. See [Per-Project Configuration](https://openwaggle.ai/docs/configuration/per-project-config) for the current reference.

## Development

### Project Structure

OpenWaggle is an Electron app with three process targets sharing types through `src/shared/`:

```
src/
  main/           # Node.js — Pi runtime adapters, persistence, IPC handlers
  preload/        # Bridge — typed contextBridge API
  renderer/src/   # React 19 + Zustand + Tailwind v4
  shared/         # Types, schemas, utilities shared across all targets
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron + electron-vite |
| Renderer | React 19, Zustand, Tailwind CSS v4 |
| AI Integration | Pi SDK runtime behind OpenWaggle ports/adapters |
| Language | TypeScript (strict, no `any`) |
| Validation | Effect Schema |
| Main Runtime | Effect |
| Persistence | SQLite + `.openwaggle/settings.json` project config |
| Bundler | Vite 8 (Rolldown) |
| Linter | Biome |
| Testing | Vitest + Testing Library + Playwright |

### Scripts

```bash
pnpm dev              # Start in dev mode (hot-reloads renderer)
pnpm build            # Production build
pnpm prepare:native:node      # Rebuild native modules for Node-based tests
pnpm prepare:native:electron  # Rebuild native modules for Electron runs
pnpm typecheck        # Full type check (main + renderer)
pnpm lint             # Biome lint check
pnpm lint:fix         # Lint + auto-fix
pnpm format           # Biome format
pnpm check            # typecheck + lint combined
pnpm test             # All tests (unit + integration + component)
pnpm test:all         # All tests including headless E2E
pnpm test:unit        # Unit tests only
pnpm test:integration # Integration tests only
pnpm test:component   # Component tests only
pnpm test:e2e         # Playwright E2E (headless, requires build)
pnpm prepush:main     # Pre-push quality gate for main
```

### Platform Builds

```bash
pnpm build:mac        # macOS .dmg for this Mac's native architecture
pnpm build:mac:all    # macOS .dmgs for arm64 + x64
pnpm build:win        # Windows NSIS installer
pnpm build:linux      # Linux AppImage
```

On Apple silicon, use the arm64 DMG or `dist/mac-arm64/OpenWaggle.app`. The x64 app under
`dist/mac/` runs through Rosetta and is not representative of OpenWaggle performance.

See [docs/release-and-versioning.md](docs/release-and-versioning.md) for CI/CD, versioning, and git hooks details.

See [docs/architecture.md](docs/architecture.md) for the full architecture overview, process boundaries, IPC type system, and Pi runtime internals.

---

<p align="center">
  <em>In nature, honeybees don't solve problems alone — they waggle. Now your AI agents can too.</em>
</p>
