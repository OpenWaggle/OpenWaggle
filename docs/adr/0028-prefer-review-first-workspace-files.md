# Prefer Review-First Workspace Files Over An Embedded IDE

Status: accepted

OpenWaggle uses a worktree-aware, single-file review surface with focused editing instead of embedding an IDE runtime. The Monaco experiment made first launch and file opening unacceptably slow, while its production build added multi-megabyte editor and language-worker assets before OpenWaggle had the project services needed to justify them. Installed T3 Code uses `@pierre/diffs` for a virtualized editable file view and moves heavier work to an external editor; the installed Codex GUI likewise avoids a general workspace IDE.

## Decision

The workspace shows one active file from the session's exact working path. It keeps the file tree, Quick Open, project text search, Go to Line, review comments, Markdown/source switching, and external-editor handoff. It removes Monaco, editor tabs, split panes, editor navigation history, diagnostics, autocomplete, refactoring, semantic symbol navigation, and language-service workers.

OpenWaggle's lightweight `SourceView` owns the virtualized, immediately readable review path. `@pierre/diffs` loads only after an explicit Edit action and owns focused single-file editing interactions. Editing remains limited to text files no larger than 1 MiB. Larger text files open in a read-only paged source view using approximately 256 KiB requests, with no force-full-edit action. Binary and rendered document previews keep their purpose-specific renderers.

File opening never waits for syntax tokenization. Visible text paints immediately in the selected Code font, then receives worker-produced TextMate tokens without changing line geometry. A lazily started pool of at most two shared syntax workers and bounded caches serves syntax-eligible content; the second lane prevents a large-file request from starving compact visible code. A separate one-worker Pierre pool exists only while Focused file edit is mounted. Both worker types use module-split language chunks rather than shipping every grammar in their first-use asset. Inline code, prose, terminal output, logs, and unknown text do not trigger grammar work.

Focused edits autosave after a short idle period through serialized, revision-checked main-process writes. `Cmd/Ctrl+S` flushes immediately. A concurrent disk change pauses saving and preserves the draft for comparison. A bounded recovery journal protects only the active file and never restores over a changed baseline without a user choice.

Language detection follows VS Code and TextMate conventions. It uses explicit language metadata first, then project and user file associations, then filename, extension, shebang, grammar metadata, and Plain Text fallback. OpenWaggle reads VS Code `files.associations` without modifying `.vscode/settings.json`. Bundled languages and imported declarative grammars remain lazy and do not imply language-server support.

The exact latency, memory, cache, bundle, large-file, and Electron QA gates live in `docs/specs/syntax-highlighting-performance.md`. The complete renderer coverage contract lives in `docs/specs/syntax-rendering-surface-inventory.md`.

## Consequences

OpenWaggle remains useful for reviewing and making a targeted correction without taking responsibility for an IDE's indexing, language servers, project model, or extension runtime. The external-editor action handles work that needs those capabilities and opens the exact active-worktree path.

The file session, revision guard, atomic save path, worktree confinement, theme and language registries, grammar imports, and shared syntax adapters remain valuable. Monaco-specific models, workers, adapters, layout persistence, status controls, and performance tiers are removed.

## Considered Options

**Keep optimizing Monaco.** Rejected because lazy loading still leaves a large editor runtime on the first file path, and the requested semantic behavior would require project-wide services that both reference products deliberately avoid.

**Return to a highlighted textarea overlay.** Rejected because duplicated text layout and scroll state remain fragile for input methods, selection, wrapping, accessibility, and large files.

**Make every file read-only.** Rejected because `@pierre/diffs` supplies the focused local editing interactions needed for small targeted changes without adding an IDE runtime.
