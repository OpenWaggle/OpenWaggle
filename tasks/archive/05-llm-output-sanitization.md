# 05 — LLM Output Sanitization

**Status:** Done
**Priority:** P1
**Severity:** Critical
**Depends on:** None
**Origin:** H-20

---

## Problem

`react-markdown` in `MessageBubble.tsx` and `StreamingText.tsx` renders LLM output directly. While `react-markdown` doesn't render raw HTML by default, the `rehype-highlight` plugin processes code blocks. If `rehypeRaw` or `dangerouslySetInnerHTML` is ever added, LLM-generated output could inject scripts.

Additionally, markdown link rendering (`[click here](javascript:alert(1))`) may not be filtered.

## Implementation

- [x] Verify that `react-markdown` is configured without `rehypeRaw` or any HTML passthrough plugin. Document this as a security invariant.
- [x] Add `rehype-sanitize` to the plugin chain as defense-in-depth.
- [x] Filter `javascript:`, `data:text/html`, and `vbscript:` URL schemes in rendered links.
- [x] Add tests that render known XSS payloads (`<img onerror=...>`, `[x](javascript:...)`, `` ```<script>``` ``) and assert no executable content in the DOM.
- [x] Apply the same markdown sanitization policy to all markdown surfaces (chat + skills preview) to prevent policy drift.

## Files to Touch

- `src/renderer/src/lib/markdown-safety.ts` — shared sanitize schema, link protocol policy, secure markdown component overrides
- `src/renderer/src/components/chat/StreamingText.tsx` — shared policy wiring for chat markdown
- `src/renderer/src/components/skills/SkillsPanel.tsx` — shared policy wiring for skills preview markdown
- `src/renderer/src/components/chat/__tests__/StreamingText.component.test.tsx` — chat markdown XSS + compatibility coverage
- `src/renderer/src/components/skills/__tests__/SkillsPanel.component.test.tsx` — skills markdown XSS + compatibility coverage

## Tests

- Component: XSS payloads in markdown produce no executable DOM elements
- Component: `javascript:` URLs are stripped from links
- Component: `rehypeRaw` plugin is not present in config
- Component: `https`, `mailto`, and `tel` URLs remain clickable
- Component: syntax highlighting classes remain present on fenced code blocks

## Risk if Skipped

A prompt injection attack that produces malicious markdown could execute JavaScript in the renderer. Combined with missing CSP (Spec 04), this escalates to full system access.

## Review Notes (2026-02-26)

- Implemented strict markdown sanitization using `rehype-sanitize` with a safe-list for highlight.js classes.
- Enforced protocol allowlist (`http`, `https`, `mailto`, `tel`) and blocked unsafe protocols (`javascript`, `vbscript`, `data`).
- Shared policy extracted to a single helper module to keep chat and skills preview behavior aligned.
