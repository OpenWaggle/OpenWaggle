# Spec — Composer SRP Refactor for Auto Text Attachment

## Goal

Extract long-paste auto-convert logic and inline progress chip rendering out of `Composer.tsx` into a dedicated hook + presentational component, while preserving behavior.

## Plan Checklist

- [x] Create `useAutoTextAttachment` hook with:
  - long-paste interception decision logic,
  - IPC conversion orchestration,
  - progress subscription,
  - pending chip state + cleanup,
  - stable helpers consumed by `Composer`.
- [x] Create `PendingTextAttachmentChips` component for rendering pending/completed inline progress chip UI.
- [x] Update `Composer.tsx` to delegate auto-attach responsibilities to hook/component and keep orchestration-only responsibilities.
- [x] Keep existing behavior unchanged:
  - conversion on paste (not Enter),
  - real progress updates,
  - graceful preload feature-detection fallback,
  - no duplicate chip for the same auto-attachment.
- [x] Run verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm exec playwright test e2e/auto-attach.e2e.test.ts`

## Review

- Refactor implemented with:
  - `src/renderer/src/components/composer/useAutoTextAttachment.ts`
  - `src/renderer/src/components/composer/AutoTextAttachmentChips.tsx`
  - `src/renderer/src/components/composer/Composer.tsx` (integration only)
- Verification:
  - `pnpm lint` ✅
  - `pnpm typecheck` ✅
  - `pnpm exec playwright test e2e/auto-attach.e2e.test.ts` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (99/100, one non-blocking size warning)
