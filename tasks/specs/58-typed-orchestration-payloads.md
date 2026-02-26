# Spec 58: Typed Orchestration Payload Contracts

## Context
- User requested removing `unknown` as the default fallback type in orchestration paths and tightening type safety.
- Current orchestration engine/service/shared contracts rely on broad `unknown`/`Record<string, unknown>` payloads for task input/output/progress/model JSON.
- This task does not map to planned/future `HC-UI-*` items in `docs/product/ui-interaction-prd.md`; it is backend/shared typing hardening.

## Goals
- Replace broad `unknown` payload contracts in orchestration domain flows with explicit serializable domain types.
- Keep runtime behavior unchanged while increasing compile-time guarantees.
- Preserve runtime validation at parsing boundaries.

## Plan
- [x] Introduce shared JSON value/object types for serialized orchestration payloads.
- [x] Refactor orchestration engine + service + shared orchestration types to use those payload types instead of `unknown`.
- [x] Update validation schemas to validate JSON payload values explicitly.
- [x] Update affected orchestration tests and run targeted verification.

## Review
- Added `src/shared/types/json.ts` (`JsonValue`, `JsonObject`, `JsonArray`) as shared serialization primitives.
- Tightened orchestration contracts:
  - core engine types now use `JsonValue`/typed payload unions (`OrchestrationTaskOutputValue`, `OrchestrationProgressPayload`)
  - service planner/model-runner/runner/prompt/task-progress/tool-activity paths now consume typed payloads instead of broad unknowns.
  - shared orchestration IPC/run-record/event detail types now use explicit typed unions.
- Hardened parsing boundary:
  - `extractJson` now validates parsed payloads with `jsonValueSchema`.
  - validation schemas now export recursive `jsonValueSchema`/`jsonObjectSchema`; orchestration run outputs validate as JSON values.
- Updated orchestration tests to align with strict payload types and removed `unknown` scaffolding in key orchestration integration/unit tests.
- Verification:
  - `pnpm typecheck:node`
  - `pnpm vitest src/main/orchestration/engine/__tests__/engine.unit.test.ts src/main/orchestration/engine/__tests__/orchestrator.unit.test.ts src/main/orchestration/engine/__tests__/planner.unit.test.ts src/main/orchestration/service.unit.test.ts src/main/orchestration/service/runner.integration.unit.test.ts`
  - `pnpm biome check src/shared/types/json.ts src/main/orchestration/engine/types.ts src/main/orchestration/engine/engine.ts src/main/orchestration/engine/json.ts src/main/orchestration/engine/planner.ts src/main/orchestration/engine/orchestrator.ts src/main/orchestration/engine/index.ts src/main/orchestration/engine/__tests__/engine.unit.test.ts src/main/orchestration/engine/__tests__/orchestrator.unit.test.ts src/main/orchestration/service/types.ts src/main/orchestration/service/model-runner.ts src/main/orchestration/service/planner.ts src/main/orchestration/service/runner.ts src/main/orchestration/service/prompts.ts src/main/orchestration/service/task-progress.ts src/main/orchestration/service/tool-activity.ts src/main/orchestration/project-context.ts src/shared/types/orchestration.ts src/shared/schemas/validation.ts tasks/specs/58-typed-orchestration-payloads.md`
