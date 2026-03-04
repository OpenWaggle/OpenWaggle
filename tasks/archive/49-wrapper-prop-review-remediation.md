# Spec 49 - Wrapper/Prop Pattern Remediation

## Goal
Resolve code-review findings around hidden prop drilling and oversized prop contracts while preserving current behavior.

## Scope
- Remove `ChatPanel` controller sync-store churn pattern.
- Replace mega controller bag wiring with focused section props.
- Reduce large prop interface in `ModelSelector` dropdown wiring.
- Reduce large prop interface in `WaggleSection` `AgentSlotCard`.
- Update affected tests and run verification.

## Plan
- [x] Refactor chat panel composition to remove `chat-panel-controller-store` usage.
- [x] Split chat panel contracts into focused section contracts (transcript/composer/diff).
- [x] Refactor `ModelSelector` dropdown to avoid oversized prop interface contract.
- [x] Refactor `WaggleSection` `AgentSlotCard` to use compact contract.
- [x] Update tests and run `pnpm check`.

## Review
Completed.

### What changed
- Removed `chat-panel-controller-store` synchronization pattern and rewired chat composition to pass focused section contracts from `ChatPanel` to `ChatTranscript`, `ChatComposerStack`, and `ChatDiffPane`.
- Replaced monolithic `useChatPanelController()` return contract with `useChatPanelSections()` (`transcript`, `composer`, `diff`) so chat concerns are grouped by rendering boundary.
- Collapsed `ModelSelectorDropdown` pass-through contract by moving dropdown wiring into focused helper options (`refs/state/actions`) and keeping `ModelSelector` orchestration compact.
- Reduced `WaggleSection` `AgentSlotCard` prop surface by passing `{ agent, index, dispatchForm }` instead of many per-field props.
- Updated `ChatPanel` component tests to mock `useChatPanelSections()`.

### Verification
- `pnpm check` ✅
- `npx -y react-doctor@latest . --verbose --diff main` ✅ (100/100)
- `pnpm exec vitest run -c vitest.component.config.ts src/renderer/src/components/chat/__tests__/ChatPanel.component.test.tsx src/renderer/src/components/shared/__tests__/ModelSelector.component.test.tsx` ✅
