# Syntax And Focused-File Performance Contract

Status: accepted macOS arm64 merge gate; controlled Windows and Linux profiles remain release-gate follow-up work.

## Purpose

The workspace file path must not slow app launch, session use, file opening, typing, scrolling, or agent controls. Syntax-eligible source paints a bounded viewport skeleton first, and optional language work always yields to interaction.

The reference evidence comes from the installed T3 Code and Codex GUI builds recorded in [Syntax Reference Capture, 2026-08-27](../performance/syntax-reference-capture-2026-08-27.md). T3 Code's shipped source maps show a virtualized `@pierre/diffs` file surface with 600 px overscan, a 1,200 px intersection margin, a 500 ms serialized save coordinator, lazy syntax assets, and a 1 MiB read-only boundary. The installed Codex GUI ships distinct review-source and editable-source paths rather than mounting its text editor for every review. Permanent tests use OpenWaggle-owned fixtures and never depend on either external product.

## Document envelope

- Text files no larger than 1 MiB use the complete virtualized source view and may enter Focused file edit.
- Larger text files use read-only source requests of approximately 256 KiB, with a 512 KiB IPC response ceiling.
- Binary, image, PDF, and rendered HTML documents keep their purpose-specific preview paths.
- No file size or device-memory override enables full editing above the 1 MiB boundary.

## Absolute interaction budgets

Controlled macOS arm64 traces enforce these p95 limits:

- Starting OpenWaggle does not create the focused editor, load a grammar, or start the syntax worker.
- Cold startup does not regress more than 5% from the same-build pre-editor baseline.
- File click to a stable source layout, either a skeleton or highlighted source, is at most 100 ms for 256 KiB and 200 ms for 1 MiB.
- File opening never blocks the renderer on theme or grammar work. Eligible source paints a bounded viewport skeleton immediately and swaps it for source only when matching tokens are ready.
- Every unresolved eligible viewport uses line-shaped skeleton rows and an announced loading status from its first paint. Plain source never appears as an intermediate visual state.
- Typing input to paint is at most 16.7 ms, with no editor task longer than 50 ms.
- Scrolling a 1 MiB file does not grow rendered line nodes with total file length and does not sustain frame drops below 60 Hz.
- Switching the active Syntax theme or language never blocks input and keeps the previous valid presentation until replacement tokens arrive.
- Entering focused edit keeps the active Syntax theme; Pierre's file and worker-pool options receive the same runtime theme identity.
- Opening an 80-file, 32,000-changed-line diff paints the next frame within 100 ms, exposes the first rendered diff within 1.5 seconds, creates exactly one lazy Pierre worker, and produces no renderer task longer than 50 ms.

The trace records hardware, operating system, display refresh rate, power mode, fixture hash, cold or warm state, sample count, visible completion, worker completion, renderer tasks, peak memory, and retained memory.

## Structural merge gates

Ordinary CI enforces deterministic properties:

- `monaco-editor`, Monaco editor chunks, and Monaco language workers are absent from dependencies and production output.
- At most two shared syntax workers exist, and neither starts before syntax-eligible content becomes visible. The bounded second lane prevents a large source request from starving compact visible code. An active Pierre diff or focused editor may add one bounded worker only while that explicit surface is mounted; inactive right-sidebar routes retain no worker.
- Syntax and focused-editor workers use ES-module output so bundled grammars remain separate demand-loaded chunks. Production build gates keep the initial renderer entry below 1 MiB, its complete static module graph below 4.5 MiB, the shared syntax worker below 768 KiB, the focused-editor chunk below 512 KiB, and its worker below 768 KiB.
- Feature components do not construct Shiki highlighters or workers.
- Visible requests outrank near-viewport requests; near-viewport work outranks offscreen work.
- Superseded, unmounted, and scrolled-away requests cancel without logging grammar failures.
- Result, source-identity, token, and imported-grammar failure caches stay within their declared entry and byte limits.
- A theme change invalidates themed output without discarding unrelated language state.
- Append-only streaming work does not re-tokenize a stable prefix.
- Focused edits remain revision-checked, serialized, and recoverable without retaining hidden document models.
- Closing or switching a file disposes its editor resources and leaves no dirty state outside the bounded recovery journal.
- Large-file paging stays root-confined and worktree-aware.
- A source document crosses the review worker boundary once per worker cache residency. Viewport-only requests omit the source and retry once only when the worker reports eviction.
- Host code surfaces above 64 KiB or 1,000 lines use the bounded viewport renderer instead of mounting an unbounded token-span tree. Extension `SourceView` contributions stop host highlighting above 64 KiB or 2,000 lines and keep a virtualized complete plain-source view.

## Fixtures

The permanent suite covers:

- 4 KiB, 256 KiB, and 1 MiB TypeScript files;
- many short lines, one pathological long line, mixed Unicode, and embedded languages;
- a file larger than 1 MiB read through multiple pages;
- JavaScript-regex and lazy Oniguruma grammar paths;
- cold and warm grammar loads, cache hits, eviction, cancellation, timeout, worker replacement, and repeated-failure quarantine;
- typing, deletion, undo/redo, find/replace, multi-line paste, indentation, comment toggles, and save;
- `Cmd/Ctrl+S`, idle autosave, concurrent disk change, renderer restart recovery, and journal cleanup;
- source, Markdown fence, diff, structured payload, search snippet, theme preview, terminal, log, and unknown-language rendering;
- identical relative paths in two separate Session worktrees.
- an 80-file TypeScript diff with 200 changed lines per side in every file, including first-frame, first-code, worker-count, long-task, and renderer-error assertions.

## Measurement and regression policy

`pnpm benchmark:syntax` owns deterministic microbenchmarks and checks the platform's absolute performance budget. Bundle-shape tests, component tests, and Electron traces cover properties that a worker microbenchmark cannot establish. A future branch-vs-base CI comparison must run both revisions on the same controlled runner before it can be used as a relative merge gate. Absolute timing claims come only from controlled desktop traces.

Every completed renderer or IPC delivery also runs real hidden Electron QA. QA opens small and boundary-size files, edits and saves a temporary fixture, verifies the exact worktree file changed, confirms a concurrent-change conflict, checks console errors, captures representative screenshots outside the repository, and verifies that agent controls remain responsive while syntax work is active.

No aggregate green test result can waive a failed startup, interaction, bundle, memory, worktree-isolation, or save-safety gate.
