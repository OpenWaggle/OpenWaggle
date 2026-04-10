---
title: "Architecture"
description: "A high-level overview of how OpenWaggle is built — Electron, React, and the AI agent system."
order: 1
section: "Developer Guide"
---

OpenWaggle is an Electron desktop app built with TypeScript. It uses a standard Electron architecture with strict process isolation between the backend and the UI.

## High-Level Overview

```
┌─────────────────────────────────────┐
│           Electron App              │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │  Backend  │◄──►│   React UI    │  │
│  │  (Node)   │    │  (Renderer)   │  │
│  └──────────┘    └───────────────┘  │
│       │                             │
│  ┌──────────┐                       │
│  │  SQLite   │                      │
│  │  Storage  │                      │
│  └──────────┘                       │
└─────────────────────────────────────┘
```

- **Backend** — The Node.js process runs the AI agent loop, executes tools, manages provider connections, handles persistence, and coordinates MCP servers.
- **UI** — A React 19 single-page application styled with Tailwind CSS v4. Includes the chat interface, settings, file diffs, and a built-in terminal.
- **Bridge** — A typed API layer ensures the UI can only communicate with the backend through well-defined channels. No direct Node.js access from the UI.

## AI Agent System

When you send a message, the backend:

1. Routes your request to the selected AI provider (Anthropic, OpenAI, etc.).
2. Streams the model's response back to the UI in real time.
3. Executes any tool calls the model makes (file reads, writes, shell commands, etc.).
4. Returns tool results to the model so it can continue its response.

The agent supports multiple providers through a registry system — each provider implements a standard interface, so switching models is seamless.

## Multi-Agent Collaboration (Waggle Mode)

In Waggle Mode, two agents take alternating turns on the same task. The orchestration engine manages turn-taking, tracks which files each agent modifies, detects consensus, and produces a synthesis when the agents converge.

## Tool System

Tools are the agent's interface to your project. Each tool has a defined input contract, and tools that modify files or run commands require your approval before executing. Tools default to the project directory but can access files anywhere on the machine using absolute paths.

## Extensibility

- **Skills** — Project-local markdown instructions that teach the agent specialized workflows.
- **MCP Servers** — External tool servers connected via the Model Context Protocol, extending the agent's capabilities with browser automation, database access, and more.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron |
| UI | React 19, Tailwind CSS v4 |
| AI Integration | TanStack AI |
| Language | TypeScript |
| Storage | SQLite |
| Terminal | xterm.js |
