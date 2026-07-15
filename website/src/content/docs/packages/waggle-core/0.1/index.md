---
title: "@openwaggle/waggle-core"
description: "Runtime-neutral Waggle policy, prompts, state, presets, consensus, and turn orchestration primitives."
order: 4
section: "Packages"
---

`@openwaggle/waggle-core` contains the reusable Waggle policy layer.

Use it when you need Waggle configuration, built-in presets, prompt construction, state parsing, consensus checks, metadata helpers, or turn decisions without depending on Pi or the OpenWaggle desktop app.

<package-install packages="@openwaggle/waggle-core"></package-install>

## Main Imports

```ts
import {
  BUILT_IN_WAGGLE_PRESETS,
  WAGGLE_INHERIT_MODEL,
  buildWaggleTurnPrompt,
  decideNextWaggleTurn,
  getWaggleTurn,
  parseWaggleConfig,
} from '@openwaggle/waggle-core'
import type { WaggleConfig } from '@openwaggle/waggle-core'
```

Supported public subpaths include:

| Subpath | Use it for |
|---------|------------|
| `@openwaggle/waggle-core` | Primary config, prompt, preset, state, consensus, event, and turn-policy exports. |
| `@openwaggle/waggle-core/config` | Waggle config types, constants, and parsing helpers. |
| `@openwaggle/waggle-core/presets` | Built-in presets and preset merge helpers. |
| `@openwaggle/waggle-core/prompts` | Prompt construction helpers. |
| `@openwaggle/waggle-core/turn-policy` | Turn ownership and next-turn decisions. |
| `@openwaggle/waggle-core/consensus` | Consensus result helpers. |
| `@openwaggle/waggle-core/events` | Runtime-neutral event metadata helpers. |

## Configure Two Agents

Waggle mode currently models exactly two collaborating agents.

```ts
import { WAGGLE_INHERIT_MODEL } from '@openwaggle/waggle-core'
import type { WaggleConfig } from '@openwaggle/waggle-core'

const config = {
  mode: 'sequential',
  agents: [
    {
      label: 'Architect',
      model: WAGGLE_INHERIT_MODEL,
      roleDescription: 'Review architecture and identify structural tradeoffs.',
      color: 'blue',
    },
    {
      label: 'Reviewer',
      model: WAGGLE_INHERIT_MODEL,
      roleDescription: 'Check correctness, tests, security, and edge cases.',
      color: 'amber',
    },
  ],
  stop: {
    primary: 'consensus',
    maxTurnsSafety: 8,
  },
} satisfies WaggleConfig
```

Use provider-qualified model ids such as `openai/gpt-5.5` when the host runtime should switch models per agent. Use `WAGGLE_INHERIT_MODEL` when the host runtime should keep the current model.

## Validate External Config

```ts
import { parseWaggleConfig } from '@openwaggle/waggle-core'

const parsed = parseWaggleConfig(JSON.parse(configJson))

if (!parsed.success) {
  throw new Error(parsed.issues.join('\n'))
}

const config = parsed.value
```

## Decide Turns

```ts
import { buildWaggleTurnPrompt, decideNextWaggleTurn, getWaggleTurn } from '@openwaggle/waggle-core'
import type { WaggleConfig } from '@openwaggle/waggle-core'

export function nextPrompt(config: WaggleConfig, userPrompt: string, turnNumber: number) {
  const turn = getWaggleTurn(config, turnNumber)
  const prompt = buildWaggleTurnPrompt({ config, userPrompt, turnNumber })
  const next = decideNextWaggleTurn(config, {
    turnNumber,
    consensusReached: false,
  })

  return {
    turn,
    prompt,
    nextTurn: next.continue ? next.nextTurn : undefined,
  }
}
```

`decideNextWaggleTurn` stops when consensus is reached, a terminal error is reported, or `stop.maxTurnsSafety` would be exceeded.

## Runtime Boundary

`@openwaggle/waggle-core` is runtime-neutral. It should not import Pi, Electron, OpenWaggle renderer stores, app services, or Node-specific APIs. Use [`@openwaggle/pi-waggle`](/docs/packages/pi-waggle) when you want Pi commands, Pi renderers, Pi mode state, or Pi session integration.

## Compatibility

| Requirement | Supported line |
|-------------|----------------|
| Node.js | 22.19 and newer |
| Runtime | Browser-safe or server-side JavaScript |
| Module format | ESM and CommonJS |
| Waggle documentation | 0.1 |

## Reference And Support

- [Complete API reference](./api-reference)
- [npm package](https://www.npmjs.com/package/@openwaggle/waggle-core)
- [Package changelog](https://github.com/OpenWaggle/OpenWaggle/blob/main/packages/waggle-core/CHANGELOG.md)
- [Report an issue](https://github.com/OpenWaggle/OpenWaggle/issues/new)

## Troubleshooting

**External configuration does not parse.** Use `parseWaggleConfig` and surface every returned issue instead of coercing unknown input into `WaggleConfig`.

**A host needs Pi commands or renderers.** Keep core runtime-neutral and integrate through `@openwaggle/pi-waggle` or a host-specific adapter.

**Turn execution does not stop.** Always honor both the primary stop policy and `maxTurnsSafety`; the safety limit is the final bounded-loop guard.

There are no migrations within the `0.1` documentation line. Future incompatible changes will receive a new versioned documentation line and migration guide.
