# Spec — Auto Convert Long Prompt to Temporary Markdown Attachment

## Goal

When pasted composer input is longer than 12,000 characters, auto-convert it to a temporary `.md` attachment before submit so the full text is preserved and the inline transcript stays clean. Show a real byte-based progress bar during conversion and a completion check state when done.

## Plan Checklist

- [x] Add new IPC invoke contract and preload API method for `attachments:prepare-from-text`.
- [x] Implement main-process handler to write `{userData}/temp-attachments/prompt-{timestamp}.md`.
- [x] Return `PreparedAttachment` with full `extractedText` (no truncation path).
- [x] Add non-blocking startup cleanup for stale temp prompt attachments (>24h).
- [x] Update composer paste path to auto-convert long pasted prompts when attachment slots are available.
- [x] Add toast and fallback behavior when conversion fails.
- [x] Add/extend integration tests for new IPC handler behavior.
- [x] Add E2E test coverage for long prompt conversion and short prompt passthrough.
- [x] Update UI PRD (`HC-UI-008`) with the new behavior.
- [x] Run verification commands: typecheck, lint, integration tests, e2e, react-doctor.

## Review

- Implemented on branch `codex/feat/auto-convert-long-prompt-attachment`.
- Verification:
  - `pnpm typecheck` ✅
  - `pnpm lint` ✅
  - `pnpm test:integration` ⚠️ fails due unrelated existing failures in orchestration/sub-agent/conversation suites; new attachment integration tests pass.
  - `pnpm exec vitest run -c vitest.integration.config.ts src/main/ipc/attachments-handler.integration.test.ts` ✅
  - `pnpm test:e2e` ✅ (includes long-paste progress UI assertions in `e2e/auto-attach.e2e.test.ts`)
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (99/100, warning only)
