---
title: "Browser sign-in"
description: "Connect a provider through OAuth, finish a browser login, or disconnect an account."
order: 11
section: "Customize"
kind: "guide"
---

Browser sign-in (OAuth) lets you connect a provider by logging in on its website. You approve access there, and OpenWaggle never sees your account password. Use it when your provider is listed under **OAuth Providers** in Settings, for example to use a chat subscription instead of an API key.

## Connect a provider

1. Open **Settings > Connections** and expand **OAuth Providers**.
2. Turn on the switch beside your provider.
3. If OpenWaggle asks, choose a sign-in method. Then finish the login in your browser.
4. If OpenWaggle shows a device code, enter it on the provider page it names.
5. Wait for the row to read **Connected**.
6. Turn on a model under **Available Models**, then pick it beside the message box.

![OAuth Providers expanded, listing nine sign-in providers such as Anthropic, GitHub Copilot and OpenAI, each Disconnected with its switch off](/screenshots/settings-oauth-providers.png)

While the login runs, the row shows what it is waiting for, such as **Waiting for browser...**. The switch still works: turn it off to cancel a login you did not finish. If an error appears, follow what it says and click **Try again**.

## Finish a login by hand

If the browser login does not come back to OpenWaggle on its own and you see **Paste OAuth code or callback URL**, paste the code or the callback URL the provider gave you and click **Connect**. Treat that value as a secret. Leave it out of bug reports and chat messages.

Some providers ask in their own words, such as **Paste the authorization code**. Anything secret you type stays hidden. When the login has a sign-in link, **Copy sign-in link** copies it, so you can open it in a browser on another computer and paste back the code that browser shows.

## Sign-in methods

Pi, the agent engine inside OpenWaggle, supplies the providers and their sign-in methods, so new ones can appear without an OpenWaggle update. With the Pi version that ships now:

- **OpenAI** offers **Sign in with ChatGPT**, which uses a ChatGPT subscription with the OpenAI provider. The older **OpenAI Codex** provider is marked as legacy.
- **Anthropic** offers browser sign-in, and a copy-code method for when the browser runs on another machine.
- **Radius** has its own sign-in.

Pi renamed the Azure provider from `azure-openai-responses` to `azure`. Each time OpenWaggle starts, it moves your saved Azure model choices and each OpenWaggle session's model to the new name. It also copies your Azure credential to the new name and keeps the old entry for older Pi versions. Pi's own session files still name the old provider in their history, and OpenWaggle does not rewrite them. If you added Azure model settings to Pi's `models.json` under the old name, rename them yourself.

## Disconnect a provider

Turn off the provider's switch. OpenWaggle logs out of that provider and refreshes which of its models are available.

Disconnecting deletes the provider's saved credential from Pi's credential file. Other Pi apps that use the same agent folder lose it too. It does not cancel your subscription or remove credentials that come from environment variables. Manage billing and revoke account access in the provider's own account settings.

## What Connected means

**Connected** means the login worked. It does not mean your account can use every model listed. Your provider decides which plans qualify, which models you get, your rate limits and what you pay.

Sign-in uses Pi's default setup, without any project's extensions. A provider that only a project extension adds can show up in the model list while its sign-in is missing from **Connections**. See [Pi providers > Subscriptions](https://pi.dev/docs/latest/providers#subscriptions) for the current providers and what each needs. Pi's docs tell you to run `/login` in its terminal interface. In OpenWaggle, use **Settings > Connections** instead.
