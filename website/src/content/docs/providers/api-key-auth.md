---
title: "API key authentication"
description: "Save, test, replace, or clear a provider API key in OpenWaggle."
order: 10
section: "Customize"
kind: "guide"
---

Use an API key when your provider gives you one for apps to call its models. Create the key in your provider's account first, and check that the account can use the model you want and has billing set up if the provider needs it. Keep the key out of chat messages, screenshots and files you commit.

## Save a key

1. Open **Settings > Connections** and expand **API Key Providers**.
2. Click the pencil icon beside your provider.
3. Paste the key into **Auth key**. Some providers show a **Get API key** link to their key page.
4. Click **Test** to check the key. The test sends a small request to the provider and can use some of your quota.
5. Click **Save**. Testing alone does not save the key.
6. Turn on a model under **Available Models**, then pick it beside the message box.

After you save, the provider row reads **API key configured**. That shows a key is stored, not that every model on the account works.

## Test a key

A test that works shows **Connection successful**. If it fails, read the error, then check that you picked the right provider, the key's permissions, and the account's billing and quota.

The test sends one short prompt without tools and gives up after 15 seconds. It does not try every model or check tool calling. It uses the provider setup of the project you have open, so test in the project where you plan to use the model.

## Replace or clear a key

To replace a key, click the pencil icon again, enter the new key and click **Save**.

**Clear** deletes the saved key from OpenWaggle. It does not revoke the key at the provider, and it does not remove credentials that come from somewhere else, such as an environment variable. If a key leaks, revoke it in your provider's account too.

## Keys from the environment or a config file

A row that reads **Configured outside OpenWaggle** means Pi found credentials in an environment variable, your cloud credentials or a custom provider's configuration. You do not need to paste a key to change that.

An app you open from the dock or Start menu may not get the same environment variables as your terminal. If a key set in your shell works in a terminal but not in OpenWaggle, check how you started the app and whether its environment has the variable.

OpenWaggle saves keys through Pi, the agent engine inside the app. Pi keeps them in `~/.pi/agent/auth.json`, or in `auth.json` inside the folder in [`PI_CODING_AGENT_DIR`](/docs/reference/environment-variables#pi) when you set that variable. Treat `auth.json` as a secret. It is separate from OpenWaggle's session database and from the encrypted store for MCP secrets. [Data and file locations](/docs/reference/data-locations#pi-agent-folder) lists the other files in Pi's folder.

A provider that a project's own extension adds can pass a key test but fail to save, because saving uses Pi's default setup without that project's extensions. See [Custom providers](/docs/providers/custom-providers#models-that-only-one-project-has).

## Which providers take a key

The provider list comes from Pi, not from a list OpenWaggle keeps. See [Pi providers](https://pi.dev/docs/latest/providers#api-keys) for current provider names, their environment variables, which credential wins when there are several, how `auth.json` stores keys, and reading a key from a shell command.
