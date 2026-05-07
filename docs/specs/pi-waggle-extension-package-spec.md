# Pi Waggle Extension Package Spec

_Status: future implementation spec_
_Created: 2026-05-07_

## Purpose

Waggle mode should ship as a reusable Pi package that can be installed and used in both Pi TUI and OpenWaggle. OpenWaggle should no longer own the multi-agent collaboration loop directly. It should configure/start Waggle through Pi, render emitted Pi session state, and persist its SQLite projection from the Pi session graph.

This spec is intentionally separate from the current Pi migration PR because that PR is already large.

## Source constraints

Implementation must stay faithful to:

- `docs/first-principles.md`
  - Pi is the runtime kernel.
  - Runtime capabilities come from Pi first.
  - Product state is an explicit projection over real Pi sessions/nodes/branches.
  - Waggle and standard mode share the same canonical session/tree model.
- `docs/lessons.md`
  - Waggle mode must run inside Pi as extension/runtime behavior.
  - Waggle and standard mode differ only because Waggle runs two models sequentially per user turn.
  - Branch navigation, draft creation, materialization, archive/restore, composer behavior, git, diffs, and active-run semantics apply equally to standard and Waggle.
  - Mirror Pi TUI behavior by default.
- Pi package/extension model from `@mariozechner/pi-coding-agent@0.70.2`
  - Extensions are normal TypeScript modules.
  - Packages can declare resources through `package.json#pi`.
  - Extensions can register commands, flags, message renderers, event handlers, custom entries, and custom messages.

## Current OpenWaggle State

Preset storage is OpenWaggle-owned:

- Built-in presets live in `src/main/adapters/settings-waggle-presets-repository.ts`.
- Global custom presets live in Electron user data as `waggle-presets.json`.
- Project custom presets live at top-level `.openwaggle/settings.json#wagglePresets`.
- Pi settings live separately under `.openwaggle/settings.json#pi` and are bridged by `src/main/adapters/pi/openwaggle-pi-settings-storage.ts`.

Runtime orchestration is split:

- `src/main/application/waggle-run-service.ts` owns turn policy, consensus checks, file conflict tracking, metadata assignment, active-run persistence, and final snapshot persistence.
- `src/main/adapters/pi/pi-agent-kernel-adapter.ts` creates an inline `createWaggleExtension(...)`.
- `src/main/ports/agent-kernel-service.ts` exposes a dedicated `runWaggle(...)` path.

This is Pi-assisted but not yet a reusable Pi-native Waggle module.

## Target Architecture

Create a separate package:

```txt
packages/pi-waggle/
  package.json
  src/
    extension.ts
    config.ts
    presets.ts
    prompts.ts
    state.ts
    consensus.ts
    events.ts
    renderers/
      pi-tui.ts
    testing/
      fake-extension-api.ts
```

Package manifest:

```json
{
  "name": "@openwaggle/pi-waggle",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./dist/extension.js"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*",
    "typebox": "*"
  }
}
```

Package exports:

```json
{
  ".": "./dist/extension.js",
  "./schema": "./dist/config.js",
  "./presets": "./dist/presets.js",
  "./events": "./dist/events.js"
}
```

OpenWaggle imports browser-safe types/schema from the package. Runtime Pi SDK imports remain confined to OpenWaggle's Pi adapter layer.

## Runtime Flow

The package extension owns the collaboration loop:

```txt
User sends prompt
  -> Pi persists normal user message
  -> Waggle extension sees active Waggle mode
  -> before_agent_start prepares Agent A turn
  -> Agent A runs
  -> agent_end fires
  -> extension evaluates stop policy
  -> extension switches model to Agent B
  -> extension sends hidden follow-up custom message
  -> Agent B runs
  -> repeat until consensus, max turns, user stop, or terminal error
```

OpenWaggle must not call Pi once per agent turn. It should start a normal Pi run with Waggle configured and observe Pi events/session entries.

## Config Contract

Canonical config lives in `packages/pi-waggle/src/config.ts`.

```ts
export interface WaggleConfig {
  readonly mode: 'sequential'
  readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot]
  readonly stop: WaggleStopConfig
}

export interface WaggleAgentSlot {
  readonly label: string
  readonly model: string
  readonly roleDescription: string
  readonly color: 'blue' | 'amber' | 'emerald' | 'violet'
}

export interface WaggleStopConfig {
  readonly primary: 'consensus' | 'user-stop'
  readonly maxTurnsSafety: number
}
```

`model` remains Pi provider-qualified as `provider/modelId`.

## Preset Storage

Presets should become Pi-compatible, not OpenWaggle-only.

Canonical future storage:

```txt
~/.pi/agent/waggle-presets.json
<project>/.pi/waggle-presets.json
```

Built-ins live in the package.

Merge order:

```txt
project presets > user presets > package built-ins
```

OpenWaggle can keep a polished settings UI, but it should read/write the Pi-compatible preset files. The active runtime config should be resolved before starting the run and passed to the extension.

## Session State

Mode/config should be branch-scoped through Pi custom entries:

```ts
customType: 'pi-waggle.mode-state'
data: {
  enabled: boolean
  presetId?: string
  config?: WaggleConfig
  updatedAt: number
}
```

Because Pi sessions are tree-shaped, this gives the desired behavior naturally:

- Child branches inherit mode/config from their parent path.
- Switching branches restores that branch's mode/config.
- `/standard` and `/waggle off` write a disabled mode-state entry.
- OpenWaggle can project this into SQLite for UI speed, but Pi custom entries are the runtime source of truth.

## Turn Metadata

Use package-owned custom types:

```ts
customType: 'pi-waggle.turn'
details: {
  runId: string
  turnNumber: number
  agentIndex: number
  agentLabel: string
  agentModel: string
  agentColor: string
}
display: false
```

OpenWaggle projection should derive assistant-message Waggle metadata from these Pi entries instead of assigning metadata after the run from `WaggleRunService`.

Do not keep `openwaggle.waggle.*` runtime custom types in the reusable package.

## Commands

The package should register Pi commands:

```txt
/waggle
/waggle <preset>
/waggle <preset> <prompt>
/waggle off
/standard
```

Behavior:

- `/waggle` opens/selects Waggle mode using Pi TUI UI when available.
- `/waggle <preset>` activates a preset for the current branch.
- `/waggle <preset> <prompt>` activates a preset and starts a run with the prompt.
- `/waggle off` disables Waggle on the current branch.
- `/standard` is an alias for disabling Waggle.
- `/standard` should not be shown when already in standard mode.

OpenWaggle may expose richer UI around the same commands/config, but must preserve the same underlying state semantics.

## Pi TUI Rendering

The package should register Pi TUI message renderers for Waggle custom messages and status.

Minimum Pi TUI UX:

- Show when Waggle mode is active.
- Show current agent label/model while running.
- Render turn markers clearly.
- Preserve normal assistant messages as normal Pi assistant messages.

Known limitation to validate: Pi TUI supports custom message renderers, but may not expose a direct hook to style assistant messages based on preceding custom metadata. If that limitation remains, Pi TUI can render compact turn markers/status first while OpenWaggle renders richer grouped turn rails from projected metadata.

## OpenWaggle Migration Plan

1. Add `packages/pi-waggle` to `pnpm-workspace.yaml`.
2. Move shared Waggle config types/schema, built-in presets, prompt construction, turn selection, stop policy, and consensus checks into the package.
3. Replace inline `createWaggleExtension(...)` in `src/main/adapters/pi/pi-agent-kernel-adapter.ts` with the package extension.
4. Collapse `AgentKernelService.runWaggle(...)` into a thin wrapper around normal `run(...)`, or remove it if standard `run(...)` can carry extension config cleanly.
5. Convert `WaggleRunService` from runtime orchestrator into UI/session-prep glue, or delete it if no longer needed.
6. Replace OpenWaggle-only preset persistence with Pi-compatible preset files.
7. Update session projection to read `pi-waggle.*` custom entries and annotate assistant nodes.
8. Keep OpenWaggle renderer behavior: one colored rail per logical agent turn and one visible label/model per turn, including while streaming.

## Acceptance Criteria

- The Waggle loop runs from `@openwaggle/pi-waggle`.
- OpenWaggle no longer owns multi-agent turn sequencing.
- The same package can be installed and loaded by Pi TUI.
- Presets are portable between Pi TUI and OpenWaggle.
- Mode/config is branch-scoped through Pi session entries.
- OpenWaggle standard and Waggle modes share the same session/tree/branch behavior except for sequential two-agent turns.
- OpenWaggle renders each logical Waggle turn once, with one divider/model label and one continuous colored rail.
- No `openwaggle.waggle.*` runtime custom types remain in the reusable module.

## Test Plan

- Package unit tests:
  - config validation
  - preset merge order
  - command parsing
  - prompt building
  - turn sequencing
  - stop policy
  - state restoration from Pi session entries
- Fake `ExtensionAPI` harness tests:
  - `agent_end` schedules the next turn with `pi.sendMessage(...)`
  - model switching uses provider-qualified model refs
  - `/waggle off` and `/standard` append disabled mode state
- OpenWaggle main tests:
  - Pi custom entries project into correct assistant Waggle metadata
  - `AgentKernelService` no longer exposes app-owned turn orchestration
  - preset repository reads/writes Pi-compatible files
- Renderer tests:
  - one turn divider per logical Waggle turn
  - one model label per turn
  - live streaming attribution works before final persistence
- Manual validation:
  - `pi -e packages/pi-waggle` smoke test in Pi TUI
  - OpenWaggle Electron QA with one real Waggle run

