# 52 — Rich Chat Composer: Lexical Editor with Mentions

**Status:** Not Started
**Priority:** P1
**Category:** Feature
**Depends on:** None (file mentions independent; symbol mentions benefit from Spec 29/31)
**Origin:** T3Code competitive analysis — t3code uses Lexical editor for chat composer with @-mention nodes, VSCode-style file icons, file path autocompletion. Reference: [t3code](https://github.com/pingdotgg/t3code) web app composer.

---

## Problem

The current chat composer in `src/renderer/src/components/composer/Composer.tsx` (line 349) is a plain `<textarea>` with manual keybinding handlers. While functional, it lacks:

1. **Inline file references** — Users can attach files (max 5 via chip UI) but cannot reference project files inline in their prompt text with autocompletion
2. **Symbol references** — No way to reference specific functions, classes, or types from the codebase
3. **URL enrichment** — Pasted URLs render as plain text with no preview or rich formatting
4. **Rich text foundation** — A textarea cannot host inline decorated nodes (icons, chips, badges)

t3code solves this with a Lexical editor that supports @-mention nodes with VSCode-style file type icons and real-time file path autocompletion. This makes it significantly faster to precisely reference project context in prompts.

### What We Keep

All existing behavior must be preserved:
- Enter to submit, Shift+Enter for newline (line 204)
- ArrowUp/Down prompt history navigation (lines 213-230)
- `/` trigger for command palette at start or after whitespace (lines 238-241)
- Paste handling via `useAutoTextAttachment` (lines 136-148)
- Voice capture mode with `useVoiceCapture` (line 131)
- File attachment chips (max 5, lines 268-282)
- Approval queue enqueuing during agent loading (lines 94-98)
- Plan mode flag in payload (lines 69, 116)
- Auto-resizing on input (lines 187-189)
- Cursor position tracking (lines 246-248)

## Implementation

### Phase 1: Lexical Foundation (Replace Textarea)

- [ ] Install dependencies: `lexical`, `@lexical/react`, `@lexical/plain-text`, `@lexical/history`, `@lexical/utils`
- [ ] Create `src/renderer/src/components/composer/editor/` directory for Lexical modules
- [ ] Create `ComposerEditor.tsx` — Lexical `<LexicalComposer>` wrapper with:
  - `PlainTextPlugin` for text input (not rich text — we want plain text output)
  - `HistoryPlugin` for undo/redo
  - `OnChangePlugin` for state tracking
  - Custom `AutoFocusPlugin` to match current textarea auto-focus behavior
- [ ] Create `EditorKeyboardPlugin.tsx` — handles:
  - Enter → submit (reads Lexical state, extracts text + mention metadata)
  - Shift+Enter → insert paragraph node
  - ArrowUp at position 0 → prompt history up
  - ArrowDown at end → prompt history down
  - `/` at start or after whitespace → command palette trigger
- [ ] Create `EditorPastePlugin.tsx` — integrates with `useAutoTextAttachment` hook for paste handling
- [ ] Create `extractPlainText(editorState: EditorState): string` utility that:
  - Converts text nodes → raw text
  - Converts `FileMentionNode` → `@path/to/file`
  - Converts `SymbolMentionNode` → `@ClassName.method`
  - Converts `URLMentionNode` → raw URL
- [ ] Replace `<textarea>` in `Composer.tsx` with `<ComposerEditor>`, preserving all surrounding UI (attachment chips, voice controls, toolbar)
- [ ] Ensure auto-resize behavior works with Lexical's content editable div (CSS `min-height: 60px`, grow with content)

### Phase 2: File Mention Nodes (`@file/path`)

- [ ] Create `FileMentionNode.ts` — custom Lexical `DecoratorNode`:
  - Displays as inline chip with file-type icon (from `src/renderer/src/lib/file-icons.ts` or new VSCode-style icon map) + truncated file name
  - Stores full relative path as data
  - Serializes to `@path/to/file` in plain text export
  - Non-editable inline decoration (cursor skips over it)
- [ ] Create `file-icons.ts` — maps file extensions to SVG icons (or use `vscode-icons` package):
  - `.ts/.tsx` → TypeScript icon (blue)
  - `.js/.jsx` → JavaScript icon (yellow)
  - `.json` → JSON icon (gray)
  - `.md` → Markdown icon
  - `.css/.scss` → Style icon
  - `.py` → Python icon
  - Fallback generic file icon
- [ ] Create `MentionTypeaheadPlugin.tsx` — Lexical plugin:
  - Triggers on `@` character typed
  - Opens floating dropdown below cursor position
  - Queries main process for file suggestions via IPC
  - Keyboard navigation: ArrowUp/Down to select, Enter to confirm, Escape to dismiss
  - Shows icon + relative path for each suggestion
  - Debounced query (150ms) as user types after `@`
  - Max 10 suggestions visible, scrollable
- [ ] Add IPC channel `'composer:file-suggest'` to `IpcInvokeChannelMap` in `src/shared/types/ipc.ts`:
  ```typescript
  'composer:file-suggest': {
    args: [projectPath: string, query: string, limit?: number]
    return: Array<{ path: string; type: 'file' | 'directory' }>
  }
  ```
- [ ] Implement `composer-suggest-handler.ts` in `src/main/ipc/`:
  - Uses fast-glob to search project files matching query
  - Respects `.gitignore` patterns (via `ignore` option)
  - Excludes `node_modules`, `.git`, common binary extensions
  - Returns sorted by relevance (exact prefix match first, then fuzzy)
  - Limit default 20 results
- [ ] Add `composerFileSuggest` method to `OpenWaggleApi` in `src/shared/types/ipc.ts` and implement in `src/preload/api.ts`

### Phase 3: Symbol Mention Nodes (`@Symbol`)

- [ ] Create `SymbolMentionNode.ts` — custom Lexical `DecoratorNode`:
  - Displays as inline chip with symbol-type icon (function ƒ, class C, interface I, type T) + symbol name
  - Stores qualified name (e.g., `MyClass.myMethod`) and file path as data
  - Serializes to `@SymbolName` in plain text export
  - Different visual style from file mentions (e.g., purple badge vs blue)
- [ ] Add IPC channel `'composer:symbol-suggest'` to `IpcInvokeChannelMap`:
  ```typescript
  'composer:symbol-suggest': {
    args: [projectPath: string, query: string, limit?: number]
    return: Array<{ name: string; kind: 'function' | 'class' | 'interface' | 'type' | 'variable'; filePath: string; line: number }>
  }
  ```
- [ ] Implement `composer-symbol-handler.ts` in `src/main/ipc/`:
  - **If codebase index exists** (Spec 29/31): Query the index for matching symbols
  - **If no index**: Graceful degradation — return empty array, typeahead shows "Index not built" hint
  - This handler is a consumer of the indexing system, not an implementation of it
- [ ] Extend `MentionTypeaheadPlugin.tsx` to detect mention type:
  - `@` followed by `/` or lowercase → file path mode
  - `@` followed by uppercase letter → symbol mode
  - Show appropriate suggestions and icons per mode
  - Tab key to switch between file/symbol mode in dropdown

### Phase 4: URL Mention Nodes

- [ ] Create `URLMentionNode.ts` — custom Lexical `DecoratorNode`:
  - Displays as inline chip with favicon (loaded async) + URL hostname + path preview
  - Stores full URL as data
  - Serializes to raw URL in plain text export
  - Visual: subtle link-blue background, external link icon
- [ ] Create `URLAutoDetectPlugin.tsx` — Lexical plugin:
  - Detects URLs on paste (regex match for `https?://...` patterns)
  - Auto-converts pasted URLs to `URLMentionNode`
  - Also detects manually typed URLs when user types space or Enter after a URL pattern
  - Validates URL format via `URL` constructor before converting
  - Respects security: only `https://` and `http://` protocols
- [ ] Add IPC channel `'composer:url-preview'` to `IpcInvokeChannelMap`:
  ```typescript
  'composer:url-preview': {
    args: [url: string]
    return: { title: string; favicon: string | null } | null
  }
  ```
- [ ] Implement `composer-url-handler.ts` in `src/main/ipc/`:
  - Fetch URL title and favicon via lightweight HEAD + HTML parse
  - Cache results in memory (LRU, 100 entries)
  - Timeout: 3 seconds max
  - Return null on failure (chip shows URL without title)

### Phase 5: Integration & Polish

- [ ] Create `EditorTheme.ts` — Lexical theme configuration matching current Tailwind v4 styling
- [ ] Ensure voice mode integration: when voice capture activates, Lexical editor state is properly managed (clear, restore draft)
- [ ] Wire prompt history: ArrowUp loads previous prompt into Lexical editor state (not textarea value)
- [ ] Wire command palette: `/` trigger reads current Lexical text content for palette filtering
- [ ] Ensure attachment chips remain outside Lexical editor (in surrounding Composer UI), not inside editor content
- [ ] Handle focus management: clicking attachment area shouldn't defocus editor; editor should refocus after command palette closes
- [ ] Screen reader accessibility: mention nodes should have ARIA labels (e.g., "File: src/main/index.ts")

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/src/components/composer/editor/ComposerEditor.tsx` | Main Lexical editor wrapper |
| `src/renderer/src/components/composer/editor/EditorKeyboardPlugin.tsx` | Keybinding handler plugin |
| `src/renderer/src/components/composer/editor/EditorPastePlugin.tsx` | Paste integration plugin |
| `src/renderer/src/components/composer/editor/MentionTypeaheadPlugin.tsx` | @-mention autocomplete dropdown |
| `src/renderer/src/components/composer/editor/URLAutoDetectPlugin.tsx` | Auto-convert URLs to mention nodes |
| `src/renderer/src/components/composer/editor/nodes/FileMentionNode.ts` | File path mention node |
| `src/renderer/src/components/composer/editor/nodes/SymbolMentionNode.ts` | Code symbol mention node |
| `src/renderer/src/components/composer/editor/nodes/URLMentionNode.ts` | URL mention node |
| `src/renderer/src/components/composer/editor/EditorTheme.ts` | Lexical theme config |
| `src/renderer/src/components/composer/editor/extract-plain-text.ts` | State → plain text serializer |
| `src/renderer/src/lib/file-icons.ts` | File extension → icon mapping |
| `src/main/ipc/composer-suggest-handler.ts` | File suggestion IPC handler |
| `src/main/ipc/composer-symbol-handler.ts` | Symbol suggestion IPC handler |
| `src/main/ipc/composer-url-handler.ts` | URL preview IPC handler |

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/src/components/composer/Composer.tsx` | Replace `<textarea>` with `<ComposerEditor>` |
| `src/shared/types/ipc.ts` | Add 3 new IPC channels |
| `src/preload/api.ts` | Add 3 new API methods |
| `src/main/index.ts` | Register new IPC handlers |
| `package.json` | Add Lexical dependencies |

## Cross-References

- **Spec 29 (Codebase Indexing)** — Symbol mentions consume the indexing system. File mentions work independently.
- **Spec 31 (Semantic Indexing)** — AST layer provides symbol data for `SymbolMentionNode`. Graceful degradation if unavailable.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Lexical learning curve | Medium | Start with Phase 1 (plain text only), iterate |
| Regression of existing behavior | High | Full component test matrix for all existing keybindings and features |
| Symbol mentions without index | Low | Graceful degradation with "Index not built" hint |
| Lexical bundle size (~50KB gzip) | Low | Acceptable for the feature value |
| Performance with many mention nodes | Low | Lexical handles this natively; limit to reasonable message sizes |

## Definition of Done

1. Lexical editor replaces textarea with zero behavior regression
2. `@` triggers file mention typeahead with autocompletion from project files
3. Symbol mentions show when typing `@UpperCase` (degrades gracefully without index)
4. Pasted URLs auto-convert to rich URL chips with title/favicon
5. All existing keybindings work: Enter submit, Shift+Enter newline, ArrowUp/Down history, `/` command palette
6. Voice mode, paste handling, attachment chips all work unchanged
7. Accessibility: mention nodes have proper ARIA labels
8. Component tests cover: all 3 mention types, keyboard navigation, submit, history, command palette trigger

## Testing Strategy

- **Unit tests:** `extract-plain-text.ts` with various mention node combinations
- **Component tests:** `ComposerEditor.component.test.tsx`:
  - Enter submits message with correct plain text extraction
  - Shift+Enter inserts newline
  - ArrowUp/Down navigates prompt history
  - `/` triggers command palette callback
  - `@` opens typeahead dropdown
  - Typing after `@` filters file suggestions
  - ArrowUp/Down + Enter selects suggestion
  - Escape dismisses typeahead
  - Pasting URL auto-creates URL mention node
  - Multiple mention types in same message serialize correctly
- **Integration tests:** IPC handler tests for `composer:file-suggest` with mock filesystem
