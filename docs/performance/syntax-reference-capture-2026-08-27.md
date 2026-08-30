# Syntax Reference Capture — 2026-08-27

This capture records the local evidence used to set OpenWaggle's initial syntax and workspace-editing performance policy. It distinguishes inspectable architecture from measured OpenWaggle timings: the installed reference applications were inspected from their shipped source maps and bundles, but their private UI interactions were not assigned invented timing values.

## Environment

- macOS 26.6.2 (25G83), Apple silicon arm64
- MacBook Pro Mac16,5, Apple M4 Max, 14 CPU cores, 36 GB unified memory
- Internal 3456×2234 main display; external 1920×1080 at 75 Hz
- AC power, Low Power Mode off, High Power Mode off
- OpenWaggle baseline commit `ca5568b99f8d82e27b2a6fc3fdf81dd7599cb238`
- Node v24.12.0

Hardware identifiers and serial numbers are intentionally omitted.

## Installed references

### T3 Code

- `/Applications/T3 Code (Alpha).app`
- Version 0.0.33, local bundle dated 2026-08-10
- `app.asar` size: 195,854,601 bytes
- File preview source map SHA-256: `f0ee81024c0ed5752bc225bc66e21ea8aa023c7038385ccd49f448d64b756b44`
- Worker source map SHA-256: `939d42ef6368cbda638559944bc63a2b524bc889dc8046c83ff52cbd746576e8`

The shipped source map shows `@pierre/diffs` `VirtualizedFile`, `Editor`, `EditProvider`, `File`, and `Virtualizer`. The virtualizer uses 600 px overscroll and a 1,200 px intersection-observer margin. Its save coordinator debounces for 500 ms, serializes in-flight writes, and flushes during disposal. Large read-only source is truncated at 1 MiB. Cache identity includes environment, working directory, path, and content. Its syntax worker contains Shiki core with JavaScript and Oniguruma engines plus lazy language/theme resolution and caches.

### Codex GUI

- `/Applications/ChatGPT.app` — the installed Codex desktop GUI, not the open-source Codex TUI repository
- Version 26.820.60940, build 7119, local bundle dated 2026-08-26
- `app.asar` size: 282,402,769 bytes
- Shiki provider SHA-256: `6f7baf615edff797b454c1fc64901f1d4699fa88dbd3ab56250f497e1d641b86`
- Editable code-block bundle SHA-256: `c6016c6baa890071c474be046db31cc92ba03763180abb1e516dbbed34f8a4d4`
- Syntax worker SHA-256: `4f2bcd64c6f5810a27752f6595c55fb37006c5be8361112056e17a1e39fe411e`

The shipped Shiki provider uses a module worker pool of four and a total AST LRU capacity of 100. It ships TypeScript, JavaScript, CSS, HTML, and Python in that provider, keeps separate light and dark code-theme identities, resolves the active theme from appearance, memoizes provider/options state, and updates render options without rebuilding the provider. The editable code-block surface is CodeMirror-like. A separate highlight.js path exists but is not the primary Shiki provider.

## OpenWaggle decisions informed by the references

- A bounded pool of at most two shared syntax workers serves review-surface grammar work so one large request cannot starve compact visible code. Focused file edit adds one Pierre worker only while the explicit editor is mounted; ordinary app launch and review do not load either worker type.
- OpenWaggle's lightweight source view renders only the viewport plus 30 lines of overscan. Pierre owns focused editing with T3 Code's inspected 600 px overscroll and 1,200 px intersection margin.
- OpenWaggle does not embed Monaco or a workspace language service. Pierre continues to own diffs and the focused editor. Syntax consumers resolve the same stable theme and grammar packages through revision-specific runtime names.
- Renderer workers use ES-module output. This reduced the shared syntax worker from an all-grammars 10.6 MB IIFE to a 393 KB entry whose selected language loads as a separate chunk.
- Imported TextMate grammars run in killable workers. JavaScript regex is the default engine; Oniguruma/WASM loads lazily only when a grammar requests it.
- The editor sends versioned deltas during typing and captures a full snapshot only at autosave, recovery, preview, conflict, or fidelity boundaries. This avoids a full-document renderer copy on each edit.
- Stable user selections use resource IDs, while Shiki and Pierre receive immutable revision-specific runtime theme and grammar names. Theme or grammar replacement therefore updates consumers without invalidating settings.
- Worktree path and relative path are both part of document, view-state, search, and model identity.

## Measured OpenWaggle microbenchmark

Command: `pnpm exec tsx scripts/benchmarks/syntax-highlighting.ts`

| Metric | Median | p95 | Samples |
| --- | ---: | ---: | ---: |
| JavaScript regex, cold 16 KiB | 35.548 ms | 116.206 ms | 3 |
| JavaScript regex, warm 16 KiB | 15.895 ms | 16.589 ms | 15 |
| JavaScript regex, warm 128 KiB | 126.740 ms | 134.215 ms | 15 |
| JavaScript regex, warm 1 MiB | 994.793 ms | 1,010.241 ms | 5 |
| Oniguruma/WASM, cold 16 KiB | 51.909 ms | 85.337 ms | 3 |
| Admission scan, 1 MiB | 1.985 ms | 2.708 ms | 15 |
| Readable source window, 1 MiB | 0.243 ms | 0.342 ms | 15 |

The raw result is stored in `performance/syntax-results/macos-arm64-2026-08-27.json`; the checked budget and document envelope are in `performance/syntax-budgets/macos-arm64.json`. The benchmark is an absolute controlled-machine guard. Real Electron interaction traces remain a separate QA obligation because worker time alone cannot establish input latency or scroll frame quality.

## Implementation validation

The review-first implementation passes the checked macOS arm64 syntax benchmark. Its production bundle gate rejects Monaco assets, an initial renderer above 1 MiB, a shared syntax worker above 768 KiB, a focused-editor chunk above 512 KiB, or a focused-editor worker above 768 KiB. Real Electron verification additionally measures the readable first paint of a 1 MiB file, bounded rendered line nodes, long tasks, focused-edit persistence, and the absence of legacy editor workers.

## 2026-08-30 installed-app comparison

The comparison was repeated after updating the local T3 Code source mirror and inspecting the currently installed applications. T3 Code was version 0.0.35 at source commit `2daff8c25adf701fddd062ae93b94cc57d420ec2`. The installed Codex GUI was ChatGPT 26.825.41651, build 7345. The open-source Codex repository was not inspected.

T3 Code's loopback web surface required its desktop pairing credential, and the installed Codex GUI exposed no equivalent test endpoint. The table therefore reports reproducible shipped-asset measurements and inspectable runtime policy, not invented private interaction timings. Raw and gzip sizes are directional because each application has different chunk boundaries.

| Shipped artifact or policy | OpenWaggle | T3 Code 0.0.35 | Codex GUI 26.825.41651 |
| --- | ---: | ---: | ---: |
| Initial renderer entry, raw / gzip | 773,068 / 160,412 bytes | Not isolated from the 5.4 MB application entry | Not isolated from the application entry |
| Focused file editor, raw / gzip | 347,792 / 78,566 bytes | 387,425 / 114,781 bytes | 512,408 / 174,919 bytes |
| Syntax/editor worker, raw / gzip | 397,369 / 95,531 bytes | 833,722 / 300,745 bytes | 211,224 / 68,237 bytes |
| Review syntax workers | Up to 2, created on demand | Up to 6 on this 14-core machine | 4 |
| Ordinary single-file open | Virtualized read-only source; editor chunk and worker remain unloaded | Lazy panel, then Pierre editable file for an ordinary file | Separate review-source and editable-source surfaces |
| Large mounted source | Viewport plus 30 lines; compact blocks switch to virtualization above 64 KiB or 1,000 lines | Pierre virtualizer with 600 px overscan | Review virtualizer metrics are shipped separately |
| Language strategy | Lazy bundled languages plus user/project grammar imports | Lazy language/theme resolution | Five languages in the inspected provider |

OpenWaggle's focused editor is 10.2% smaller raw than T3 Code's file-preview chunk and 32.1% smaller raw than Codex's text-file-editor chunk. Its syntax worker is 52.3% smaller raw than T3 Code's worker. Codex's narrower five-language worker remains smaller than OpenWaggle's extensible worker; OpenWaggle keeps that cost off startup and caps the review pool at two rather than scaling it with the host's core count. The complete OpenWaggle startup module graph is 3,988,402 bytes and separately capped at 4.5 MiB; comparing that graph to another app's differently partitioned entry would not be an equivalent measurement.

The single-file path has additional interaction guards that shipped bundle sizes cannot prove:

- A normal TypeScript file must become readable in Electron within 100 ms; a 1 MiB TypeScript file must become readable within 200 ms, before tokenization completes.
- The 1 MiB view mounts at most 130 line rows and records no long task above 50 ms.
- The source crosses the worker boundary once. Four subsequent distant viewport changes send only the source identity and requested line range, never another 1 MiB source clone.
- Syntax tokenization remains off the main thread. The focused editor and its worker are still absent until the user explicitly chooses Edit.
- Chat, Markdown, tool, and structured-data code blocks automatically move from the compact renderer to the bounded viewport renderer above 64 KiB or 1,000 lines.

The repeated checked microbenchmark on the same machine recorded 25.847 ms p95 for warm 16 KiB TypeScript, 174.206 ms p95 for warm 128 KiB, 1,281.850 ms p95 for 1 MiB worker tokenization, 0.335 ms p95 for selecting an 80-line window from a 1 MiB source, and 3.091 ms p95 for the one-time 1 MiB source fingerprint. The warm viewport path reuses that fingerprint and the worker's token cache.
