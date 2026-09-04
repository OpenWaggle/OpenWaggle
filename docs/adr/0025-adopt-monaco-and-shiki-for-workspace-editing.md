# Adopt Monaco And Shiki For Full-Fidelity Workspace Editing

Status: superseded by ADR-0028

OpenWaggle adopts Monaco Editor for editable workspace documents and uses Shiki's official Monaco integration for TextMate grammar and theme fidelity. Pierre remains the renderer for diffs and non-editable code views.

## Context

OpenWaggle's product direction is that users can inspect and edit ordinary project source without needing to leave for VS Code or another editor. The current workspace editor is a controlled `<textarea>` with a separate gutter. It retains several complete string snapshots, reconstructs the whole string for some edits, sends full contents through IPC after a 500 ms debounce, and re-reads, hashes, and rewrites the file on save. Its 2 MiB editable-file limit protects that implementation; it is not a product requirement.

The unified syntax work also requires the selected TextMate-compatible Syntax theme to behave consistently in editable documents, chat code, diffs, and search results. A highlighted-textarea overlay cannot provide robust selection, input-method, undo, accessibility, incremental document, and viewport behavior. Pierre is retained where it is strongest, but making its file renderer the editor foundation would couple editing to a less established path and would not remove the need for an incremental editor model.

No editor can guarantee every expensive feature for unbounded or adversarial input. VS Code itself limits tokenization of pathological lines and applies large-file optimizations. OpenWaggle therefore needs a measured full-fidelity contract rather than pretending that arbitrary input has zero cost.

## Decision

**Editable workspace documents use Monaco Editor.** Monaco is lazy-loaded on first editor use and owns the document model, viewport rendering, selection, undo/redo, input methods, accessibility, find/replace, and editing interactions. The migration preserves OpenWaggle's existing save, external-change conflict, reveal-line, Markdown/HTML preview, and word-wrap behavior.

**The editor is a bounded multi-document workspace.** Each workspace restores familiar tabs, dirty/conflict state, close/reopen, keyboard switching, navigation history, Quick Open, Go to Line, and cursor/scroll/selection view state. It supports at most two visible editor panes, split horizontally or vertically, rather than an unbounded pane tree. One Monaco instance exists per visible pane. Hidden tab models are retained under an LRU memory budget; a dirty model is not evicted until its edit journal is durable. Restored layout persists paths and view state, not another copy of saved source content.

**Workspace identity follows the active session's working path.** Under ADR 0018, a worktree-mode session's workspace root is its Session worktree; a local-mode session's root is the opened checkout. File browser, Quick Open, content search, tabs, Monaco models, document sessions, recovery journals, watchers, and query/cache keys use the canonical working-path identity plus a root-confined relative path. Repository-level metadata continues to use the repository path. Switching sessions swaps to the corresponding workspace layout without leaking models or drafts between worktrees. A missing recorded worktree is shown as missing and never falls back silently to the primary checkout.

**The workspace explorer supports safe file management.** It creates files/directories, renames, moves, duplicates, copies paths, reveals entries in the platform file manager, and performs root-confined drag/drop inside the active working path. Delete uses the operating system trash when available; a permanent-delete fallback requires explicit confirmation. Overwrite and cross-workspace copy require explicit confirmation, and the explorer never implicitly moves content between the primary checkout and a Session worktree.

Rename/move retargets open tabs, document sessions, recovery journals, language associations, navigation history, and view state atomically. A coalesced workspace watcher reports agent and external file changes without continuous polling. Missing, moved, or externally changed open files become recoverable document conflicts rather than disappearing silently. Every mutation revalidates canonical/symlink confinement and invalidates file, search, and working-path git state for the affected workspace.

**Shiki supplies Monaco's grammar and theme data.** OpenWaggle uses the official Shiki Monaco integration so the same TextMate grammars and normalized Syntax theme packages drive editable documents and other syntax-rendered surfaces. Languages and themes load on demand through fine-grained bundles rather than delaying app startup.

The official synchronous Monaco token provider is limited to trusted bundled grammars. Declarative imported grammars use ADR 0027's worker-backed viewport adapter so their regex execution never runs on the renderer thread. Both paths consume the same normalized themes, canonical language identity, grammar revision, and TextMate scope mapping; an imported-worker failure falls back to an editable Plain Text Monaco model.

**Full fidelity is guaranteed inside a benchmarked support envelope.** Editing and syntax highlighting remain enabled throughout that envelope. Visible content is prioritized; remaining tokenization completes in the background, using workers and grammar-state checkpoints so edits invalidate only the necessary region. Brief plain or previously coloured text while asynchronous tokenization catches up is allowed; permanent feature removal inside the envelope is not.

**Large input has three explicit, measured tiers.** Full Fidelity guarantees complete editing and highlighting. Large-File Mode keeps complete editing while scheduling expensive background work conservatively and allows the user to force full highlighting through the killable worker boundary. Only the Hard Safety Boundary may avoid constructing a Monaco model, and only when benchmarked, device-aware memory admission predicts that doing so threatens application stability. Such input opens in a paged virtualized source viewer with the reason shown, an `Attempt Full Edit` action that repeats the memory check, and optional external-editor launch. No tier transition is silent, and ordinary project source must remain inside the editable tiers.

**The file boundary becomes a versioned incremental document session.** Monaco models remain outside React state. Ordered edit deltas are batched across IPC and applied against a main-process-owned baseline revision instead of sending a complete string after every change. `Cmd/Ctrl+S` forces an immediate flush; autosave flushes the pending batch. The main process owns external-change detection and atomic disk replacement. Performance limits are named, benchmark-backed policy rather than scattered byte or line constants.

**Unsaved changes survive renderer and app failure.** Pending edit batches are journaled locally in bounded app-owned storage and removed immediately after a successful save or explicit discard. Recovery data is never synced or sent to telemetry. On reopen, a draft whose disk baseline is unchanged is restored; if disk changed, the user chooses Compare, Restore Draft, or Use Disk. Recovery never silently overwrites an external change.

**Text fidelity is explicit and standards-compatible.** The document session detects and preserves supported encoding, byte-order mark, line-ending mode, final-newline state, indentation style, and tab width. The editor status bar exposes those values and offers familiar Reopen with Encoding and Save with Encoding actions. Automatic decoding prefers BOM declarations and valid UTF-8; ambiguous legacy encodings are not guessed silently. Binary or undecodable content remains in the safe viewer until the user selects a supported encoding.

The nearest applicable `.editorconfig` inside the active working root supplies charset, indentation, line-ending, final-newline, and whitespace policy using standard precedence and `root` behavior. Resolution never walks above the workspace boundary, which is especially important for Session worktrees stored under app-owned directories. Existing file choices remain intact unless the user or applicable EditorConfig policy explicitly changes them. Mixed line endings are visible and require an explicit normalization choice before a save rewrites all separators.

**Editor replacement does not imply an undeclared language server.** This delivery includes the complete local editing surface expected from Monaco: selection and multi-cursor editing, undo/redo, search/replace, bracket and comment behavior from language configuration, language selection, file navigation, and reliable persistence. TypeScript and JavaScript also receive bounded local definition navigation: on the first `Cmd/Ctrl+click`, OpenWaggle resolves only relative imports reachable inside the active working root, admits at most the named model/byte/depth budgets, starts a dedicated TypeScript worker, and routes cross-file results back through workspace navigation. The worker is absent from app startup and ordinary file opening. Package aliases, project references, installed dependency types, completion, diagnostics, references, rename, semantic tokens, and non-TypeScript language intelligence remain behind the typed language-service seam; this feature does not launch or manage a project language server.

## Consequences

OpenWaggle takes on Monaco's bundle and worker complexity. Lazy loading, fine-grained language/theme loading, worker lifecycle, CSP compatibility, Electron packaging, and model disposal become required implementation and QA concerns. The lean `editor.api` build must not import Monaco's full TypeScript contribution: that contribution assumes standalone services OpenWaggle deliberately does not install. Local navigation therefore owns a small modifier-click adapter over its dedicated worker.

The editor and Pierre no longer share a rendering component, but they share the user-visible contract that matters: language identity, TextMate grammar, active Syntax theme, and fallback behavior. This avoids forcing diff-oriented rendering abstractions into the editing domain.

Large-file behavior becomes a tested product capability. The implementation must define representative file-size, line-count, long-line, edit-latency, open-latency, tokenization, memory, save, paged-view, and memory-admission benchmarks before declaring the Full Fidelity, Large-File Mode, and Hard Safety Boundary thresholds. The boundary replaces the current arbitrary 2 MiB edit limit and must be high enough that ordinary source repositories do not encounter it.

Document-session correctness becomes a main/preload/renderer contract. Tests must cover ordered and duplicate edit batches, stale revisions, atomic save failure, renderer loss, app restart, bounded journal retention, recovery after disk changes, explicit discard, cleanup after successful persistence, supported encodings and BOMs, invalid byte sequences, LF/CRLF/mixed separators, final-newline behavior, indentation controls, and root-confined EditorConfig precedence.

Multi-document and worktree isolation require focused tests for tab restoration, two-pane model ownership, hidden-model eviction, durable dirty-model journals, navigation view state, session switching, identical relative paths in different worktrees, missing worktrees, path/symlink confinement, create/rename/move/duplicate/trash behavior, overwrite and cross-workspace confirmation, external watcher changes, atomic session retargeting, and the separation of working-path file operations from repository-level metadata.

Future project language-service integration can enrich or replace the bounded local definition adapter without replacing Monaco, the canonical language registry, imported grammar packages, or persisted document identity. It requires its own process lifecycle, trust, project configuration, provider discovery, and failure policy.

## Alternatives Considered

**Use Pierre's editable file renderer.** Rejected as the foundation for full editor replacement. Pierre remains an excellent diff and read-only renderer, but the product goal needs a mature incremental editor model and interaction stack. Comparable tools using editable Pierre paths rely on beta or custom integration work.

**Use CodeMirror with a custom Shiki bridge.** Rejected for this feature. CodeMirror supplies a strong incremental editor, but Shiki has an official Monaco integration and no equivalent official CodeMirror adapter. Building and maintaining a custom async TextMate token bridge would add risk to the central fidelity requirement.

**Keep the textarea and add a highlighted overlay.** Rejected. It duplicates text layout and scroll state and remains fragile for selection, wrapping, input methods, accessibility, and large files.

**Disable editing or highlighting at the current 2 MiB boundary.** Rejected as an implementation limit that contradicts the product direction. Limits must follow measured safety constraints, preserve editing throughout the normal and large-file tiers, and remain user-overridable where forcing full highlighting or attempting full editing passes memory admission.

**Bundle language-server management into syntax highlighting.** Rejected. Syntax grammars and local editing are declarative presentation and interaction capabilities; language servers introduce executable project-aware processes with separate lifecycle and trust requirements. The editor prepares the boundary without misrepresenting those capabilities as present.
