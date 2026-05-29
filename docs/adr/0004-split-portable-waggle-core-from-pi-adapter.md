# Split Portable Waggle Core From Pi Adapter

Status: accepted

OpenWaggle will split Waggle runtime design into two packages:

- `@openwaggle/waggle-core` — portable Waggle policy with no Pi SDK, Electron, renderer, SQLite, filesystem, or OpenWaggle application imports.
- `@openwaggle/pi-waggle` — the Pi adapter that turns Waggle core policy into a Pi extension, Pi commands, Pi session custom entries/messages, and Pi TUI rendering.

This split keeps Waggle reusable for Pi TUI and future non-Pi runtime adapters while preserving OpenWaggle's first principle that Pi is the runtime kernel for the desktop app. Waggle core defines what Waggle means; adapters decide how to execute it in a runtime.

## Decision

`@openwaggle/waggle-core` owns the portable Waggle model:

- Waggle config and validation schema
- built-in preset definitions and preset merge semantics that do not require filesystem access
- prompt construction
- turn ordering and stop policy
- consensus/file-conflict policy where it is runtime-agnostic
- generic Waggle events and run state transitions

`@openwaggle/pi-waggle` owns the Pi-specific adapter:

- Pi extension registration
- Pi commands such as `/waggle`, `/waggle <preset>`, `/waggle off`, and `/standard`
- Pi TUI rendering for Waggle mode state and turn markers
- Pi model switching from provider-qualified model references
- Pi custom entries/messages for Waggle mode state and turn metadata
- interpretation of Waggle core commands into Pi `ExtensionAPI` calls

OpenWaggle desktop owns only product-shell concerns around that Pi truth:

- collecting Waggle config in the renderer
- passing config into the Pi runtime through `src/main/adapters/pi/`
- projecting Pi Waggle custom entries/messages into SQLite read models
- rendering projected Waggle metadata in the OpenWaggle UI

Waggle runtime state must be represented in Pi session truth. OpenWaggle SQLite may cache/project state for UI speed, but it must not be the runtime source of truth for mode state or turn attribution.

The `@openwaggle/waggle-core` package is public-facing but experimental before `1.0`. Config and preset schemas should be treated as the most stable exports; engine/adapter command interfaces may evolve while the package is still experimental.

## Import Rule Clarification

The existing Pi SDK isolation rule applies to the OpenWaggle desktop app: app code outside `src/main/adapters/pi/` must not import Pi SDK types or runtime objects.

Dedicated Pi integration packages may import Pi SDKs inside their own package implementation. `@openwaggle/pi-waggle` is such a package. `@openwaggle/waggle-core` must remain Pi-free.

## Consequences

- The current OpenWaggle-owned Waggle turn loop should shrink into adapter glue and eventually disappear as runtime policy moves into `@openwaggle/pi-waggle`.
- `AgentKernelService.runWaggle(...)` should become a compatibility seam only, or be removed if standard Pi run semantics can carry Waggle config cleanly.
- OpenWaggle projection should derive assistant Waggle metadata from Pi custom entries/messages instead of assigning turn metadata after a run.
- Presets should migrate toward Pi-compatible storage after runtime truth and metadata projection are correct.
- Architecture enforcement must distinguish OpenWaggle app Pi imports from dedicated package Pi imports.
- Tests should first cover `@openwaggle/waggle-core` as pure policy, then `@openwaggle/pi-waggle` with a fake Pi extension adapter, then OpenWaggle projection and renderer behavior.

## Non-goals

- Do not build a generic universal agent runtime interface in Waggle core.
- Do not move OpenWaggle renderer, IPC, SQLite projection, or Electron concerns into Waggle packages.
- Do not make Pi TUI rendering dependent on OpenWaggle UI models.
