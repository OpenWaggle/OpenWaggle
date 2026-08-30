# Agent Design Context

This file is for agent-facing product and UI decisions. User-facing documentation stays under `website/src/content/docs/`.

## Product Direction

OpenWaggle is a local-first desktop coding workspace over Pi. Design should make runtime truth visible instead of hiding it behind synthetic UI state.

Core product principles:

- The user remains in control through visible session, branch, tool, model, and run state.
- Pi-native runtime behavior should be represented faithfully.
- Waggle mode should feel like collaborative problem-solving over the same session model, not a separate chat product.
- Project-local configuration should be explicit and inspectable.

## UI Surfaces

Important surfaces:

- Chat transcript and tool timeline.
- Composer, branch-scoped config, attachments, voice input, slash commands, and compaction.
- Session Tree, branch lifecycle, branch summaries, and navigation.
- Settings for providers, models, auth, MCP, app preferences, and data.
- Diff, git status, commit flow, and built-in terminal.
- Waggle preset and collaboration controls.

## Design Rules For Agents

- Preserve existing visual language unless the task explicitly asks for redesign.
- Keep agent/tool/runtime state truthful and inspectable.
- Apply syntax highlighting by grammar, not presentation element: highlight syntax-rendered content, while keeping raw logs, errors, and terminal output plain or ANSI unless explicit language metadata is available.
- Treat typed structured payloads from MCP, tools, extensions, configuration, and resources as syntax-rendered content. Prefer a compact tree or table when it communicates structure better, but provide a highlighted source representation and do not infer structure from arbitrary log or error strings.
- Model Light, Dark, High Contrast Light, and High Contrast Dark as distinct appearance variants. Keep ordinary Light and Dark Syntax selections prominent, expose high-contrast selections under accessibility, default them to a matching family, and resolve the active theme from the app's current colour and contrast scheme.
- Ship custom Syntax theme import alongside the curated, searchable bundled catalog; treat import format, validation, persistence, and failure recovery as part of the same feature.
- Keep Appearance roles and Syntax themes separate but composable inside one versioned OpenWaggle theme package. The package has stable identity and metadata plus optional payloads for each of the four appearance variants and each layer. Custom imports populate Syntax payloads initially; future packages may also provide whole-app Appearance tokens without changing registries or user selections.
- Layer user Appearance preferences above theme-package defaults. Reset removes a runtime override so the active Appearance can supply its typography; customized interface, document, code, and terminal CSS font stacks, sizes, line heights, ligatures, scale, and motion remain global user choices across projects and worktrees.
- Keep Appearance selection cheap: catalogs and profile cards use CSS-only specimens, while only one tabbed live renderer preview is mounted at a time. Do not mount source, Markdown, diff, and structured-data previews simultaneously for every theme card.
- Make theme import standards-first: accept standalone VS Code colour-theme `.json`/`.jsonc`, TextMate `.tmTheme`, packaged `.vsix` and unpacked VS Code theme extensions, and native OpenWaggle theme packages. Normalize them internally instead of requiring users to translate or wrap familiar artifacts; inspect VS Code extension theme contributions declaratively, preserve every declared normal and high-contrast variant in the imported collection, and never execute imported extension code.
- Use TextMate grammar scopes as the current universal syntax-colour contract. Preserve imported semantic-token definitions losslessly, but do not apply them without a real project-aware semantic-token provider or simulate them from filenames and regular expressions.
- Treat editable workspace documents as syntax-rendered content. Use the lightweight virtualized Source view for review and load Pierre's focused editor only after an explicit Edit action, preserving save, conflict, reveal-line, preview, and wrap behavior without loading an IDE runtime.
- Allow focused editing for text files no larger than 1 MiB. Larger text files use a clearly labelled, read-only source view with approximately 256 KiB pages and an external-editor action; do not offer force-full-edit.
- Keep local editing truthful and focused: selection, undo/redo, find/replace, indentation, comment toggles, and line movement are in scope; completion, diagnostics, refactoring, semantic navigation, and language services are not.
- Persist focused edits through versioned main-process document sessions with atomic saves, external-change detection, immediate manual flush, and bounded active-file crash recovery. Never sync recovery content or overwrite a changed disk file without an explicit comparison choice.
- Show one active workspace file. Keep the worktree-aware tree, Quick Open, project text search, Go to Line, and external-editor handoff; do not add tabs, split panes, editor history, or hidden document models.
- Key file browsing, search, the active file, document sessions, recovery, watchers, and caches to the active session's canonical working path. In worktree mode this is the Session worktree; in local mode it is the opened checkout. Never mix identical relative paths across worktrees or silently fall back when a recorded worktree is missing.
- Include root-confined workspace file management: create file/folder, rename, move, duplicate, platform reveal, path copy, drag/drop inside one workspace, and trash-first deletion. Require explicit overwrite, cross-workspace copy, and permanent-delete confirmation; retarget open document state atomically and surface external/missing-file conflicts through a coalesced watcher.
- Preserve supported text encoding, BOM, line endings, final-newline state, indentation, and tab width through document sessions. Keep exceptional encoding controls out of the normal editing path, do not guess ambiguous legacy encodings, and require a visible choice before normalizing mixed line endings.
- Apply the nearest standard `.editorconfig` within the active working root for charset, indentation, line endings, final newline, and whitespace policy. Respect its precedence and `root` semantics without traversing above a checkout or Session worktree boundary.
- Route syntax-eligible highlighting through one lazy shared worker-backed syntax service with language/theme registries, bounded caches, cancellation, and visibility-aware priority. Focused editing may mount one separate Pierre worker only for the lifetime of that explicit editing surface. Keep both worker builds module-split so languages stay demand-loaded. Feature components must not own highlighter instances or fallback policy.
- Require every qualifying first-party surface to use the shared syntax system. Give third-party extensions a typed host-backed capability plus `@openwaggle/extension-react` `SyntaxBlock`/`SourceView` primitives; accept source text with an explicit language or media type, never extension-provided highlighted HTML, and do not claim to rewrite arbitrary extension-owned markup.
- Make every bundled Shiki language available automatically through lazy loading. Let users correct detection through a searchable language control and import declarative VS Code/TextMate grammars without executing extension code; failures fall back visibly to editable Plain Text.
- Prefer Shiki's JavaScript regex engine for trusted bundled grammars. Strictly validate imported grammars in disposable workers, lazily fall back to Oniguruma WASM for constructs JavaScript cannot faithfully translate, and pin engine identity to grammar revision. Never execute imported regexes on the renderer thread; use the shared worker-backed syntax service and preserve editing on failure.
- Install Settings imports into a user-global theme or language library. Discover portable project packages from `.openwaggle/themes/` and `.openwaggle/languages/`, label their scope, never promote them globally without explicit action, and resolve project override → user default/import → bundled fallback. Use the same precedence for project and user language associations before built-in inference.
- Give imported packages stable declared identity plus content revision. Preview in-place re-imports, conflicts, removals, and affected selections/associations; never guess at identity conflicts, silently fetch updates, or delete project-owned resources from Settings. Preserve unsupported source declarations for future compatibility.
- Make the Syntax theme catalog searchable and keyboard navigable across all four appearance variants and bundled/imported/project scopes. Preview selection temporarily across focused source, Markdown, diff, and structured-payload samples; commit with Enter/click and revert with Escape. Stage import diagnostics and contrast warnings without rewriting or rejecting a valid low-contrast theme.
- Keep completed streaming Markdown prefixes stable and route the bounded active fenced block through the cancellable syntax worker. Treat syntax performance as a merge gate backed by repeatable latency, frame-time, memory, cache, cancellation, and large-file measurements.
- Establish initial syntax-performance budgets from one-time identical-fixture measurements of OpenWaggle, T3 Code, and the installed Codex GUI; keep the permanent regression suite self-contained in OpenWaggle with controlled desktop traces and deterministic CI checks.
- Treat controlled macOS arm64 absolute budgets as the initial merge gate, controlled Windows x64 and Linux x64 budgets as release gates until stable dedicated runners can promote them to per-PR gates, and noisy shared CI as suitable only for deterministic invariants and same-run regression comparisons. Require packaged functional smoke coverage on every shipped architecture.
- Treat `docs/specs/syntax-rendering-surface-inventory.md` as the acceptance checklist for renderer coverage. New block renderers use the approved syntax, source, structured-payload, Markdown, diff, plain-text, or ANSI contract instead of feature-local `<pre>` and highlighter paths.
- Prefer in-context controls over modal flows unless the task needs focused decision-making.
- Do not duplicate user-facing docs in `docs/agents/`; link to `website/src/content/docs/`. OpenWaggle docs are still single-source in website docs; packaged builds may generate Pi-style package-local agent-facing docs from the full docs set and installed Pi docs.
- For renderer changes, follow `.agents/standards.md` and validate with `.agents/verification.md`.
- For high-impact UI changes, use `frontend-design` or `interface-design` only when the task asks for design work or a new interface.

## References

- `docs/first-principles.md`
- `docs/renderer-architecture.md`
- `docs/specs/waggle-composer-wireframes.md`
- `website/src/content/docs/using-openwaggle/`
- `website/src/content/docs/configuration/`
- `website/src/content/docs/developer-workflow/`
