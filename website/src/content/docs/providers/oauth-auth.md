---
title: "Browser sign-in"
description: "Connect a provider through OAuth, finish a browser login, or disconnect an account."
order: 11
section: "Customize"
---

OAuth is browser-based sign-in. You approve access on the provider's website without giving OpenWaggle your account password. Use it when your provider appears under **OAuth Providers** in Settings.

## Connecting

1. Open **Settings > Connections** and expand **OAuth Providers**.
2. Turn on the switch beside your provider.
3. Choose a sign-in method if OpenWaggle asks, then complete the provider's browser flow.
4. If OpenWaggle displays a device code, enter that code on the indicated provider page.
5. Wait for the provider row to show **Connected**.
6. Enable a model under **Available Models**, then select it beside the message box.

If the browser login does not finish automatically and OpenWaggle shows **Paste OAuth code or callback URL**, paste the code or callback URL returned by the provider and click **Connect**. Treat that value as a secret, not something to include in a bug report or chat message.

The provider switch stays usable during login. Turn it off to cancel an unfinished attempt. If an error appears, follow its instructions and use **Try again**.

## Disconnecting

Turn off the provider switch. OpenWaggle logs out of that provider and refreshes its model availability.

Disconnecting removes the provider's stored credential from Pi's credential storage, shared with other Pi clients using the same agent directory. It does not cancel a provider subscription or remove environment-based credentials. Use the provider's account settings to manage billing or revoke account access there.

## Availability

**Connected** means sign-in succeeded, not that the account can use every listed model. Your provider controls subscription eligibility, model access, rate limits, and charges.

OpenWaggle gets supported OAuth providers from Pi, the agent engine included with the app. Its sign-in service uses Pi's default runtime. A provider registered only by a project extension can appear in the model catalog without its OAuth flow being available in Connections. See [Pi providers > Subscriptions](https://pi.dev/docs/latest/providers#subscriptions) for the current provider set and provider-specific requirements. Pi's `/login` instructions describe its terminal interface; in OpenWaggle, use **Settings > Connections** instead.
