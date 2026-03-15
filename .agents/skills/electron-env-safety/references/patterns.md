# Electron Child Process Env Safety — Patterns Reference

## Problem: `process.env` values are `string | undefined`

Node.js types define `process.env` as `Record<string, string | undefined>`. Many child process
APIs (MCP SDK `StdioClientTransport`, `child_process.spawn`, etc.) expect `Record<string, string>`.
Spreading `process.env` directly causes TypeScript errors or silent `undefined` propagation.

## Pattern 1: Centralized Full-Env Helper

Create a single function in the env module that filters undefined values:

```typescript
// src/main/env.ts
export function getFullProcessEnv(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}
```

Then merge user-provided overrides on top:

```typescript
import { getFullProcessEnv } from '../env'

function buildChildEnv(userEnv: Readonly<Record<string, string>>): Record<string, string> {
  const base = getFullProcessEnv()
  for (const [key, value] of Object.entries(userEnv)) {
    base[key] = value
  }
  return base
}
```

## Pattern 2: Safe Env Subset (Security-Sensitive)

For tools that execute user-provided commands, pass only essential variables:

```typescript
// src/main/env.ts
export function getSafeChildEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    LANG: process.env.LANG,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
  }
}
```

## When to Use Which

| Scenario | Pattern | Rationale |
|----------|---------|-----------|
| MCP stdio transport | Full-env helper | MCP servers often need NODE_PATH, Python venvs, etc. |
| User-facing `runCommand` tool | Safe env subset | Prevent leaking API keys and secrets |
| Internal spawned processes | Full-env helper | Inherit full environment for compatibility |

## Anti-Patterns

### Spreading `process.env` directly

```typescript
// BAD: TypeScript error — values may be undefined
const transport = new StdioClientTransport({
  env: { ...process.env, ...userEnv },
})
```

### Casting to suppress the error

```typescript
// BAD: Violates no-cast rule, hides undefined values at runtime
const env = process.env as Record<string, string>
```

### Using `process.env` outside the env module

```typescript
// BAD: Biome noProcessEnv rule violation
// Only src/main/env.ts has the override
const path = process.env.PATH
```

## Biome Configuration

The project enforces `noProcessEnv` via Biome. Only `src/main/env.ts` has an override allowing
direct `process.env` access. All other files must import from the env module.
