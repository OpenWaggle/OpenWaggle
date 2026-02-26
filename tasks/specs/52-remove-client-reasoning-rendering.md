# Spec: Remove Client Reasoning Rendering

## Context
- Request: Remove any client-rendered reasoning/thinking UI while keeping backend reasoning logic intact.
- PRD alignment: This change does not map to an existing HC-UI-* item in docs/product/ui-interaction-prd.md; it is a scoped UI behavior adjustment.

## Plan
- [x] Locate all renderer components/tests that render `thinking` message parts.
- [x] Remove reasoning render path from UI (keep message/state/backend types untouched).
- [x] Update/replace component tests to reflect no reasoning rendering.
- [x] Run targeted tests and full typecheck for touched surfaces.
- [x] Add a review section with outcomes and verification.

## Review
- Updated `MessageBubble` to ignore `thinking` parts (`.case('thinking', () => null)`), removing client rendering while preserving backend `thinking` payload flow and persistence contracts.
- Kept `ThinkingBlock` component/test files in-repo for easy future re-exposure; only the current rendering path is disabled.
- Verification:
  - `pnpm typecheck:web` ✅
  - `pnpm test:component -- src/renderer/src/components/chat/__tests__/ChatPanel.component.test.tsx src/renderer/src/components/chat/__tests__/StreamingText.component.test.tsx src/renderer/src/components/chat/__tests__/ToolCallBlock.component.test.tsx` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (100/100, no issues)
  - `pnpm lint` ✅
