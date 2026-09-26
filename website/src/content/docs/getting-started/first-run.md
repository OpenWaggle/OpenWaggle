---
title: "Get started"
description: "Connect a model, open a project, ask about your code, and review your first change in OpenWaggle."
order: 1
section: "Getting started"
---

OpenWaggle is a desktop app for working on code with an AI agent. You describe a task in a conversation. The agent can read project files, edit code, and run commands using tools.

This guide takes you from installation to reviewing a small change in a Git repository you already have on your machine.

## Install OpenWaggle

Download the installer for your operating system from [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases), install it, and open the app. See [Installation](/docs/getting-started/installation) for platform-specific steps and the command-line installer.

You'll also need access to an AI provider. OpenWaggle connects to your provider account; that provider's charges and usage limits still apply. When you use a hosted model, your messages and the code included in its context leave your machine.

## Connect a model

A provider supplies access to AI models. You connect your account once, then choose which model to use for a conversation.

1. Click the gear icon in the sidebar to open Settings, then choose **Connections**.
2. Expand **API Key Providers** to enter a provider's API key, or **OAuth Providers** to sign in through your browser.
3. Under **Available Models**, enable a model you have access to. Enabled models appear in the model selector beside the message box.

For other authentication methods or connection problems, see [Providers and models](/docs/providers/overview).

## Open your project

Click **Select a project folder to get started** on the welcome screen and choose your local repository. You can also hover over **Projects** in the sidebar and click **Open project folder**.

Select your enabled model beside the message box. If the same model appears under several providers, choose the provider you connected.

Before sending a message, check the other controls above and beside the message box:

- Choose **Current checkout** to work in the folder you opened. The agent's edits will change files in that folder. Start on a development branch, with unrelated work committed or saved elsewhere.
- Set agent access to **Ask for approval**. This asks before protected actions. It does not prompt for every file read or guarantee that the agent cannot edit files.

Before a new conversation's first run, OpenWaggle tries to fast-forward the current branch from its upstream. A failed pull does not block the conversation, so check that your local files are current.

If you prefer a separate checkout, choose **New worktree** and select a base branch before sending. A Git worktree gives the conversation its own working directory. If the project has workspace preparation configured, review its Setup command too, since creating the worktree can run it before the agent starts. See [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees) for details.

## Ask about the code

Start with a question that helps you check the agent's understanding. For example:

```text
Explain how this project is organized and how to run its tests.
Read the relevant files, but don't edit files or run commands yet.
```

Send the message. The conversation shows the response and the tool activity used to produce it. Read the answer and check the files it refers to. Correct any assumptions before asking for changes.

When an approval request appears, inspect the proposed action and its target. Use **Allow once** if you want that action to proceed. Otherwise, choose **Continue without** and explain what the agent should do instead. Asking the agent not to edit is an instruction, not a security boundary.

## Make a small change

Choose something easy to inspect for your first task. For example, continue the conversation with:

```text
Add a short section to the README explaining how to run the existing tests.
Use the commands you found in this project. Only edit the README.
Don't commit or push anything.
```

You can name a file, describe the result you want, and state what should stay unchanged. For a code change, ask the agent to run the relevant tests and report the result too.

## Review the result

Open the diff panel with **Cmd+D** on macOS or **Ctrl+D** on Windows and Linux. These are the default shortcuts. Select **Working tree** to review uncommitted changes.

Read the diff, not just the agent's summary. Check that the right files changed and that the instructions or code are correct. The diff shows changes already made to disk; opening it is not an approval step before applying edits. It can also include changes you or another session made in the same checkout.

To request a correction, click a changed line, write your feedback, and choose **Add comment** to send it to the agent. You can also reply in the conversation:

```text
Keep the new test instructions, but leave the existing introduction unchanged.
```

Review the updated diff. When you're satisfied, commit the changes using your usual Git workflow or OpenWaggle's [Git controls](/docs/developer-workflow/git-integration). Committing or pushing is not required to finish this walkthrough.

## Next steps

- [Conversations and tools](/docs/using-openwaggle/chat-and-tools) covers continuing work with the agent.
- [Browser preview](/docs/developer-workflow/browser-preview) explains how to inspect a running web app and send visual feedback.
- [Project instructions](/docs/extending/agents-md) explains how to give the agent conventions it should follow each time.
