# 24 — Feature Surface Area Audit

**Status:** Planned
**Priority:** P4
**Severity:** Strategic
**Depends on:** None
**Origin:** H-23

---

## Problem

The v0.1 ships with: voice input (Whisper), OCR (tesseract.js), DOCX parsing (mammoth), PDF extraction (pdf-parse), xterm terminal, diff panel, skills system, orchestration pipeline, and 6 LLM providers. Each is a maintenance surface. None of them are the product differentiator (waggle).

The risk is not that these features are bad — they're well-built. The risk is that maintaining them consumes time that should go to the core product.

## Implementation

- [ ] Categorize every feature as "core for waggle MVP" or "defer"
- [ ] For deferred features: don't remove them, but stop investing. No bug fixes, no enhancements, no tests. If they break, disable them behind a flag
- [ ] Suggested core set: agent loop, tool system, provider registry (2-3 providers), conversation persistence, basic chat UI
- [ ] Add a `FEATURE_FLAGS` constant (or settings toggle) that allows disabling voice, OCR, orchestration, terminal, and diff panel

## Files to Touch

- `src/main/index.ts` — feature flag checks
- `src/renderer/src/` — conditional rendering based on flags
- `src/shared/` — feature flags type/constant

## Tests

- Unit: disabled feature's IPC handler returns "feature disabled" error
- Unit: UI hides disabled feature's controls
