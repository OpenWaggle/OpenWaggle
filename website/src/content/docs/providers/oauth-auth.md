---
title: "OAuth Auth"
description: "OAuth provider authentication surfaced from Pi."
order: 3
section: "Providers"
---

OAuth providers come directly from Pi `AuthStorage.getOAuthProviders()`. OpenWaggle does not keep a separate OAuth provider list.

Pi documents browser-based authentication through `/login` in [Providers > Subscriptions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#subscriptions). Use that Pi reference for the current provider set and provider-specific behavior.

## Connecting

1. Open **Settings > Connections**.
2. Expand **OAuth providers**.
3. Toggle a Pi-reported provider on.
4. Complete Pi's browser-based login flow.

The toggle remains usable during authentication so you can cancel an in-progress login.

## Disconnecting

Toggle the provider off. OpenWaggle calls Pi logout for that provider and refreshes the provider/model catalog.

## Availability

OAuth being connected does not mean every model under that provider is available to your account. Entitlements are determined by Pi and the upstream provider.
