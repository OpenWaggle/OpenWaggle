# Getting Started

## Prerequisites

- **Node.js** 20 or later — [nodejs.org](https://nodejs.org/)
- **pnpm** 9 or later — [pnpm.io](https://pnpm.io/)
- **macOS**, **Windows**, or **Linux**

## Installation

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd openwaggle
pnpm install
```

## Running the App

Start OpenWaggle in development mode:

```bash
pnpm dev
```

This launches the Electron app with hot-reload for the renderer (UI). Changes to the main process (backend) require a full app restart.

To create a production build:

```bash
pnpm build
```

Platform-specific installers:

```bash
pnpm build:mac    # macOS .dmg (x64 + arm64)
pnpm build:win    # Windows NSIS installer (x64)
pnpm build:linux  # Linux AppImage (x64)
```

## First Run

When you launch OpenWaggle for the first time, you'll see the main workspace with an empty chat. To start using the agent:

1. **Set up a provider** — Click the gear icon in the sidebar (or press `Cmd+,` / `Ctrl+,`) to open Settings. Go to **Connections** and add an API key for at least one provider. See [Providers & Models](./providers.md) for detailed setup instructions.

2. **Select a project** — Click "Select a project folder to get started" in the welcome screen, or use the folder button in the sidebar. This gives the agent access to your codebase.

3. **Pick a model** — Use the model selector in the composer toolbar to choose which AI model to use. The default is Claude Sonnet 4.5 (Anthropic).

4. **Send a message** — Type in the composer and press Enter. The agent will respond and can use tools to read, write, and modify files in your project.

## Interface Overview

The workspace is divided into several areas:

```
+--------------------------------------------------+
|  Sidebar  |           Header                      |
|           +---------------------------------------+
|  - Threads|                                       |
|  - MCPs   |           Chat Area                   |
|  - Skills |                                       |
|  - Settings|          (messages + agent output)   |
|           |                                       |
|           +---------------------------------------+
|           |           Composer                    |
|           +---------------------------------------+
|           |           Terminal (toggle)            |
+--------------------------------------------------+
```

- **Sidebar** (left) — Thread list, navigation to MCPs/Skills/Settings, project management.
- **Header** (top) — Thread title, terminal toggle, commit button, git diff stats.
- **Chat area** (center) — Conversation messages, tool call output, approvals, and errors.
- **Composer** (bottom) — Text input, model selector, quality preset, attachments, voice input.
- **Terminal** (bottom, toggleable) — Built-in terminal emulator for running commands directly.
- **Diff panel** (right, toggleable) — Side-by-side view of git changes in your project.

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Send message | `Enter` | `Enter` |
| New line | `Shift+Enter` | `Shift+Enter` |
| Toggle terminal | `Cmd+J` | `Ctrl+J` |
| Toggle diff panel | `Cmd+D` | `Ctrl+D` |
| Open settings | `Cmd+,` | `Ctrl+,` |
| Command palette | `Cmd+K` | `Ctrl+K` |
| New thread | Sidebar button | Sidebar button |

## Next Steps

- [Set up AI providers](./providers.md) to connect to different models.
- Learn about [chat and agent tools](./chat-and-tools.md).
- Explore [Waggle Mode](./waggle-mode.md) for multi-agent collaboration.
