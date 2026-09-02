# Standards-First Language Grammar Import

Status: accepted

OpenWaggle makes every bundled Shiki language available through automatic lazy loading and allows users to add unbundled declarative language grammars through established VS Code and TextMate formats without executing extension code.

## Context

A fixed preload list keeps startup small but makes language support appear arbitrarily limited. Shiki already publishes a broad catalog as independently loadable grammars, so bundling only a small hardcoded subset would trade away compatibility without a runtime benefit.

Some projects also use domain-specific or newly created languages that are not in Shiki's catalog. Users commonly receive their syntax support as TextMate grammars or VS Code language extensions. Requiring those users to translate the grammar into an OpenWaggle-only format would contradict the standards-first import direction in ADR 0015.

A declarative grammar is not executable extension JavaScript, but it is not inert data either: its regular expressions drive tokenization and can consume excessive CPU or memory. Import therefore needs validation, archive protections, worker isolation, and failure recovery.

## Decision

**All bundled Shiki languages are available automatically.** Common languages are prewarmed; every other bundled grammar is loaded on first demand and cached. File paths, fenced-code labels, MIME information, and canonical aliases resolve to one language identity. Users do not install or enable bundled languages.

**Language choice remains visible and correctable.** Unknown content opens as Plain Text. The source-header language control searches the complete registry and applies an exact-file override immediately. Creating a reusable filename association is a separate, explicit action so choosing TypeScript for one extensionless file does not unexpectedly reclassify unrelated files. Workspace associations are keyed by the active working-tree root so identical relative paths in two worktrees cannot collide, and OpenWaggle reads VS Code `files.associations` without modifying `.vscode/settings.json`.

**Custom declarative grammar import ships with unified syntax highlighting.** Import adapters accept:

- VS Code `.vsix` archives and unpacked extensions through `contributes.languages` and `contributes.grammars`;
- standalone TextMate `.tmLanguage`, `.tmLanguage.json`, and plist grammar files;
- native versioned OpenWaggle language packages.

VS Code imports may read declared language-configuration and grammar resources. They never load an extension entry point, execute JavaScript, activate commands, or imply support for its language server, completion engine, debugger, formatter, or semantic-token provider.

**Imported grammars execute behind the syntax worker boundary.** Import rejects unsafe archive paths, excessive archive/file sizes, malformed manifests, invalid scope identities, cyclic or escaping resource references, and unsupported encodings. Tokenization is cancellable and budgeted. A worker that exceeds its execution or memory policy is terminated and replaced; repeatedly failing grammars are disabled with visible diagnostics while the document remains editable as Plain Text.

**Regex execution uses a pinned hybrid engine policy.** Bundled, trusted grammars use Shiki's JavaScript engine by default, matching the fast path used by the inspected T3 Code and Codex GUI integrations. Import strictly compiles and smoke-tokenizes each grammar in a disposable worker. A grammar containing Oniguruma constructs that cannot be translated faithfully to JavaScript is pinned to a lazily loaded Oniguruma WASM engine rather than silently dropping unsupported patterns. Engine identity is part of the grammar revision and every cache key, so one grammar revision cannot produce different tokens across surfaces.

**Imported grammars never execute on the renderer thread.** Focused-file highlighting uses the shared worker boundary with viewport-scoped work and cached grammar-state checkpoints. Worker failure removes only imported highlighting and leaves the document readable and editable as Plain Text.

**User libraries and project resources use explicit scope.** Importing a grammar through Settings installs it in the user's global language library. Projects may carry declarative packages under `.openwaggle/languages/`; these are discovered only for that project, display their provenance, and are never copied into the global library implicitly. A project package may add a non-conflicting language, but it cannot silently replace a bundled or user-installed identity, alias, extension, or filename. Collisions are disabled with visible diagnostics until a future project-trust decision provides a safe override flow. Language associations resolve project override, then user-global association, then built-in path/content inference, then Plain Text.

**Package replacement is previewed and deterministic.** A VS Code extension's declared publisher/name and the declared path of each contributed theme or grammar determine stable resource identity; standalone packages use their declared identity and source path. A content hash and revision drive worker and token-cache invalidation. Re-importing the same stable identity previews an in-place update, while distinct declared resources coexist even when their display labels match. Imports do not silently update over the network. Removal previews affected appearance selections and language associations, then resets them to the applicable built-in inference, default theme, or Plain Text. Project packages remain project-owned files, while original declarations and unsupported source fields remain available for future compatibility.

## Consequences

The canonical language registry includes bundled and imported provenance, aliases, file associations, embedded-language mappings, grammar identity, and version. Cache keys and persisted language choices use stable registry identities rather than raw fence labels or filename extensions.

The language picker becomes a recovery and configuration surface, not an installation prerequisite for ordinary languages. Unsupported or broken grammars never prevent viewing or editing the underlying text.

Theme and language settings therefore follow the same mental model: global defaults, optional project overrides, explicit provenance, and safe fallback. A missing project-local package cannot make its selection leak into or break another project.

Declarative import deliberately stops short of a VS Code extension host. Adding language servers or other executable contributions requires a separate runtime and trust decision.

The hybrid engine adds implementation complexity, but preserves both standards compatibility and the rule that project/imported regex execution cannot block the renderer. Tests compare token output across Markdown, focused source views, diffs, and structured payloads for the same grammar revision.

## Alternatives Considered

**Ship only a curated language list.** Rejected. Lazy loading already avoids startup work, so the restriction would mainly create user friction and inconsistent highlighting.

**Support custom grammars only through a native OpenWaggle package.** Rejected. It would force users to translate standard artifacts before using them.

**Execute imported VS Code extensions.** Rejected. Syntax grammar import does not justify introducing an extension host or running unrelated third-party code.

**Trust declarative grammars because they contain no JavaScript.** Rejected. Regular-expression evaluation is active computation and requires containment against pathological or malicious input.
