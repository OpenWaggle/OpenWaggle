Review: Renderer — Diff Panel + Review Flow

### 1. FileTree.tsx — 'use no memo' directive

Judgment: Correct and well-scoped.

The directive is placed at the top of FileTree's function body (line 131), which
prevents the React Compiler from memoizing the tree.getItems().map(...) output. The
comment accurately explains the root cause: @headless-tree mutates the tree instance
in place → same reference → compiler caches the mapped JSX → empty navigator in the
compiled app while tests pass (vitest skips the compiler).

No other component in diff-panel/ imports from @headless-tree or reads from the
mutable tree instance. DiffCodeView, DiffReviewBody, ReviewBar, PendingComment, and
InlineComment all receive their data as props or from Zustand selectors — not from a
mutated library instance. No silent risk found elsewhere.

### 2. Review Flow — State / Submit / Discard

MAJOR | src/renderer/src/features/diff-panel/hooks/useDiffReviewActions.ts:59-63 |
Double-submit race on rapid click | comments in the onSubmitReview closure is the
value from the last render. A quick double-click fires the handler twice before
React re-renders with the empty array. Both calls pass the comments.length === 0
guard and send the same message twice. | Read from the store imperatively: const
current = useReviewStore.getState().comments; if (current.length === 0) return;
onSendMessage(formatReviewSubmission(useReviewStore.getState().summary, current));
clearComments(); — or guard with a submittingRef.

MINOR | src/renderer/src/features/diff-panel/components/ReviewBar.tsx:59-62 |
Keyboard submit also exposed to double-fire | Cmd+Enter calls onSubmit() without
disabling; if key repeats before re-render same issue. | Add
event.currentTarget.disabled = true or share the same imperative-read guard above.

Discard is safe: discardReview() sets { comments: [], activeCommentLocation: null,
summary: '' } — idempotent. No data-loss risk.

Single-comment path (onAddSingleComment) formats and sends one message per call,
then clears activeCommentLocation. No duplication risk because
setActiveCommentLocation(null) is called immediately, and the composer unmounts.

### 3. review-comment-payload.ts — Structured Payload Robustness

MINOR | src/renderer/src/features/diff-panel/lib/review-comment-payload.ts:138-142 |
User-authored comment.content is not escaped between open/close tags | If the user
types </review_comment> in their comment text, the pseudo-XML structure breaks for
the agent's parser. Unlikely but possible with a copy-paste. | Escape or fence the
comment body (e.g. wrap in a fence block too, or escape </review_comment> →
<\/review_comment>).

Backtick runs: Handled correctly — formatFence counts the longest backtick run and
uses one-more for the fence. ✓

Attribute injection via file paths: Handled — escapeAttribute escapes &, ", <, >. ✓

Empty/one-line ranges: extractDiffSnippet returns '' when firstIndex === -1, and the
caller skips the fence block when the snippet is empty. ✓

CRLF: readPatchLines splits on \n. If the patch contains \r\n, lines will carry
trailing \r. The serialized snippet would show \r in the fenced output. Not a
correctness bug — the agent model handles it — but it's worth noting that the \r is
visible noise.

Unicode: No issue — patch.split('\n') and string ops work fine on arbitrary JS
strings.

### 4. code-view-items.ts — Cache Key & Version

FNV-1a cache key: The hash combines file.path (unique per diff set) with the patch
content. A collision would require two distinct patches for the same file that hash
to the same 32-bit value — ~1 in 4B probability per file, with <100 files per panel
render. Negligible.

Stale item reuse: The id is diff:${filePath} and the version is a content-addressed
integer derived from both the patch AND the annotations. If the patch changes (agent
edits the same file), version changes → CodeView re-renders. Correct.

versionFor parseInt safety: Max 32-bit hash in base-36 is "1z141z3" —
parseInt("1z141z3", 36) === 4294967295, well within Number.MAX_SAFE_INTEGER. No
precision loss.

No issues found.

### 5. globals.css — .diff-chrome Override Mappings

The library (@pierre/diffs@1.3.2) exposes 23 --diffs-*-override variables. The CSS
maps 21. The two unmapped are:

- --diffs-overflow-override — intentionally unmapped. It's set programmatically by
  the library itself (see CodeView.js:112) based on the options.overflow prop passed
  by the consumer. Not a gap.
- --diffs-scrollbar-gutter-override — controls scrollbar gutter sizing.

MINOR | src/renderer/src/styles/globals.css (.diff-chrome block) |
--diffs-scrollbar-gutter-override not mapped | The library falls back to its
measured scrollbar width, which is fine for Chromium/Electron where WebKit
scrollbars are styled. But the comment promises all chrome overrides are mapped. If
a future Electron version changes scrollbar behaviour, the unmapped token would
drift. | Add --diffs-scrollbar-gutter-override: 4px; (matching the
.diff-scroll::-webkit-scrollbar width already set below) for consistency.

Colour semantics after amber→green change: All addition-side tokens now use #3fb950
/ #56d364 (green), deletion-side stays #ef4444 (red). Contrast ratios pass WCAG AA:
- #3fb950 on #0d2e1a → 5.81:1 ✓
- #56d364 on #0d2e1a → 7.66:1 ✓
- #ef4444 on #2d1214 → 4.62:1 ✓

No warm-hue pairing remains. The --color-diff-highlight-bg: #17130a (warm) is used
only for interactive selection/ReviewBar background and does NOT represent
"addition" — it's an accent-adjacent surface. Semantically correct.

MINOR | src/renderer/src/styles/globals.css:52 | --color-diff-add-text: #56d364
defined but unused | No Tailwind utility class in source consumes it; nothing maps
it to a --diffs-*-override. Dead token. | Remove it or map it to a missing override
if the library needs a text-specific addition colour distinct from
--color-diff-add-mark.

### Summary Table

┌───────┬─────────────────────────────────┬────────────────────────────────────────┐
│ Sev   │ File:Line                       │ Issue                                  │
├───────┼─────────────────────────────────┼────────────────────────────────────────┤
│ MAJOR │ useDiffReviewActions.ts:59-63   │ Double-submit race — stale closure     │
│       │                                 │ allows duplicate send                  │
├───────┼─────────────────────────────────┼────────────────────────────────────────┤
│ MINOR │ ReviewBar.tsx:59-62             │ Keyboard Cmd+Enter same stale-closure  │
│       │                                 │ duplication risk                       │
├───────┼─────────────────────────────────┼────────────────────────────────────────┤
│ MINOR │ review-comment-payload.ts:138-1 │ Unescaped </review_comment> in user    │
│       │ 42                              │ comment body can break payload         │
│       │                                 │ structure                              │
├───────┼─────────────────────────────────┼────────────────────────────────────────┤
│ MINOR │ globals.css .diff-chrome block  │ --diffs-scrollbar-gutter-override      │
│       │                                 │ unmapped (21/23 vs promised "all       │
│       │                                 │ chrome")                               │
├───────┼─────────────────────────────────┼────────────────────────────────────────┤
│ MINOR │ globals.css:52                  │ --color-diff-add-text defined but      │
│       │                                 │ never consumed — dead token            │
└───────┴─────────────────────────────────┴────────────────────────────────────────┘

No BLOCKER found. Architecture is sound, the 'use no memo' is the right call, and
the color change is well-executed.
