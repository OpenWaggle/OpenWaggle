# Adopt Main-Process Hexagonal Architecture

Status: accepted

OpenWaggle adopted hexagonal architecture for the Electron main process so runtime execution, persistence, IPC, and vendor integrations do not leak into each other. The main process is split into domain logic, Effect ports, adapters, application services, IPC transport, and store-backed infrastructure. This keeps Pi and other vendor SDKs behind adapters while letting application code depend on OpenWaggle-owned contracts.

The main-process rulebook lives in `docs/hexagonal-architecture.md`. This ADR records why that split exists: without a structural boundary, IPC handlers, SQLite stores, and runtime adapters tend to collapse into tightly coupled orchestration code that is hard to test and unsafe to evolve.

## Consequences

- Pi SDK imports in the OpenWaggle desktop app are allowed only inside `src/main/adapters/pi/`; ADR-0004 clarifies the exception for dedicated Pi packages under `packages/pi-*`.
- IPC handlers should stay transport-oriented and delegate business logic.
- Application services consume ports instead of stores or vendor SDKs directly.
- Architecture boundaries are enforced by ESLint through `pnpm lint` and `pnpm check`.
