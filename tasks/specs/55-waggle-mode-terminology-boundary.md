# Spec 55 - Waggle Mode Terminology Boundary

## Context

User request: rename non-orchestration collaboration terminology to **Waggle Mode** everywhere, ensure old collaboration naming does not imply orchestration, and remove compatibility aliases.

## Scope

- Use Waggle naming as the only supported terminology in runtime code.
- Remove legacy compatibility aliases for old collaboration naming.
- Keep orchestration terminology unchanged and clearly separate from Waggle mode.
- Update Waggle icon to a more fitting icon in UI navigation surfaces.

## Out of Scope

- Behavioral redesign of orchestration.
- Changes to model/provider semantics.

## Plan

- [x] Remove compatibility alias exports from `src/shared/types/waggle.ts` and `src/shared/schemas/waggle.ts`.
- [x] Remove legacy compatibility module entry points in shared collaboration types/schemas.
- [x] Rename IPC channels/methods to Waggle-only:
  - `agent:send-waggle-message`
  - `agent:cancel-waggle`
  - `waggle:stream-chunk`
  - `waggle:turn-event`
- [x] Rename persisted conversation metadata/config keys to Waggle-only:
  - `conversation.waggleConfig`
  - `message.metadata.waggle`
- [x] Rename core Waggle implementation files/hooks/store paths away from old collaboration naming.
- [x] Sweep docs/specs/skills for leftover old collaboration references and rename to Waggle terminology.
- [x] Verify with `pnpm typecheck`, `pnpm lint`, focused tests, and React Doctor.

## Review

Implemented.

- Runtime boundaries are now Waggle-only (no compatibility aliases retained).
- IPC contract and preload API use Waggle-only channel/method names.
- Persistence keys are Waggle-only (`waggleConfig`, `metadata.waggle`).
- Waggle-specific files/hooks/store/components were renamed from old collaboration paths.
- Repository text references were cleaned so legacy collaboration wording is no longer present.
- Waggle icon remains `Waypoints` in settings nav and command palette.

Validation:

- `pnpm typecheck` passed.
- `pnpm lint` passed.
- Focused tests passed:
  - `pnpm vitest run src/main/store/__tests__/teams.unit.test.ts src/main/agent/__tests__/consensus-detector.unit.test.ts src/main/agent/__tests__/file-conflict-tracker.unit.test.ts src/renderer/src/hooks/__tests__/useSendMessage.integration.test.ts`
  - `pnpm test:component -- src/renderer/src/components/chat/__tests__/ChatPanel.component.test.tsx`
- `npx -y react-doctor@latest . --verbose --diff main` passed (score `98/100`, warnings only).
