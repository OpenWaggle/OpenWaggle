# Architecture and conventions

Repository-wide warnings and the architecture direction every change must respect: the
Electron main/preload/renderer split, hexagonal main process, Pi SDK imports only under
`src/main/adapters/pi/`, provider metadata mirrored from Pi, and the no-legacy-compatibility rule.
Load before any non-trivial change; it is short.

## Active Warnings

- The working tree may contain another agent's active refactor. Treat dirty files as intended future shape unless there is clear evidence otherwise.
- Legacy vendor-specific agent configuration has been removed; keep this repository centered on `AGENTS.md` and `.agents/`.
- Legacy agent memory files were removed. Add durable OpenWaggle memory here or to focused skills.
- `docs/agents/` is reserved for the adapted `/setup-matt-pocock-skills` workflow. Do not manually scaffold it during unrelated work.

## Current Architecture Direction

- OpenWaggle is an Electron desktop coding-agent UI on top of Pi.
- Main-process architecture is hexagonal: domain, ports, adapters, application services, IPC, stores.
- Pi SDK imports belong in `src/main/adapters/pi/` only.
- Provider/model/auth metadata must mirror Pi through `ModelRuntime`, project-scoped runtime services, and OpenWaggle-owned ports.
- OpenWaggle must not maintain a parallel `src/main/providers/` registry.
- OpenWaggle extension UI direction is ADR-0006: model visual contributions as surface/runtime/execution, default to a framework-neutral federated-module runtime with `mount(context)`, and do not expand placeholder route/content experiments as a parallel legacy runtime.

## Filed under "Tooling Memory"

- Do not add legacy compatibility for removed pre-Pi surfaces unless explicitly requested.
