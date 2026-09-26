---
title: "API key authentication"
description: "Save, test, replace, or clear a provider API key in OpenWaggle."
order: 10
section: "Customize"
---

Create an API key in your provider's account before connecting it to OpenWaggle. Check that the account has access to the model you want and any required billing setup. Keep the key out of chat messages, screenshots, and committed project files.

## Saving a key

1. Open **Settings > Connections** and expand **API Key Providers**.
2. Click the pencil icon beside your provider.
3. Paste the key into **Auth key**. Some providers offer a **Get API key** link to their key-management page.
4. Click **Test** to check the entered key. This sends a small request to the provider and may use its quota.
5. Click **Save**. Testing alone does not save the key.
6. Enable a model under **Available Models**, then select it beside the message box.

The provider row shows **API key configured** after a key is saved. Saving does not prove that every model on the account is usable.

To replace a saved key, open the pencil icon again, enter the new key, and save it. **Clear** removes the saved key. It does not revoke the key at the provider or remove credentials supplied through another method. Revoke a leaked key in the provider's account settings too.

## Testing keys

A successful test shows **Connection successful**. If it fails, check the returned error, the provider you selected, the key's permissions, and the account's billing or quota.

A key test uses the selected project's provider configuration. Test in the same project where you intend to use the model. The test sends a short prompt without tools and has a 15-second timeout. It does not check every model or validate tool calling.

## Environment and custom providers

A row showing **Configured outside OpenWaggle** means credentials were found through environment variables, cloud credentials, or custom provider configuration. You do not need to paste another key just to change that status.

A desktop app may not receive the same environment variables as a terminal. If an environment-based setup works in your shell but not in OpenWaggle, check how the app was launched and whether its environment contains the required variable.

OpenWaggle saves keys using Pi, the agent engine included with the app. Pi's default credential file is `~/.pi/agent/auth.json`, or `auth.json` inside `PI_CODING_AGENT_DIR` when that variable is set. Treat it as a secret file; it is separate from OpenWaggle's conversation database and MCP secret vault.

Project-only provider extensions can participate in key tests without being available to the default runtime that saves keys. See [Custom providers](/docs/providers/custom-providers#project-scope) if testing succeeds but saving fails.

## API-key provider families

The provider list comes from Pi rather than a fixed list maintained by OpenWaggle. See [Pi providers](https://pi.dev/docs/latest/providers#api-keys) for current provider names, environment variables, credential precedence, auth-file storage, and advanced shell-command key resolution.
