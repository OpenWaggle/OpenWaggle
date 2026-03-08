# 58 — Enhanced Diff Rendering

**Status:** Not Started
**Priority:** P2
**Category:** Enhancement
**Depends on:** Spec 53 (Shiki Syntax Highlighting — for syntax-highlighted diffs)
**Origin:** T3Code competitive analysis — t3code uses `@pierre/diffs` library for diff rendering. Reference: [t3code](https://github.com/pingdotgg/t3code) diff rendering with `@pierre/diffs`.

---

## Problem

OpenWaggle has a functional diff rendering system, but it's basic compared to modern code review tools:

**Current implementation:**
- `src/renderer/src/lib/diff.ts` — Manual unified diff parser using `createPatch()` from `diff` package
- `src/renderer/src/components/diff-panel/DiffPanel.tsx` — Main diff UI with file tree sidebar
- `DiffFileSection` renders individual file diffs with comment support
- File tree navigation with scroll-to-file
- Stage/revert all buttons in bottom bar
- Comment system for code review

**Limitations:**
1. **Unified view only** — No side-by-side (split) diff view option
2. **No syntax highlighting in diffs** — Diff lines are plain text with add/remove coloring, no language-aware highlighting
3. **No word-level diff** — Entire lines marked as added/removed, even when only one word changed
4. **No hunk-level actions** — Can stage/revert all files, but not individual hunks within a file
5. **Basic file tree** — No file status icons (added/modified/deleted), no change count badges
6. **No inline edit acceptance** — Cannot accept/reject individual changes from within the diff view

t3code uses `@pierre/diffs`, a purpose-built diff rendering library. We should evaluate it and potentially adopt it or build equivalent features on top of our existing system.

## Implementation

### Phase 0: Evaluate `@pierre/diffs`

- [ ] Research `@pierre/diffs` library:
  - Is it actively maintained? Check npm publish frequency, GitHub activity
  - What does it provide? API surface, component exports, theming
  - Bundle size impact
  - React compatibility (React 19, React Compiler)
  - Does it support: side-by-side view, word-level diff, syntax highlighting, hunk actions?
  - License compatibility
  - Customizability: can we style it with Tailwind v4?
- [ ] Compare alternatives:
  - `react-diff-viewer` — popular, supports side-by-side, word-level diffs
  - `react-diff-view` — based on unidiff, supports multiple views
  - Keep our custom implementation and enhance it
- [ ] Decision: adopt library vs. enhance custom implementation
  - If library adoption: document which library and why
  - If custom enhancement: proceed with phases below

### Phase 1: Word-Level Diff

- [ ] Enhance `src/renderer/src/lib/diff.ts` with word-level diff computation:
  - For lines marked as modified (paired add/remove), compute word-level changes
  - Use `diffWords()` from `diff` package (already in deps) to identify changed segments within a line
  - New type:
    ```typescript
    interface DiffSegment {
      text: string
      type: 'unchanged' | 'added' | 'removed'
    }

    interface EnhancedDiffLine extends DiffLine {
      segments?: DiffSegment[] // word-level breakdown for modified lines
    }
    ```
  - Pair detection: match removed lines with subsequent added lines that have high similarity (Levenshtein distance threshold)
  - Highlight changed words with a brighter background within the add/remove line color

- [ ] Update `DiffFileSection` to render word-level segments:
  - Each line renders as a sequence of `<span>` elements with segment-specific styling
  - Unchanged words: normal text
  - Added words: bright green background
  - Removed words: bright red background with strikethrough

### Phase 2: Side-by-Side View

- [ ] Add view toggle to `DiffPanel.tsx`:
  - Toggle button: "Unified" / "Split" in the diff panel header
  - Persist preference in local storage or Zustand
  - Default: Unified (current behavior)

- [ ] Create `src/renderer/src/components/diff-panel/SplitDiffView.tsx`:
  - Two-column layout: left = original file, right = modified file
  - Synchronized scrolling between columns
  - Line number gutters on both sides
  - Context lines shown in both columns (dimmed)
  - Added lines: shown only in right column, left column blank
  - Removed lines: shown only in left column, right column blank
  - Modified lines: original in left, modified in right, with word-level highlighting

- [ ] Create `src/renderer/src/lib/diff-split.ts`:
  - Transform unified diff output into paired left/right line arrays
  - Handle line alignment for context, additions, deletions
  - Support collapsed context sections (expand on click)

### Phase 3: Syntax Highlighting in Diffs (Requires Spec 53)

- [ ] Integrate Shiki highlighting from Spec 53 into diff rendering:
  - Detect language from file extension (`.ts` → TypeScript, `.py` → Python, etc.)
  - Highlight the full original and modified file content through Shiki
  - Map highlighted tokens back to diff lines
  - Preserve add/remove background coloring while showing syntax colors for tokens
  - Use Shiki cache from Spec 53 for highlighted blocks

- [ ] Handle partial file diffs:
  - When diff shows only changed hunks (not full file), context lines need highlighting too
  - Option A: Highlight the full file and extract relevant lines
  - Option B: Highlight only visible lines with enough context for grammar accuracy
  - Recommendation: Option A for correctness; cache makes it efficient

- [ ] Theme compatibility:
  - Ensure Shiki syntax colors are visible against both add (green) and remove (red) backgrounds
  - May need adjusted backgrounds with reduced opacity to let syntax colors show through

### Phase 4: Hunk-Level Actions

- [ ] Add per-hunk action buttons in diff view:
  - Each hunk header (`@@ ... @@`) shows action buttons on hover:
    - "Accept" — apply this hunk to the working file
    - "Reject" — skip this hunk (remove from pending changes)
    - "Copy" — copy hunk content to clipboard
  - Buttons appear on right side of hunk header bar

- [ ] Implement hunk application logic:
  - Create `src/renderer/src/lib/diff-apply.ts`:
    ```typescript
    function applyHunk(
      originalContent: string,
      hunk: DiffHunk,
      action: 'accept' | 'reject'
    ): string
    ```
  - For "Accept": apply the hunk's additions and removals to the file
  - For "Reject": keep the original content for that hunk region
  - Validate line numbers match current file content (fail safely if file changed since diff)

- [ ] Wire hunk actions to main process:
  - New IPC channel: `'diff:apply-hunk'`
    ```typescript
    'diff:apply-hunk': {
      args: [filePath: string, hunk: SerializedHunk, action: 'accept' | 'reject']
      return: { success: boolean; error?: string }
    }
    ```
  - Handler reads current file, applies hunk, writes updated file
  - Refresh diff after hunk application (re-run `git diff`)

- [ ] Track hunk application state:
  - After accepting/rejecting a hunk, update diff display:
    - Accepted hunks: collapse with "Applied" badge
    - Rejected hunks: collapse with "Skipped" badge
    - Remaining hunks: still interactive
  - "Accept All Remaining" / "Reject All Remaining" bulk actions

### Phase 5: Improved File Tree

- [ ] Enhance file tree in `DiffPanel.tsx`:
  - File status icons next to each filename:
    - Green `+` circle for added files
    - Orange `~` circle for modified files
    - Red `-` circle for deleted files
    - Renamed files: arrow icon with old → new name
  - Change count badges: `+N / -M` showing additions/deletions per file
  - Collapsible directory groups (group files by parent directory)
  - Sort options: by name, by status, by change count
  - Search/filter within file tree

- [ ] Add summary bar at top of file tree:
  - Total files changed: N
  - Total additions: +X
  - Total deletions: -Y
  - Progress indicator for hunk-level review: "5/12 hunks reviewed"

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/src/components/diff-panel/SplitDiffView.tsx` | Side-by-side diff view component |
| `src/renderer/src/lib/diff-split.ts` | Unified → split diff transformation |
| `src/renderer/src/lib/diff-apply.ts` | Hunk application logic |
| `src/renderer/src/lib/diff-word.ts` | Word-level diff computation |
| `src/main/ipc/diff-handler.ts` | Hunk apply IPC handler (if not already exists) |

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/src/lib/diff.ts` | Add word-level diff segment support |
| `src/renderer/src/components/diff-panel/DiffPanel.tsx` | View toggle, improved file tree, summary bar |
| `src/renderer/src/components/diff-panel/DiffFileSection.tsx` | Word-level rendering, hunk actions, syntax highlighting |
| `src/shared/types/ipc.ts` | Add `'diff:apply-hunk'` channel |
| `src/preload/api.ts` | Add hunk apply API method |

## Cross-References

- **Spec 53 (Shiki Syntax Highlighting)** — Phase 3 depends on Shiki being available for syntax-highlighted diffs. Phases 1-2 and 4-5 can proceed independently.
- **Spec 55 (Checkpoint/Revert)** — Hunk-level accept/reject modifies files, which should trigger checkpoints.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Hunk application creates inconsistent file state | Medium | Validate line numbers match before apply; use checkpoint before hunk operations |
| Side-by-side view performance with large diffs | Medium | Virtualize long diff lists; limit visible hunks |
| Syntax highlighting + diff colors conflict | Medium | Reduce diff background opacity; test with multiple themes |
| `@pierre/diffs` may be abandoned or poorly maintained | Low | Phase 0 evaluation before committing; custom enhancement as fallback |
| Word-level diff pairing heuristic may be inaccurate | Low | Configurable similarity threshold; fall back to line-level when uncertain |
| Hunk apply on changed files | Medium | Compare file hash before/after; warn user if file modified since diff |

## Definition of Done

1. Word-level diff highlights changed words within modified lines
2. Side-by-side view available as toggle option (default: unified)
3. Syntax highlighting in diff lines (requires Spec 53) with visible token colors
4. Per-hunk Accept/Reject buttons with file update and diff refresh
5. File tree shows status icons and change count badges
6. Summary bar shows total changes and review progress
7. No regression in existing diff panel features (comments, stage/revert all, file navigation)

## Testing Strategy

- **Unit tests:** `diff-word.unit.test.ts`:
  - Detects changed words between paired lines
  - Handles completely different lines (no word-level diff)
  - Handles empty lines, whitespace-only changes
- **Unit tests:** `diff-split.unit.test.ts`:
  - Transforms unified diff into aligned left/right pairs
  - Handles context lines, pure additions, pure deletions, modifications
- **Unit tests:** `diff-apply.unit.test.ts`:
  - Applies single hunk to file content correctly
  - Rejects hunk (preserves original content)
  - Fails gracefully when line numbers don't match
- **Component tests:** `SplitDiffView.component.test.tsx`:
  - Renders two columns with synchronized content
  - Scroll synchronization works
- **Component tests:** `DiffPanel.component.test.tsx`:
  - View toggle switches between unified and split
  - File tree shows correct status icons
  - Hunk action buttons appear on hover
