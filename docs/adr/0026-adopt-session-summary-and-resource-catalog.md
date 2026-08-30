# Session Summary And Session Resource Catalog

Status: accepted

OpenWaggle will add a Codex-style Session Summary backed by a durable, session-owned resource catalog. Pi remains the runtime/session authority; SQLite and managed files provide the product read model needed to render Sources, Outputs, and images after restart.

## Context

OpenWaggle currently sends image attachments to Pi but projects Pi image blocks back into transcript text such as `[Image input: image/png]`. Attachment capabilities keep an original path only long enough to hydrate a send. The renderer therefore cannot reopen a shared image after reprojection, restart, or deletion of the original file.

The app also spreads persistent session context across the composer, header, diff panel, and incoming Hive controls. Codex gathers comparable task information in a conditional top-right summary and opens richer content in a right sidebar. OpenWaggle needs the same interaction model without treating working-tree changes as outputs, mixing resources from different Sessions, granting extensions transcript access, or moving immediate run controls away from the composer.

## Decision

### Session resources are a product read model

- Add a `SessionResourceRepository` port and SQLite adapter.
- A Session Resource belongs to exactly one Session. Its canonical identity deduplicates occurrences across that Session's transcript branches only. Parent and Worker Sessions remain separate owners.
- Store resource identity, type, title, MIME type, availability, original locator, managed locator, and timestamps in `session_resources`.
- Store every provided, read, created, and updated occurrence with node, branch, actor, and time provenance in `session_resource_occurrences`.
- Derive Source, Output, or both from occurrences. Do not keep competing boolean classifications.
- Use migration 27 for these tables. Migration 26 belongs to the incoming single local Session Host and Hive work.
- Archive retains resources. Permanent Session deletion cascades catalog rows and removes that Session's managed files.

### Image bytes live in managed session storage

- Persist image bytes under an OpenWaggle-owned user-data directory partitioned by Session id and content hash. Transcript JSON and renderer state contain typed resource references, never base64 payloads.
- Validate MIME type and decoded bytes before accepting an image. Local and embedded images use bounded reads and atomic temp-file replacement.
- Bind each prepared local attachment to a SHA-256 content identity carried through hydration and managed-file capture. Size and path checks alone do not authorize a mutable source file.
- Remote Markdown images are cataloged without network access during run settlement, with a per-run cap on agent-authored image references. OpenWaggle materializes and caches one only after the user explicitly opens its preview, using HTTPS only, no ambient credentials, bounded redirects and response size, SSRF-safe address checks, and MIME/byte validation. Unsafe unsanitized formats remain ordinary file resources unless OpenWaggle sanitizes or rasterizes them.
- Failed capture leaves an unavailable catalog entry with Retry and Open original actions. A failed capture must not break transcript projection.
- Existing Sessions are backfilled lazily and idempotently from recoverable Pi image blocks, user attachments, explicit links/tool resources, and resolvable local outputs. Each pass has bounded attachment and image work and resumes by skipping deterministic occurrences already in the catalog.

### Projection emits references and candidates

- Pi projection emits renderer-safe image resource references plus main-process-only capture candidates. The application persists the Pi snapshot and projects its candidates through the resource repository.
- User attachment metadata supplements Pi image blocks so names and original provenance survive. Content identity deduplicates the two observations.
- Explicit signals only become resources: user attachments, Pi image blocks, image-producing tool results, Markdown image syntax, explicit links/tool reads, and declared Outputs. URL-like prose and arbitrary modified workspace files are not inferred.
- Transcript, Summary, and browser thumbnails never prefetch uncached remote images. Opening the image viewer is the user action that authorizes one bounded materialization; the resulting managed copy serves later previews without another network request. Preview IPC returns only a main-process-rasterized WebP bounded to 256 pixels; full payloads are read only for the explicit viewer or download path.
- Commits and created change requests are explicit Outputs. The Environment section owns the complete working-tree change list.

### The Session Summary is host-owned

- Show the Summary only after the first message. Before first send, the existing setup dock owns project, environment, and run target.
- Support the same content in persisted pinned and header-popover modes. Pin it at the top-right, fall back to the popover on narrow layouts, and hide it whenever the right sidebar is open.
- Initial first-party order is Environment, Hive, Outputs, Sources. Add future capabilities as explicitly named conditional sections. Do not add generic Activity or Usage buckets.
- Authorization mode and model context usage remain in the composer before and after first send.
- Environment exposes Changes, Local/worktree, Branch, adaptive commit/push, and provider-specific GitHub PR or GitLab MR actions through existing guarded Git services.
- The change-request composer shows source and target refs, editable branch/title/description, optional commit-and-push, draft and normal creation, and browser fallback. Native creation requires an installed authenticated `gh` or `glab` CLI.
- Hive shows only the opened Session's immediate parent and direct Workers, groups Workers as Active, Done, and Archived, and keeps the agreed per-session expansion behavior.

### Sources, Outputs, and images share navigation

- Sources shows a compact preview, count, and Show all action. Outputs shows a count and bounded list.
- A single active-session Resource Browser occupies the existing right sidebar and has Sources and Outputs tabs. On Session change it clears selection and rebinds atomically before rendering the new Session's data.
- Every transcript, Summary, and browser image opens one full-size gallery. The gallery contains the opened Session's images, orders the active branch path first and other branches after it, and closes on Session change.
- The viewer supports zoom-to-fit, 25/50/100/150/200 percent zoom, centered zoom, drag-to-pan, visible and keyboard navigation, Escape close, download, and local open/reveal when available.

### Extensions contribute data, not renderer code

- Add a declarative Session Summary contribution family to the public extension contract.
- The host renders section labels, rows, counts, badges, disclosures, resource references, and actions. Extensions request `context`, `coordination`, or `details` placement; the host keeps core ordering and deterministic extension ordering.
- Actions may open an already declared extension command, side panel, or dialog through the capability broker. A summary contribution cannot embed HTML, callbacks, React components, writable stores, or direct Electron access.
- Declaring a contribution grants no transcript or resource access. Extensions need the existing explicit broker capability and user approval for any data they read or publish.
- Extension-published resources join Sources or Outputs instead of appearing twice.
- Empty contributions stay hidden. Loading or failure in one extension cannot block the Summary or another section.

## Consequences

The change adds a persistence port/adapter, migration, managed-file service, typed IPC, renderer resource feature, Summary shell, Resource Browser, image viewer, extension contract additions, and provider-aware change-request workflow UI. Tests must cover session isolation, branch provenance, idempotent backfill, archive/delete lifecycle, capture limits and SSRF protection, Session switching, pinned/popover behavior, sidebar yielding, extension isolation, image keyboard/zoom behavior, and GitHub/GitLab workflows. Real hidden Electron QA and end-to-end interaction tests are required because layout ownership, route state, and image rendering cannot be proven through unit tests alone.

## Alternatives considered

**Keep image bytes in transcript JSON.** Rejected because Pi JSONL stays runtime state, large base64 payloads would leak across IPC and renderer memory, and deduplication/lifecycle would remain implicit.

**Treat original attachment paths as durable.** Rejected because files outside the project may move or disappear, and a renderer-controlled path cannot become durable filesystem authority.

**Infer resources from every URL or modified file.** Rejected because it produces false Sources/Outputs and turns repository state into an unreliable artifact feed.

**Allow extensions to mount arbitrary Summary components.** Rejected because it breaks host ordering, responsive behavior, permissions, and failure isolation.

**Use separate viewers for attachments, generated images, and Markdown images.** Rejected because the user is navigating one Session's image history. The category that produced an image remains provenance, not a different viewer.
