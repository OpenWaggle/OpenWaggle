# Spec 59: Record Unknown Cleanup

## Goal
Remove remaining `Record<string, unknown>` usage in application source (`src/**`) and replace with explicit typed contracts so runtime boundaries stay validated and renderer/main consumers use concrete object types.

## Plan
- [x] Replace shared tool arg/result contracts with `JsonObject`.
- [x] Replace renderer tool-arg parsing/display signatures with `JsonObject`.
- [x] Replace agent/runtime/provider quality option payloads with explicit object types.
- [x] Remove `unknownRecordSchema` alias usage in runtime code and migrate callers to named schemas.
- [x] Update dynamic settings parsing to preserve provider configs containing nested `undefined` values.
- [x] Update affected tests/mocks to keep behavior while avoiding `Record<string, unknown>`.
- [x] Run verification (`typecheck:node`, `typecheck:web`, targeted vitest suites, biome check).

## Review / Verification
- `pnpm typecheck:node` ✅
- `pnpm typecheck:web` ✅
- `pnpm vitest src/main/store/settings.unit.test.ts src/main/store/__tests__/teams.unit.test.ts src/main/ipc/voice-handler.integration.test.ts src/renderer/src/hooks/__tests__/useConversationNav.integration.test.ts src/renderer/src/hooks/__tests__/useSendMessage.integration.test.ts src/main/agent/message-mapper.unit.test.ts` ✅
- `pnpm biome check --write <touched-files>` ✅

## Notes
- A strict JSON-only parser in settings hydration caused an auth-method regression when nested `undefined` fields existed in provider records. This was fixed by a recursive settings-boundary schema that accepts `undefined` at any nesting depth.
