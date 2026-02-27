# Spec: Differentiate Reasoning Part Type From Phase Labels

## Context
- Goal: distinguish model reasoning content from UI phase/state labels.
- Message-part type should be `reasoning` (not `thinking`).
- Phase labels (Thinking/Researching/etc.) remain as-is.
- Backward compatibility needed for persisted conversations containing `thinking` parts.

## Plan
- [x] Rename shared message part type from `thinking` to `reasoning`.
- [x] Update main stream collector to emit `reasoning` parts.
- [x] Keep persistence backward-compatible by reading both `thinking` and `reasoning`, normalizing to `reasoning`.
- [x] Update renderer mappings to ignore `reasoning` parts (current hidden behavior).
- [x] Update unit tests impacted by type rename.
- [x] Run typecheck + targeted tests + lint (and react-doctor only if renderer behavior/UI changed).

## Review
- Changed internal message-part contract to use `type: 'reasoning'` in shared types and stream collection.
- Preserved backward compatibility for persisted data by accepting both `thinking` and `reasoning` in conversation parsing and normalizing legacy `thinking` entries to `reasoning`.
- Kept phase/state labels unchanged (`Thinking`, `Researching`, etc. in `useStreamingPhase`) so status UX remains stable.
- Preserved TanStack boundary compatibility in renderer message rendering, where `UIMessage` may still expose `thinking` parts.
- Verification:
  - `pnpm typecheck` ✅
  - `pnpm test:unit -- src/main/agent/stream-part-collector.unit.test.ts src/shared/utils/decision.unit.test.ts` ✅
  - `pnpm test:integration -- src/main/store/conversations.integration.test.ts` ✅
  - `pnpm lint` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (`100/100`)
