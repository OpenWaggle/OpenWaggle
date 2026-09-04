# Syntax Rendering Surface Inventory

Status: accepted implementation inventory

This inventory defines what “use syntax highlighting everywhere” means for the renderer. It was audited against `src/renderer/src/` on 2026-08-27 and is an acceptance checklist for ADRs 0015, 0026, 0027, and 0028.

The governing distinction is semantic: a surface is syntax-rendered when its source language is explicit or reliably derived from a fence, media type, canonical language identity, file association, or workspace-relative path. A monospace font or `<pre>` element alone does not make content source code. Logs, errors, terminal output, and arbitrary strings remain plain or ANSI unless their producer supplies explicit language metadata.

## Target Primitives And Adapters

- **Workspace source adapter** — lightweight virtualized review rendering plus lazy Pierre focused single-file editing over versioned document sessions.
- **Diff adapter** — Pierre for branch, working-tree, turn, and tool-edit diffs.
- **Markdown adapter** — one safe Markdown pipeline whose fenced blocks use the shared syntax service, including streaming append/recall behavior.
- **Syntax block adapter** — compact, explicitly typed source such as a shell command or file fragment.
- **Source view adapter** — larger read-only or paged source with viewport-aware work, semantic virtualized rows, and a complete-source copy action.
- **Structured payload adapter** — tree/table-first JSON, YAML, XML, TOML, or another known structured type with a highlighted source representation.
- **Plain-text/ANSI adapter** — explicit non-syntax rendering for logs, errors, terminal data, prose-only fields, and unknown strings.

These are product contracts rather than a requirement that every feature import the same React component. Feature adapters route through the shared scheduler and registry; the Source view owns workspace review, Pierre owns diffs and focused editing, and Markdown, structured payload, and compact snippets keep purpose-specific adapters.

## Completed Surface Migration

The “Audited gap” column records the pre-implementation baseline found during the 2026-08-27 whole-renderer audit. The “Implemented contract” column is the current contract delivered by this change.

| Area | Current surface | Audited gap | Implemented contract |
| --- | --- | --- | --- |
| Chat | `StreamingText` / `IncrementalMarkdown` assistant Markdown | Shiki exists, but uses a renderer singleton, fixed theme, and mixed completed-prefix/tail paths | Markdown adapter that freezes completed prefixes and sends only the bounded active tail through the cancellable worker with the active theme |
| Chat | Branch and compaction summaries | Reuse `StreamingText` and inherit its limitations | Same Markdown adapter and scheduling rules as assistant messages |
| Chat | `UserMessageBubble` Markdown | Safe Markdown but fenced code is not grammar-highlighted | Same Markdown adapter; preserve composer-reference handling and Markdown safety |
| Chat tools | Bash command arguments | Styled monospace only | Syntax block with explicit Shell/Bash identity; command output remains plain/ANSI |
| Chat tools | File-content arguments and `read` results | Ad hoc fence construction and local size cutoff | Source view using path association, shared tier policy, and visible Plain Text fallback |
| Chat tools | Generic object/array arguments and results | Repeated `JSON.stringify` plus raw `<pre>` | Structured payload adapter with JSON source; strings remain plain unless metadata identifies a language/media type |
| Chat tools | Edit/apply-patch unified diffs | Custom line renderer without grammar tokens | Pierre diff adapter using canonical path language and active Syntax theme |
| Chat tools | Standalone projected tool results | Non-string payloads are stringified and passed through Markdown | Structured payload adapter for typed values; Markdown only when the producing contract declares Markdown |
| Extensions | First-party fallback tool arguments and custom messages | Raw JSON `<pre>` blocks | Structured payload adapter through the host syntax service |
| Extensions | Third-party visual contributions | Extension-owned arbitrary markup | Public framework-neutral host syntax capability and `@openwaggle/extension-react` `SyntaxBlock`/`SourceView`; `SourceView` virtualizes complete source and declines host highlighting above 64 KiB or 2,000 lines; no host rewriting of arbitrary markup |
| Workspace | Workspace source editing | Controlled `<textarea>`, duplicate full strings, 2 MiB edit cutoff, full-snapshot IPC | Worktree-aware lightweight Source view with explicit lazy Pierre Focused file edit, revision-checked saves, durable active-file recovery, and a 1 MiB editing boundary |
| Workspace | Markdown file preview | Safe prose render without fenced-code highlighting | Markdown adapter using the active registry/theme; HTML rendered preview remains a sandboxed document preview |
| Workspace | Large-file source view | Current oversized files are unavailable | Clearly labelled paged virtualized source view with approximately 256 KiB requests and external-editor handoff, without force-full-edit |
| Workspace | `ProjectContentSearch` result lines | Plain monospace line snippets | Viewport-prioritized syntax lines using the matched workspace path, canonical language association, and highlighted match range |
| Workspace | `WorkspaceFileBrowser` | Read/filter/open only and keyed to the primary project path | Active-working-path explorer with safe create/rename/move/duplicate/trash/reveal actions, coalesced external-change updates, and coordinated active-file/document/cache identity |
| Diffs | Main diff panel and Syntax theme sample | Pierre with a separate fixed theme setting | Pierre adapter using the canonical registry and resolved four-variant theme package |
| Settings / MCP | `McpSourceEditor` | Synchronous highlighted-textarea overlay with JSON only | Compact Pierre-backed JSON editor sharing the focused-edit and syntax contracts without language services |
| Settings / MCP | Event inbox payloads | Raw `JSON.stringify` `<pre>` | Structured payload adapter with JSON tree/source views |
| Settings / MCP | Resource and prompt results | Flattened text; structured values stringify without shared highlighting | Media-type-aware structured payload or Markdown/source adapter; retain attribution and untrusted-content labels |
| Settings / MCP | Server instructions | Plain draft text | Markdown adapter when the contract declares Markdown; otherwise Plain Text |
| Settings / MCP | Remote Skill instructions and reviews | Raw Markdown in `<pre>` | Safe Markdown adapter with highlighted fences and preserved trust/digest messaging |
| MCP Apps | Staged context and typed tool payloads | JSON embedded into plain draft strings | Structured payload adapter before attachment; MCP App-owned UI remains governed by its protocol boundary |
| Skills | `SkillPreviewPane` | Safe Markdown without fenced-code highlighting | Same Markdown adapter used by chat and workspace previews |
| Settings / themes | Syntax theme preview | Pierre-only sample | Reversible preview transaction showing focused source, Markdown, diff, and structured-payload samples with explicit real languages |

## Intentional Plain Or Non-Syntax Surfaces

| Surface | Reason |
| --- | --- |
| Terminal | xterm/ANSI owns terminal semantics; grammar highlighting would destroy terminal colour and control-state meaning |
| Shell/tool output and generic logs | Output is a stream, not necessarily source; use ANSI or plain rendering unless explicit language/media metadata is supplied |
| Error details and stack/error cards | Preserve exact diagnostic text and wrapping; do not guess a grammar from punctuation |
| Authorization and generic interaction messages | Human-readable consent/protocol prose; structured subfields may use a structured payload view separately |
| Inline Markdown code | Usually lacks enough language context for grammar tokenization; retain inline-code styling |
| Composer, queued messages, feedback, commit messages, review comments, labels, and role descriptions | Prose entry fields, not source documents, unless a future typed contract explicitly declares Markdown or another language |
| File paths, line numbers, identifiers, and status labels | Monospace presentation does not imply source syntax |
| Sandboxed HTML preview | Renders the document rather than its source; the adjacent focused source view owns HTML source highlighting |
| Binary, image, and PDF previews | Not text grammar surfaces |
| App error boundary | Recovery UI must remain independent of optional syntax infrastructure |

## Language Resolution

Adapters resolve language in this order:

1. explicit canonical language identity supplied by the producer or user;
2. declared media type or structured-payload type;
3. project/user filename association for a root-confined workspace path;
4. bundled filename/path inference;
5. fenced-code alias;
6. typed serializer identity such as JSON;
7. visible Plain Text fallback.

Arbitrary string content is never sniffed into JSON, source code, or a semantic language merely because parsing happens to succeed. User overrides and project associations follow ADR 0027.

## Enforcement And Acceptance

- Repository standards reject direct Shiki highlighter/worker construction outside the syntax infrastructure and approved Pierre adapters.
- New feature-owned raw block rendering must use an approved syntax, structured, Markdown, diff, plain-text, or ANSI adapter. A repository check flags direct `<pre>` additions outside the primitive implementations; intentional plain blocks carry a reviewed reason through the plain-text adapter.
- Focused unit, component, integration, and Electron tests cover representative surfaces across language resolution, active-theme changes, loading/failure fallback, copyable source fidelity, worktree identity, editing, and imports.
- Streaming tests prove append work does not reparse or rerender the stable transcript prefix; superseded active-tail syntax requests cancel cleanly.
- Worktree tests prove file/search language resolution and cache identity use the active working path and do not collide across identical relative paths.
- Representative focused-edit, Markdown, tool payload, search, theme-preview, high-contrast, and large-file flows are exercised in the real macOS arm64 Electron app. The production build must contain the preload bridge and worker-backed highlighting without Monaco chunks or language workers. Import and failure behavior remain explicit release verification cases.
- The migration is incomplete while a required row remains on a feature-local highlighter, fixed Syntax theme, highlighted-textarea overlay, Monaco path, or unclassified raw `<pre>` path.
