---
title: "First Run"
description: "What to do when you launch OpenWaggle for the first time — provider setup, project selection, and sending your first message."
order: 2
section: "Getting Started"
---

When you launch OpenWaggle for the first time, you'll see the main workspace with an empty session area. To start using the agent:

1. **Set up a provider** — Click the gear icon in the sidebar to open Settings. Go to **Connections**, expand an auth method group, and authenticate through API key or OAuth as reported by Pi. See [Providers & Models](/docs/providers/overview) for details.

2. **Select a project** — Click "Select a project folder to get started" in the welcome screen, or use the folder button on the sidebar's **Projects** heading. This gives the agent access to your codebase.

   Once you have more than a handful of sessions, the filter field at the top of the sidebar
   (`Cmd+F`) narrows by session title or project name, and the state chips beneath it jump
   straight to whatever needs you. See [Reading the sidebar](/docs/using-openwaggle/chat-and-tools#reading-the-sidebar).

3. **Enable models** — In Settings > Connections, choose which Pi-reported models should appear in the composer.

4. **Pick a model** — Use the model selector in the composer toolbar. Models are provider-qualified, so the same underlying model can appear through different providers.

5. **Send a message** — Type in the composer and press Enter. The agent will respond through Pi and can use Pi's native coding-agent tools in your project.

   The row below the composer has a **Run in** selector. Leave it on **Current checkout** (the default) to edit your opened folder directly, or choose **New worktree** to run the session in an isolated Git worktree — in which case pick a base branch before your first send. See [Git Integration](/docs/developer-workflow/git-integration).

## Next Steps

- [Set up AI providers](/docs/providers/overview) to connect to different models.
- Learn about [chat and agent tools](/docs/using-openwaggle/chat-and-tools).
- Explore [Waggle Mode](/docs/using-openwaggle/waggle-mode) for multi-agent collaboration.
