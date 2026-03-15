---
name: electron-env-safety
description: Safe patterns for passing environment variables to child processes in Electron apps. This skill should be used when spawning child processes (MCP stdio servers, shell commands, etc.) that need environment variables without TypeScript type errors or security leaks.
---

# Electron Child Process Env Safety

Provide type-safe, secure patterns for passing environment variables from an Electron main process to child processes.

## When to Use

- Spawning child processes that need inherited environment variables (MCP stdio transport, `child_process.spawn`, etc.)
- Adding new env-dependent features to the main process
- Reviewing code that touches `process.env` or child process environment configuration

## Core Rules

1. **Never access `process.env` directly** outside `src/main/env.ts` — Biome's `noProcessEnv` rule enforces this.
2. **Never cast `process.env`** to `Record<string, string>` — values are `string | undefined` and the cast hides bugs.
3. **Never spread `process.env` into APIs expecting `Record<string, string>`** — undefined values leak through.
4. **Use `getFullProcessEnv()`** from `src/main/env.ts` when a child process needs the full parent environment.
5. **Use `getSafeChildEnv()`** from `src/main/env.ts` when running user-provided commands (prevents API key leaks).

## Workflow

1. Determine whether the child process needs the full environment or a safe subset.
2. Import the appropriate helper from `src/main/env.ts`.
3. Merge any user-provided overrides on top of the base environment.
4. Pass the merged result to the child process API.

For detailed patterns, anti-patterns, and decision guidance, load `references/patterns.md`.
