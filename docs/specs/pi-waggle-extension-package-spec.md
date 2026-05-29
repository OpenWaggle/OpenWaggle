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
- `MEMORY.md`
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
- `src/main/adapters/pi/agent-kernel/waggle-run.ts` creates an inline `createWaggleExtension(...)`.
- `src/main/ports/agent-kernel-service.ts` exposes a dedicated `runWaggle(...)` path.

This is Pi-assisted but not yet a reusable Pi-native Waggle module.

## Target Architecture

Create two packages:

```txt
packages/waggle-core/
  package.json
  src/
    config.ts
    presets.ts
    prompts.ts
    turn-policy.ts
    consensus.ts
    events.ts
    state.ts

packages/pi-waggle/
  package.json
  src/
    extension.ts
    commands.ts
    renderers/
      pi-tui.ts
    testing/
      fake-extension-api.ts
```

`@openwaggle/waggle-core` is portable and must not import Pi SDK, Electron, OpenWaggle app modules, SQLite, or renderer code. It owns config/schema, built-in presets, prompt construction, turn policy, stop policy, consensus helpers, generic events, and run-state transitions.

`@openwaggle/pi-waggle` is the Pi adapter. It imports `@openwaggle/waggle-core` and Pi SDK packages, registers the Pi extension and commands, writes Pi custom entries/messages, switches Pi models, and renders Waggle status/turn markers in Pi TUI.

`@openwaggle/pi-waggle` package manifest:

```json
{
  "name": "@openwaggle/pi-waggle",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./dist/extension.js"]
  },
  "dependencies": {
    "@openwaggle/waggle-core": "workspace:*"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*",
    "typebox": "*"
  }
}
```

OpenWaggle renderer code may import browser-safe types/schema/presets from `@openwaggle/waggle-core`. OpenWaggle desktop app Pi SDK imports remain confined to `src/main/adapters/pi/`; dedicated Pi packages such as `@openwaggle/pi-waggle` may import Pi SDKs internally.

## Runtime Flow

The `@openwaggle/pi-waggle` extension owns the Pi collaboration loop while delegating portable policy decisions to `@openwaggle/waggle-core`:

```txt
User sends prompt
  -> Pi persists normal user message
  -> Waggle extension sees active Waggle mode
  -> before_agent_start prepares Agent A turn
  -> Agent A runs
  -> final turn_end / agent_end completion handler fires
  -> extension evaluates stop policy
  -> extension switches model to Agent B
  -> after the current Pi run settles, extension appends the Agent B turn marker and sends the next automatic user message
  -> Agent B runs
  -> repeat until consensus, max turns, user stop, or terminal error
```

OpenWaggle must not call Pi once per agent turn. It should start a normal Pi run with Waggle configured and observe Pi events/session entries.

## Config Contract

Canonical config lives in `packages/waggle-core/src/config.ts`.

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

`@openwaggle/pi-waggle` should register Pi commands:

```txt
/waggle
/waggle <preset>
/waggle <preset> <prompt>
/waggle off
/waggle new
/waggle edit [preset]
/waggle config
/waggle turns [number]
/standard
```

Behavior:

- `/waggle` opens a context-aware Waggle control center using Pi TUI UI when available. It must use progressive disclosure instead of a flat dump: top-level choices answer the user's intent, and detailed editing flows live behind focused submenus.
  - The top-level control center shows selectable preset rows directly, plus top-level actions such as `Add custom preset…` and `Manage presets…`; it does not require an `Enable Waggle…` submenu before users can pick a preset.
  - When Waggle is enabled, include a normal selectable `Waggle Off` row in the top-level control center instead of a separate `Current mode` section. The enabled title/status includes preset or custom-config name, max turns, and an effective model summary. If both agents resolve to the same model, show that concrete model ID; if agents differ, show `mixed models` and expose per-agent models in configuration/detail screens.
  - Preset selection uses a Waggle-specific custom picker in interactive Pi TUI: arrow keys navigate presets/actions, the selected row's read-only details panel updates in place below a clear divider, `enter` enables the selected preset or runs the selected action, `space` opens a preset actions/details menu for preset rows, and `escape` cancels. Non-interactive modes may fall back to a simple selector.
  - The preset actions/details menu for inactive presets includes `Enable preset`, `Edit before enabling…`, `Save a custom copy…`, `View advanced JSON`, and `Back`. For the active preset/config, the same `space` actions/details path exposes `Edit active Waggle config…`, `Save active config as preset…`, `View advanced JSON`, and `Back`; active config editing is not a separate top-level control-center row.
  - `Add custom preset…` is a top-level, state-independent action: it is available whether Waggle is off or enabled and opens a guided multi-step template wizard instead of raw JSON. The wizard asks whether to create from a default template, the current Waggle configuration, or an existing preset, then walks through name, description, agents, model inheritance/pinning, prompts, colors, stop condition, and max turns. Saving a new preset or override always asks scope, with Project highlighted first and Global second.
  - `Manage presets…` contains preset maintenance actions: `Edit existing preset…`, `Delete preset…`, and, only when needed, `Restore hidden presets…`. Editing a built-in creates an explicit user/project override for that same preset ID instead of preserving the package default. Deleting can remove or suppress any resolved preset, including package built-ins, so users can hide every preset they do not want. Built-in deletes ask for scope: project-scoped delete suppresses the built-in for the active project; global delete suppresses it for the user entirely so it disappears from all resolved preset lists. Deletes require confirmation and must show whether the action affects a user preset, project preset, project built-in suppression, or global built-in suppression.
  - Preset rows include each preset's name plus concise scope/turn details. The details panel shows the selected preset's description, stop condition, agent labels, effective model IDs, and prompt previews so the list does not become a dumping ground. Compact rows show concrete effective model IDs when model information is shown; they do not append inheritance labels such as `inherited`.
  - Agent model binding has two modes: inherited from the currently selected standard-mode model, or pinned to a specific provider-qualified model ID. Inherited model bindings are represented in config as `model: "$inherit"`; pinned bindings use `model: "provider/modelId"`. Inherited bindings stay inherited after saving or enabling a preset; they do not get materialized into concrete model IDs. At display/run time, UI and runtime resolve inherited bindings to the current concrete standard-mode model and show that concrete ID (for example `anthropic/claude-sonnet-4`), not the phrase `current model`. Binding state can be explained in focused detail/edit screens, not in compact overview rows.
- `/waggle <preset>` activates a preset for the current branch.
- `/waggle <preset> <prompt>` activates a preset and starts a run with the prompt.
- `/waggle off` disables Waggle on the current branch.
- `/waggle new` creates a custom preset in project or user scope.
- `/waggle edit [preset]` edits an existing preset; editing built-ins writes an override preset.
- `/waggle config` is an advanced shortcut alias that opens the guided active-configuration editor. The primary path is `/waggle`, select the active preset/config, then `space` → `Edit active Waggle config…`. The guided editor must expose safe field-level flows for agents, concrete model IDs, role prompts, colors, max turns, and stop condition. Raw JSON editing is available only from an Advanced submenu and must validate before persisting.
  - Active configuration rows must show concrete model IDs, not `current model` placeholders.
  - Agent rows show a short prompt preview (normalized whitespace, first sentence when practical, otherwise truncated around 60-80 characters); selecting an agent opens a structured agent detail/edit screen where the full prompt is visible before editing.
  - Changing an agent model must use the same model-selection UX as Pi's standard `/model` flow for concrete model choices: searchable model list, provider badges, current-model indicator, scoped/all toggle when applicable, and the same keyboard behavior. In Waggle model selection, the current-model indicator means "current model for this selected agent slot". Selecting a concrete model pins only the selected agent slot; it must not change the standard session model or any other Waggle agent slot. Returning a pinned agent to `$inherit` is handled by a separate state-labelled action in the agent detail menu: `Use standard-mode model — active` when already inherited, or `Use standard-mode model — switch from pinned` when pinned.
- `/waggle turns [number]` is an advanced shortcut alias that edits only the active branch max-turn limit.
- `/standard` is an alias for disabling Waggle.
- `/standard` should not be shown when already in standard mode.

Completion behavior:

- Stock Pi command completions are context-free, so `/waggle` completions should include context-free actions (`off`, `turns`, `config`, `new`, `edit`), built-in presets, and user presets. Advanced shortcut completions must be labelled clearly as shortcuts/advanced actions so they do not appear to be the primary UX.
- Do not patch Pi just to pass command context into completions. Project presets are available from the `/waggle` menu because command handlers already receive `ctx.cwd`.
- If a future Pi release passes `ExtensionCommandContext` into completion callbacks, `@openwaggle/pi-waggle` may include active-project presets from `ctx.cwd/.pi/waggle-presets.json`.
- When `ctx` is absent, `@openwaggle/pi-waggle` must not guess project context from `process.cwd()` or cached session state.

OpenWaggle may expose richer UI around the same commands/config, but must preserve the same underlying state semantics.

## Pi TUI Rendering

`@openwaggle/pi-waggle` should register Pi TUI message renderers for Waggle custom messages and status.

Minimum Pi TUI UX:

- Show when Waggle mode is active.
- Show current agent label/model while running.
- Render turn markers clearly.
- Preserve normal assistant messages as normal Pi assistant messages.

Known limitation to validate: Pi TUI supports custom message renderers, but may not expose a direct hook to style assistant messages based on preceding custom metadata. If that limitation remains, Pi TUI can render compact turn markers/status first while OpenWaggle renders richer grouped turn rails from projected metadata.

## OpenWaggle Migration Plan

1. Add `packages/waggle-core` and `packages/pi-waggle` to `pnpm-workspace.yaml`.
2. Move shared Waggle config types/schema, built-in presets, prompt construction, turn selection, stop policy, and consensus checks into `@openwaggle/waggle-core`.
3. Implement `@openwaggle/pi-waggle` as the first adapter over Waggle core, with fake Pi extension tests before OpenWaggle wiring.
4. Replace inline `createWaggleExtension(...)` in `src/main/adapters/pi/agent-kernel/waggle-run.ts` with the package extension.
5. Collapse `AgentKernelService.runWaggle(...)` into a thin wrapper around normal `run(...)`, or remove it if standard `run(...)` can carry extension config cleanly.
6. Convert `WaggleRunService` from runtime orchestrator into UI/session-prep glue, or delete it if no longer needed.
7. Replace OpenWaggle-only preset persistence with Pi-compatible preset files.
8. Update session projection to read `pi-waggle.*` custom entries and annotate assistant nodes.
9. Keep OpenWaggle renderer behavior: one colored rail per logical agent turn and one visible label/model per turn, including while streaming.

## Acceptance Criteria

- Portable Waggle policy runs from `@openwaggle/waggle-core`.
- The Pi Waggle loop runs from `@openwaggle/pi-waggle`.
- OpenWaggle no longer owns multi-agent turn sequencing.
- `@openwaggle/pi-waggle` can be installed and loaded by Pi TUI.
- Presets are portable between Pi TUI and OpenWaggle.
- Mode/config is branch-scoped through Pi session entries.
- OpenWaggle standard and Waggle modes share the same session/tree/branch behavior except for sequential two-agent turns.
- OpenWaggle renders each logical Waggle turn once, with one divider/model label and one continuous colored rail.
- No `openwaggle.waggle.*` runtime custom types remain in the reusable module.

## Test Plan

- `@openwaggle/waggle-core` unit tests:
  - config validation
  - preset merge order
  - prompt building
  - turn sequencing
  - stop policy
  - runtime-agnostic state transitions
- `@openwaggle/pi-waggle` package tests:
  - command parsing
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
