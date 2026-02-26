# Spec 56: Fix Review Findings (Phase Wiring + Waggle Alias)

## Scope

- Resolve compile-breaking Waggle alias export issue in stream bridge.
- Prevent phase timer carry-over when replacing active runs.
- Prevent empty phase UI after renderer re-subscribe by bootstrapping current backend phase.

## Checklist

- [x] Fix duplicate/incorrect deprecated turn-event alias export in stream bridge.
- [x] Clear per-conversation phase state when replacing an active classic run.
- [x] Clear per-conversation phase state when replacing an active Waggle run.
- [x] Add backend phase snapshot read (`agent:get-phase`) and expose it via preload API.
- [x] Bootstrap renderer phase hook from backend snapshot with race-safe event handling.
- [x] Add/adjust unit tests for new phase snapshot behavior.
- [x] Run required validation gates.

## Review

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test:unit -- src/main/ipc/agent-handler.unit.test.ts src/main/agent/phase-tracker.unit.test.ts` ✅
- `npx -y react-doctor@latest . --verbose --diff main` ✅ (98/100, warnings only)
