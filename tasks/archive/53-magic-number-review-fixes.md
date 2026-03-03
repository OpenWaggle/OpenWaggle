# 53 Magic Number Review Fixes

## Plan
- [x] Tighten `scripts/check-magic-numbers.ts` so placeholder/auto-generated constant names are rejected.
- [x] Centralize repeated cross-file numeric meanings in `src/shared/constants/constants.ts` and replace local duplicates.
- [x] Rename non-semantic constants in high-risk runtime files to descriptive domain names.
- [x] Update stale docs references from removed `.mjs` scripts to `.ts`.
- [x] Run `pnpm check` and targeted tests to verify no behavior changes.

## Review
- Added shared `FIVE_MINUTES_IN_MILLISECONDS` and replaced repeated local 5-minute timeout calculations in auth/token/voice runtime paths.
- Renamed high-risk placeholder constants to semantic names in:
  - `src/main/sub-agents/sub-agent-runner.ts`
  - `src/main/ipc/agent-handler.ts`
  - `src/renderer/src/components/composer/useVoiceCapture.ts`
  - `src/main/ipc/voice-handler.ts`
  - `src/main/auth/flows/anthropic-oauth.ts`
  - `src/main/auth/oauth-callback-server.ts`
  - `src/main/auth/token-manager.ts`
- Updated stale `.mjs` references in `tasks/specs/52-magic-number-constants-inventory.md`.
- Hardened `scripts/check-magic-numbers.ts`:
  - rejects inline magic numbers
  - rejects auto-generated extraction comments
  - enforces a non-descriptive-name baseline so new placeholder constants cannot increase technical debt count
- Verification:
  - `pnpm check` ✅
  - `pnpm test:unit` ✅
