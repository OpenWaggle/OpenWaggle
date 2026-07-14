---
title: "@openwaggle/waggle-core"
description: "Runtime-neutral Waggle policy, prompts, state, presets, consensus, and turn orchestration primitives."
order: 4
section: "Packages"
---

`@openwaggle/waggle-core` contains the reusable Waggle policy layer.

Use it when you need Waggle configuration, built-in presets, prompt construction, state parsing, consensus checks, metadata helpers, or turn decisions without depending on Pi or the OpenWaggle desktop app.

## Install

```bash
pnpm add @openwaggle/waggle-core
```

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
