# 05 — LLM Output Sanitization

**Status:** Planned
**Priority:** P1
**Severity:** Critical
**Depends on:** None
**Origin:** H-20

---

## Problem

`react-markdown` in `MessageBubble.tsx` and `StreamingText.tsx` renders LLM output directly. While `react-markdown` doesn't render raw HTML by default, the `rehype-highlight` plugin processes code blocks. If `rehypeRaw` or `dangerouslySetInnerHTML` is ever added, LLM-generated output could inject scripts.

Additionally, markdown link rendering (`[click here](javascript:alert(1))`) may not be filtered.

## Implementation

- [ ] Verify that `react-markdown` is configured without `rehypeRaw` or any HTML passthrough plugin. Document this as a security invariant.
- [ ] Add `rehype-sanitize` to the plugin chain as defense-in-depth.
- [ ] Filter `javascript:`, `data:text/html`, and `vbscript:` URL schemes in rendered links.
- [ ] Add a test that renders known XSS payloads (`<img onerror=...>`, `[x](javascript:...)`, `` ```<script>``` ``) and asserts no executable content in the DOM.

## Files to Touch

- `src/renderer/src/components/chat/MessageBubble.tsx` — add `rehype-sanitize`
- New test file for XSS payload rendering

## Tests

- Component: XSS payloads in markdown produce no executable DOM elements
- Component: `javascript:` URLs are stripped from links
- Component: `rehypeRaw` plugin is not present in config

## Risk if Skipped

A prompt injection attack that produces malicious markdown could execute JavaScript in the renderer. Combined with missing CSP (Spec 04), this escalates to full system access.
