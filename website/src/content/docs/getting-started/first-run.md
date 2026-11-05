---
title: "Get started"
description: "Connect a model, open a project, ask about your code, and review your first change in OpenWaggle."
order: 1
section: "Getting started"
kind: "guide"
---

OpenWaggle is a desktop app for working on code with an AI agent. You describe a task in a conversation, and the agent reads your project, edits files and runs commands to do it. This guide takes you from a fresh install to reviewing a small change in a Git repository you already have.

## Install OpenWaggle

Download the installer for your computer from [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases), install it, and open the app. [Installation](/docs/getting-started/installation) has the steps for each platform and a one-line installer for the terminal.

You also need an account with an AI provider. OpenWaggle uses your account, so the provider's prices and usage limits apply. With a hosted model, your messages and the code the agent reads go to that provider.

## Connect a model

A provider gives you access to models. You connect a provider once, then pick a model for each session.

1. Click **Settings** at the bottom of the sidebar, then choose **Connections**.
2. Expand **API Key Providers** to paste an API key, or **OAuth Providers** to sign in through your browser.
3. Under **Available Models**, turn on a model you have access to. The models you turn on appear in the model picker beside the message box.

![Settings > Connections with API Key Providers and OAuth Providers collapsed, Source control, and Available Models with 3 models selected](/screenshots/settings-connections.png)

If you sign in another way or the connection fails, see [Providers and models](/docs/providers/overview).

## Open your project

On the welcome screen, click **Select a project folder to get started** and choose your repository. Later, you can add more projects by hovering over **Projects** in the sidebar and clicking **Open project folder**.

## Start a session

A session is one conversation with the agent about your project. Choose **New session** under your project. The message box shows where the agent will work and how much it may do without asking:

![The message box of a new session in the jotter project, with Current checkout, the main branch, Ask for approval and the GPT-5.4 model](/screenshots/composer-new-session.png)

1. Leave **Current checkout** selected to work in the folder you opened. The agent's edits change files in that folder, so start on a development branch and commit or put aside unrelated work first.
2. Check the access mode. New sessions use **YOLO** unless you changed the default, so the agent runs protected actions, such as opening the browser preview, without asking you. To have it ask first, open the access menu and choose **Ask for Approval**, as in the message box above. Neither mode asks before every file read, and in both the agent can edit files in the project. [Approvals and permissions](/docs/configuration/approvals-permissions) explains each mode and how to make **Ask for Approval** the default.
3. Pick the model you turned on. If the same model is listed under several providers, pick the provider you connected.

To keep the agent's changes out of your folder, choose **New worktree** instead and pick a base branch. The session then gets its own Git worktree, a separate checkout of the repository. If the project has a setup command, OpenWaggle runs it while creating the worktree, before the agent starts, so check what it does. See [Projects and worktrees](/docs/developer-workflow/projects-and-worktrees).

Before a session's first run, OpenWaggle tries to fast-forward your branch from its upstream. If that pull fails, the session still starts, so make sure your local files are up to date.

## Ask about the code

Start with a question, so you can check what the agent understands before it changes anything:

```text
Explain how this project is organized and how to run its tests.
Read the relevant files, but don't edit files or run commands yet.
```

Send the message. The reply appears in the conversation, with a row for each tool the agent used, such as each file it read. Check the files it mentions and correct anything it got wrong before you ask for changes. Telling the agent not to edit is an instruction to the model. It does not stop the agent from editing.

If the agent asks for approval, read what it wants to do and to what. Choose **Allow once** to let it go ahead, or **Continue without** and tell it what to do instead. [Answer an approval request](/docs/configuration/approvals-permissions#answer-an-approval-request) covers the other choices.

## Make a small change

Pick a first task that is easy to check. Continue the conversation with something like:

```text
Add a short section to the README explaining how to run the existing tests.
Use the commands you found in this project.
Only edit the README.
Don't commit or push anything.
```

Name the file, say what result you want, and say what must stay as it is. For a code change, also ask the agent to run the tests that cover it and tell you the result.

## Review the change

Press **Cmd+D** on macOS or **Ctrl+D** on Windows and Linux to open the diff panel, then select **Working tree** to see changes that are not committed yet.

Read the diff itself, not only the agent's summary. Check that the right files changed and that the text or code is correct. The diff shows what is already on disk. The agent writes files as it works, and opening the diff is not a step that applies them. It can also include changes you or another session made in the same folder.

To ask for a fix, click a changed line, write what should change, and choose **Add comment**. The comment goes to the agent. You can also reply in the conversation:

```text
Keep the new test instructions, but leave the existing introduction unchanged.
```

Review the diff again. When you are happy with it, commit with your usual Git tools or with OpenWaggle's [Git controls](/docs/developer-workflow/git-integration). You don't have to commit to finish this guide.

## Next steps

- [How OpenWaggle works](/docs/getting-started/how-openwaggle-works) explains projects, sessions, runs and the background process that keeps the agent working.
- [Conversations and tools](/docs/using-openwaggle/chat-and-tools) covers longer work with the agent.
- [Browser preview](/docs/developer-workflow/browser-preview) shows how to look at a running web app and send visual feedback.
- [Project instructions](/docs/extending/agents-md) tells the agent your conventions once, for every session.
