# Spec — Fix Auto-Converted Attachment Send UX

## Goal

When long pasted text is auto-converted to a temporary attachment, sending should present as an attachment-first message (not a clipped text blob), while preserving full extracted content for agent processing.

## Plan Checklist

- [x] Stop rendering clipped attachment text previews for auto-generated `Pasted Text *.md` attachments in chat transcript rendering.
- [x] Keep extracted text intact for backend processing (no truncation behavior changes in payload preparation).
- [x] Prevent AGENTS scoped-resolution warnings caused by temp attachment paths outside project root.
- [x] Add unit tests for attachment preview behavior.
- [x] Add unit test for standards context filtering of external temp attachment paths.
- [x] Extend E2E to verify send-after-conversion renders attachment label and does not render long inline text snippet.

## Review

- Implemented in:
  - `src/renderer/src/hooks/useAgentChat.utils.ts`
  - `src/renderer/src/hooks/useAgentChat.utils.unit.test.ts`
  - `src/main/agent/standards-context.ts`
  - `src/main/agent/standards-context.unit.test.ts`
  - `e2e/auto-attach.e2e.test.ts`
- Verification:
  - `pnpm lint` ✅
  - `pnpm typecheck` ✅
  - `pnpm exec vitest run -c vitest.unit.config.ts src/renderer/src/hooks/useAgentChat.utils.unit.test.ts src/main/agent/standards-context.unit.test.ts` ✅
  - `pnpm build && pnpm exec playwright test e2e/auto-attach.e2e.test.ts` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (99/100, one non-blocking size warning)
