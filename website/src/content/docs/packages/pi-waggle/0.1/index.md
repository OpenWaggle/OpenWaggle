---
title: "@openwaggle/pi-waggle"
description: "Run two configurable Pi agents in alternating turns until they reach consensus or a safety limit."
order: 5
section: "Packages"
---

`@openwaggle/pi-waggle` adds a structured two-agent collaboration loop to Pi.

## What Waggle Mode Does

Waggle mode gives the same task to two configurable agents and lets them alternate turns in one Pi session. Each agent sees the work already produced, can use Pi's normal tools, and contributes from a different role. The loop stops when the agents reach consensus, the configured turn safety limit is reached, the user stops it, or an error prevents another turn.

For example, one agent can implement a change while another reviews it, an attacker can probe a design while a defender hardens it, or an advocate and critic can test competing approaches. Use Waggle mode when a task benefits from iteration and opposing viewpoints. Standard Pi mode is usually faster and cheaper for simple questions or one-step edits.

The package includes `@openwaggle/waggle-core`, registers `/waggle` and `/standard`, renders each turn with Pi-native UI, and persists mode state as Pi custom messages.

## Install In Pi

Install the extension for your user:

```bash
pi install npm:@openwaggle/pi-waggle
```

Install it only for the current project:

```bash
pi install npm:@openwaggle/pi-waggle -l
```

Try it for one run without keeping it installed:

```bash
pi -e npm:@openwaggle/pi-waggle
```

Pi installs the package and provides its Pi SDK peer dependencies. After installation, run `/waggle` to choose or configure a preset.

If you are importing the package APIs into another project instead of installing the Pi extension, use your package manager:

<package-install packages="@openwaggle/pi-waggle @earendil-works/pi-coding-agent @earendil-works/pi-tui"></package-install>

`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are host-provided peer dependencies. Application developers should install the Pi versions used by their host.

Pi users normally install `@openwaggle/pi-waggle` alone for Waggle mode. Install `@openwaggle/waggle-core` directly only when your code imports core helpers itself.

## Pi Extension Entry

The `./extension` subpath exposes the default Pi extension factory:

```ts
import piWaggle from '@openwaggle/pi-waggle/extension'

export default piWaggle
```

The package manifest also declares the built Pi extension entry so Pi package loading can discover it from the installed package.

## Commands

The default extension registers:

| Command | Behavior |
|---------|----------|
| `/waggle` | Opens the default Waggle control flow or enables a preset. |
| `/waggle <preset-id> <prompt>` | Enables the preset and starts from the provided prompt. |
| `/waggle off` | Disables Waggle mode for the current branch. |
| `/standard` | Disables Waggle mode for the current branch. |

Command parsing helpers are also exported:

```ts
import { parsePiWaggleCommandArgs } from '@openwaggle/pi-waggle/commands'

const intent = parsePiWaggleCommandArgs('code-review review this diff')
```

## Runtime State And Messages

Pi Waggle uses Pi custom message types under the `pi-waggle.*` namespace:

```ts
import {
  PI_WAGGLE_MODE_STATE_CUSTOM_TYPE,
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
  parsePiWaggleModeState,
  parsePiWaggleTurnDetails,
} from '@openwaggle/pi-waggle/protocol'
```

Use these helpers when projecting or rendering Pi Waggle state. Do not seed a parallel metadata tree outside Pi session data.

## Custom Loop Integration

Advanced Pi integrations can use the loop helpers directly when they need custom metadata, message creation, or completion handling:

```ts
import { createPiWaggleExtension } from '@openwaggle/pi-waggle/loop'
import type { WaggleConfig } from '@openwaggle/waggle-core'

export function createCustomWaggle(config: WaggleConfig) {
  return createPiWaggleExtension({
    config,
    createTurnMetadata: ({ turnNumber, agentIndex }) => ({ turnNumber, agentIndex }),
    buildTurnMessage: ({ turn }) => ({
      customType: 'example.waggle-turn',
      content: `Turn ${String(turn.turnNumber + 1)}: ${turn.agent.label}`,
      display: false,
      details: { turnNumber: turn.turnNumber, agentLabel: turn.agent.label },
    }),
    onTurnComplete: () => ({ continue: true }),
  })
}
```

Most users should start with the default extension export. Reach for loop helpers only when you are embedding Waggle into a custom Pi package.

## Boundary Rules

`@openwaggle/pi-waggle` is Pi-specific. It may import Pi SDK packages and `@openwaggle/waggle-core`, but it should not be used as an OpenWaggle renderer dependency or browser-only extension UI package.

For runtime-neutral policy, use [`@openwaggle/waggle-core`](/docs/packages/waggle-core). For OpenWaggle visual extensions, use [`@openwaggle/extension-sdk`](/docs/packages/extension-sdk).

## Compatibility

| Requirement | Supported line |
|-------------|----------------|
| Node.js | 22.19 and newer |
| Pi coding agent | Host-provided peer; tested with `0.81.x` |
| Pi TUI | Host-provided peer; tested with `0.81.x` |
| Module format | ESM and CommonJS |
| Pi Waggle documentation | 0.1 |

## Reference And Support

- [Complete API reference](./api-reference)
- [npm package](https://www.npmjs.com/package/@openwaggle/pi-waggle)
- [Package changelog](https://github.com/OpenWaggle/OpenWaggle/blob/main/packages/pi-waggle/CHANGELOG.md)
- [Report an issue](https://github.com/OpenWaggle/OpenWaggle/issues/new)

## Troubleshooting

**Pi does not discover the extension.** Install the package in the Pi package environment and confirm the package manifest exposes `./dist/extension.js` through its `pi.extensions` entry.

**Commands render but state does not persist.** Preserve the `pi-waggle.*` custom messages in Pi session data and avoid a parallel host-owned state tree.

**Peer dependency warnings appear.** Install Pi coding-agent and TUI versions compatible with the exact peer ranges in the package manifest.

There are no migrations within the `0.1` documentation line. Future incompatible changes will receive a new versioned documentation line and migration guide.
