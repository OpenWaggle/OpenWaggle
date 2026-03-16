# 53 — Streaming Rendering Performance & Shiki Syntax Highlighting

**Status:** Implemented ✅
**Priority:** P0
**Category:** Performance / Enhancement

## What was done

### Phase 0A — Streaming render throttle
- Added `useThrottledStreamText` hook — batches visible text updates behind rAF at 60fps during streaming
- `StreamingText` now accepts `isStreaming` prop and throttles during active streaming only
- Final flush always renders immediately (no delay on completion)

### Phase 0B — Synthesis-first UI
- `MessageBubble` split into focused components: `UserMessageBubble`, `AssistantMessageBubble`, `ToolCallRouter`, `message-bubble-utils.ts`, `AgentLabel`, `CollapsibleDetails`
- `useMessageCollapse` hook extracts collapse logic
- Completed messages collapse to synthesis/final answer by default
- Tool calls and intermediate text hidden behind toggle
- Conditional synthesis prompt injection gated on `context.hasProject`

### Shiki syntax highlighting
- Replaced `highlight.js` / `rehype-highlight` with Shiki
- `src/renderer/src/lib/shiki/highlighter.ts` — singleton Shiki highlighter
- `src/renderer/src/lib/shiki/rehype-shiki-plugin.ts` — unified rehype plugin
- `src/renderer/src/lib/shiki/shiki-cache.ts` — LRU cache for finalized highlights
- Streaming-aware: skips cache writes during streaming

### Incremental markdown renderer
- `useIncrementalMarkdown` hook splits streamed text into stable prefix + live tail
- Prefix HAST cached and only reparsed on paragraph boundary change
- `IncrementalMarkdown` component renders prefix from HAST + tail via ReactMarkdown

### Chat list virtualisation removed
- Replaced Virtuoso with plain scrollable `<div>` — no virtualisation needed at chat scale
- All scroll logic extracted into `useChatScrollBehaviour` hook (Voyager pattern)
- Scroll-to-user-message: `element.offsetTop - PADDING_TOP` formula, direct ref, `[overflow-anchor:none]`
- Renamed: `VirtualRow` → `ChatRow`, `VirtualRowRenderer` → `ChatRowRenderer`, etc.

### Other
- Logger timestamps added to console output (`HH:mm:ss.mmm`)
- Phase elapsed `0s` hidden until > 0
- Chromium scrollbars thinned to 4px
- Firefox-only CSS removed

## How to test
1. `pnpm dev` in `feat/spec-53-streaming-perf` worktree
2. Open any conversation and send a message — user message should smoothly scroll near top
3. During streaming — response streams below user message
4. Code blocks — Shiki syntax highlighting (VS Code–quality, themed)
5. Completed messages — collapse to synthesis by default, "Show details" toggle reveals tool calls
6. Resize the window — scroll space adapts correctly
