# 53 — Streaming Rendering Performance & Shiki Syntax Highlighting

**Status:** Not Started
**Priority:** P0 — Ship-blocking
**Category:** Performance / Enhancement
**Depends on:** None
**Enables:** Spec 58 (Enhanced Diff Rendering — uses Shiki for syntax-highlighted diffs)
**Origin:** T3Code competitive analysis + streaming jank during waggle and normal mode.

---

## Problem

### A. Streaming Rendering is O(n²) — The App Feels Slow

`StreamingText` runs the **full ReactMarkdown pipeline on every single chunk**: remark parse → rehype transform → rehype-highlight → React reconcile. For a 2000-word response streamed in 200 chunks, that's 200 full parses of increasingly large text. This is O(n²) over the lifetime of a response.

React Compiler is enabled (`babel-plugin-react-compiler`) and auto-memoizes components — but memoization **cannot help** when the primary prop (`text`) changes on every chunk. The component must re-render because its input genuinely changed.

The result: the app feels sluggish during streaming, especially for long responses with code blocks. This is the single biggest UX issue for first impressions.

### B. Code Highlighting is Expensive and Uncached

OpenWaggle uses highlight.js via `rehype-highlight` (in `src/renderer/src/lib/markdown-safety.tsx`, line 64) for code syntax highlighting. This has several limitations:

1. **Grammar accuracy** — highlight.js uses regex-based grammars that produce inferior results compared to TextMate grammars (used by VS Code). Common issues: incorrect scoping of template literals, JSX expressions, type annotations in TypeScript.
2. **No caching** — During LLM streaming, every new token triggers a full re-render of ReactMarkdown, which re-highlights every code block from scratch. For conversations with many code blocks, this creates redundant work.
3. **Limited theme support** — highlight.js themes are CSS-based with less granular token scoping than Shiki's TextMate-based themes.
4. **No streaming awareness** — Incomplete code blocks (mid-stream) are highlighted identically to complete blocks, wasting cache space and sometimes producing incorrect highlights for partial syntax.

t3code solves this with Shiki (same highlighting engine as VS Code) plus an LRU cache with streaming-aware invalidation — only caching finalized code blocks and using content-hash keys for efficient deduplication.

### Current Implementation

- `rehype-highlight` plugin in `safeMarkdownSanitizeSchema` (line 64 of `markdown-safety.tsx`)
- Sanitize schema allows `hljs*` and `language-*` CSS classes (lines 12-16, 57-59)
- No caching layer — every render re-highlights all code blocks
- `CodeBlock.tsx` renders code blocks in chat messages
- `StreamingText` always renders through ReactMarkdown (no plain-text fallback per CLAUDE.md)

## Implementation

### Phase 0A: Streaming Render Throttling (Highest Priority)

The single biggest performance win. Reduce the number of ReactMarkdown re-renders during streaming from ~200 per response to ~30.

- [ ] Create `src/renderer/src/hooks/useThrottledStreamText.ts`:
  - Accepts the raw streaming `text` prop
  - Batches updates to ~60fps (one update per `requestAnimationFrame` or 16ms interval)
  - Returns a throttled text value that updates at most 60 times/second
  - On stream end (status changes from `streaming` to `ready`), immediately flush to final value
- [ ] Update `StreamingText.tsx` to use throttled text during streaming:
  - While streaming: use throttled value → ReactMarkdown renders ~60 times/second max
  - After streaming: use final value → one clean render with all content
- [ ] Measure before/after:
  - Target: <16ms per render frame during streaming
  - Target: no visible jank or stutter when scrolling during streaming

**Why this works:** ReactMarkdown's parse cost per render is roughly proportional to text length. Reducing renders from 200 to 30 means the total parse work drops ~6x, AND each parse runs on a slightly larger text (less overhead per-character). The user sees smooth text appearing at 60fps instead of janky bursts.

### Phase 0B: Collapsible Tool Traces (All Modes)

Reduce visual noise and improve readability across all modes — normal chat, waggle, and synthesis.

- [ ] Tool call blocks are **collapsed by default** after completion:
  - Show: tool name + brief status (success/error) + duration
  - Hidden by default: full arguments, full result content
  - Click to expand
- [ ] During streaming / active execution: tool calls are **expanded** (user watches progress)
- [ ] After the tool call completes: auto-collapse with animation
- [ ] In waggle mode, per-turn summary header:
  - Agent identity (label + model)
  - Tool call count badge (e.g., "12 tools")
  - Turn text/prose remains fully visible — only tool traces collapse
- [ ] Apply consistently across all modes — this is a chat rendering standard, not waggle-specific

**Files to modify:**
- `src/renderer/src/components/chat/useVirtualRows.ts` — tool call row collapse state
- Tool call rendering components — add expand/collapse toggle
- Waggle turn header components — add summary badges

### Phase 1: Shiki Core Integration

- [ ] Install `shiki` package (includes core, themes, and grammars as WASM)
- [ ] Create `src/renderer/src/lib/shiki/highlighter.ts`:
  - Lazy-load Shiki highlighter instance via `createHighlighter()`
  - Pre-load common language grammars on init: `typescript`, `javascript`, `json`, `bash`, `python`, `css`, `html`, `markdown`, `yaml`, `sql`, `rust`, `go`
  - Dynamic grammar loading for uncommon languages (on-demand via `highlighter.loadLanguage()`)
  - Export `getHighlighter(): Promise<Highlighter>` singleton getter
  - Theme: `github-dark` for current dark theme; prepare for future light mode with `github-light`
- [ ] Create `src/renderer/src/lib/shiki/rehype-shiki-plugin.ts`:
  - Custom rehype plugin that replaces `rehype-highlight`
  - Visits `<code>` elements with `language-*` class
  - Calls Shiki `codeToHast()` to generate highlighted HAST nodes
  - Falls back to unhighlighted code if grammar not loaded yet (avoids blocking render)
  - Handles language detection from class name (`language-typescript` → `typescript`)
- [ ] Update `src/renderer/src/lib/markdown-safety.tsx`:
  - Replace `rehypeHighlight` import with new `rehypeShikiPlugin`
  - Update `safeMarkdownSanitizeSchema` to allow Shiki's output classes (Shiki uses inline `style` attributes with `color` properties, not CSS classes)
  - Add `style` to allowed attributes for `<span>` elements within `<code>` blocks
  - Remove `highlight.js` CSS class patterns from schema

### Phase 2: LRU Cache

- [ ] Create `src/renderer/src/lib/shiki/shiki-cache.ts`:
  - LRU cache implementation keyed by `hash(language + code)`
  - Hash function: fast content hash (e.g., `cyrb53` or similar lightweight hash)
  - Cache stores pre-highlighted HAST nodes (not HTML strings — avoids re-parsing)
  - **Capacity limits:**
    - Max entries: 500 (matching t3code's approach)
    - Max total size: ~50MB estimated (track approximate node tree size per entry)
  - Eviction: LRU — least recently accessed entries evicted first
  - API: `get(language, code): HastNode | undefined`, `set(language, code, hast): void`, `invalidate(language, code): void`
- [ ] Integrate cache into `rehype-shiki-plugin.ts`:
  - Before highlighting: check cache for `(language, code)` pair
  - Cache hit → return cached HAST nodes (skip Shiki call)
  - Cache miss → call Shiki, store result, return
  - Log cache hit rate periodically for debugging (renderer logger)

### Phase 3: Streaming-Aware Invalidation

- [ ] Pass `isStreaming` context through ReactMarkdown rendering:
  - `StreamingText.tsx` knows if content is streaming (via chat store `status === 'streaming'`)
  - Pass `isStreaming` as a context value accessible by rehype plugins
  - Options: React context around ReactMarkdown, or custom remarkPlugin that annotates nodes
- [ ] Update `rehype-shiki-plugin.ts` with streaming awareness:
  - **During streaming (`isStreaming === true`):**
    - Still highlight code blocks (no plain-text fallback per CLAUDE.md performance section)
    - Do NOT cache results (code blocks are incomplete and will change on next token)
    - Use a lighter-weight "streaming mode" that skips cache lookup too (avoid polluting LRU)
  - **After streaming completes (`isStreaming === false`):**
    - All code blocks are finalized — cache their highlights
    - On the first non-streaming render after streaming ends, populate cache for all code blocks in the message
- [ ] Handle the streaming → finalized transition efficiently:
  - When streaming ends, the message re-renders once with `isStreaming=false`
  - This single re-render highlights + caches all blocks in the message
  - Subsequent re-renders (scroll, window resize) hit cache

### Phase 4: Cleanup & Optimization

- [ ] Remove `highlight.js` and `rehype-highlight` from `package.json` dependencies
- [ ] Remove highlight.js CSS imports (if any global stylesheet references exist)
- [ ] Remove highlight.js class patterns from `safeMarkdownSanitizeSchema` (lines 12-16, 57-59 of `markdown-safety.tsx`)
- [ ] Update `CodeBlock.tsx` if it has any highlight.js-specific logic
- [ ] Verify Shiki WASM files are included in electron-vite build output:
  - Shiki grammars are loaded as WASM — ensure `electron.vite.config.ts` handles WASM assets
  - May need `assetsInclude: ['**/*.wasm']` in Vite config
  - Test that grammars load correctly in production build (not just dev)
- [ ] Measure and document performance:
  - Cache hit rate during typical conversation (expect >80% after first render)
  - Highlight latency for common languages (target: <5ms per block from cache)
  - Memory usage with 500-entry cache
  - First-render latency for uncommon language grammar loading

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/src/lib/shiki/highlighter.ts` | Singleton Shiki highlighter with lazy grammar loading |
| `src/renderer/src/lib/shiki/rehype-shiki-plugin.ts` | Custom rehype plugin replacing rehype-highlight |
| `src/renderer/src/lib/shiki/shiki-cache.ts` | LRU cache for highlighted code blocks |

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/src/lib/markdown-safety.tsx` | Replace `rehypeHighlight` with `rehypeShikiPlugin`, update sanitize schema |
| `src/renderer/src/components/thread/StreamingText.tsx` | Pass `isStreaming` context for cache-awareness |
| `electron.vite.config.ts` | Ensure WASM asset handling for Shiki grammars |
| `package.json` | Add `shiki`, remove `highlight.js` + `rehype-highlight` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| WASM loading latency on first render | Medium | Pre-load 12 common grammars at app startup; fallback to unhighlighted code for unknown languages |
| Bundle size increase (~200KB core + WASM per grammar) | Medium | Dynamic grammar imports; only bundle common grammars; others loaded on demand |
| Shiki inline styles vs CSP | Medium | Current CSP allows `'unsafe-inline'` for styles; Shiki's inline color styles are compatible |
| Production build WASM resolution | High | Explicit test in Phase 4; may need electron-vite config for WASM assets |
| Performance regression during streaming | Low | CLAUDE.md says ReactMarkdown handles streaming fine; Shiki adds ~1-2ms per block |

## Definition of Done

1. All code blocks render with Shiki TextMate grammars (visual quality matching VS Code)
2. LRU cache has >80% hit rate on subsequent renders of finalized messages
3. Streaming code blocks render correctly (highlighted but not cached until finalized)
4. `highlight.js` and `rehype-highlight` fully removed from dependencies
5. Production build (macOS/Linux/Windows) correctly loads Shiki WASM grammars
6. No CSP violations from Shiki's inline styles
7. No visual regression in existing code block styling (copy button, language label, scroll behavior)
8. Performance: cache lookup <1ms, highlight <10ms for typical blocks

## Testing Strategy

- **Unit tests:** `shiki-cache.unit.test.ts`:
  - Cache hit returns stored HAST nodes
  - Cache miss returns undefined
  - LRU eviction when at capacity
  - Size budget enforcement
  - Invalidation removes entry
- **Unit tests:** `rehype-shiki-plugin.unit.test.ts`:
  - Highlights TypeScript code correctly
  - Falls back gracefully for unknown language
  - Skips caching when streaming
  - Populates cache when not streaming
- **Component tests:** Code block rendering:
  - Verify Shiki output structure in rendered code blocks
  - Verify streaming → finalized transition populates cache
  - Verify no highlight.js class artifacts remain
- **Integration tests:** Production build:
  - WASM grammars resolve correctly
  - Dynamic grammar loading works for uncommon language
