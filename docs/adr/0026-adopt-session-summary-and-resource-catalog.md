# Session Summary And Session Resource Catalog

Status: accepted

OpenWaggle will add a Codex-style Session Summary backed by a durable, session-owned resource catalog. Pi remains the runtime/session authority; SQLite and managed files provide the product read model needed to render Sources, Outputs, and images after restart.

## Parity baseline

The observable reference is Codex GUI `26.831.21537`, build `7579`, audited on 2026-09-04 and preserved in the [Session Summary reference capture](../performance/session-summary-reference-capture-2026-09-04.md). This pin makes the parity claim testable. A later Codex release changes the reference only after another behavior audit and an explicit update to this decision.

Parity means matching the reference interaction for capabilities OpenWaggle truthfully owns, not rendering placeholders for unavailable product domains. The mapping for this baseline is:

| Codex behavior | OpenWaggle behavior |
| --- | --- |
| Summary appears after a task has content | Summary appears after the first sent message |
| Top-right floating panel, responsive suppression, header toggle | Same overlay behavior; it never reserves transcript or composer width |
| Environment sections for discovered repositories | One Environment section for the session's single bound project/working tree; OpenWaggle has no multi-root Session model |
| Changes, environment, branch, Commit or push, change request | Same separate controls through guarded Git services; View PR/MR opens a Session-bound in-app lifecycle inspector |
| GitHub pull-request workflow | Same composer interaction, native `gh` path, exact-host readiness, and browser fallback |
| GitLab link discovery | Native GitLab merge-request composition through `glab`, an explicit OpenWaggle superset |
| Conditional Scheduled, Plan, Side chats, task, computer-use, browser, and process sections | Rendered only when an equivalent OpenWaggle capability and session-owned state exist; no empty or invented sections |
| Subagents and created tasks | Hive, using immutable parent/direct-Worker lineage and delegation state |
| Outputs and Sources | Durable session-owned catalog with exact-item navigation and provenance |
| Shared image enlargement and gallery navigation | One active-session gallery from transcript, Summary, and Resource Browser |
| Host-defined sections | Host-owned descriptors plus declarative, isolated extension contributions |

Authorization remains in the composer by product decision. OpenWaggle does not add generic Activity or Usage sections because it owns neither a useful Activity bucket nor a truthful account-quota source.
## Context

OpenWaggle currently sends image attachments to Pi but projects Pi image blocks back into transcript text such as `[Image input: image/png]`. Attachment capabilities keep an original path only long enough to hydrate a send. The renderer therefore cannot reopen a shared image after reprojection, restart, or deletion of the original file.

The app also spreads persistent session context across the composer, header, diff panel, and incoming Hive controls. Codex gathers comparable task information in a conditional top-right summary and opens richer content in a right sidebar. OpenWaggle needs the same interaction model without treating working-tree changes as outputs, mixing resources from different Sessions, granting extensions transcript access, or moving immediate run controls away from the composer.

## Decision

### Session resources are a product read model

- Add a `SessionResourceRepository` port and SQLite adapter.
- A Session Resource belongs to exactly one Session. Its canonical identity deduplicates occurrences across that Session's transcript branches only. Parent and Worker Sessions remain separate owners.
- Store resource identity, type, title, MIME type, availability, a fallback locator, managed locator, and timestamps in `session_resources`.
- Store every provided, read, created, and updated occurrence with node, branch, actor, time provenance, and the original path or URL observed for that exact occurrence in `session_resource_occurrences`.
- For provenance and Open/reveal actions, prefer the matching occurrence on the visible transcript path, then the latest matching occurrence, and use the resource fallback only when that occurrence has no locator.
- Occurrences remain the canonical evidence for Source, Output, or both. The resource row's
  `is_source` and `is_output` columns are denormalized occurrence-derived projections used only for
  bounded filtering and exact counts; migrations recompute them and occurrence upserts may only
  widen them. They are not a competing classification truth.
- Use migration 27 for these tables. Migration 26 persists the Session Host's immutable parent/Worker relationship and delegation state in `session_lineage`.
- Archive retains resources. Permanent Session deletion cascades catalog rows and removes that Session's managed files.

### Image bytes live in managed session storage

- Persist image bytes under an OpenWaggle-owned user-data directory partitioned by Session id and content hash. Transcript JSON and full-content renderer state contain typed resource references, never full base64 payloads. Explicit viewer and download reads return short-lived opaque, owner-bound protocol URLs; the main process revalidates the Session/resource pair and streams a freshly confined managed-file handle for each request. The renderer announces every displayed-Session transition independently of resource reads, immediately revoking the previous Session's URLs and in-flight grants even when the destination never opens a resource. The only renderer base64 exception is a transient main-rasterized WebP thumbnail bounded to 256 pixels.
- Validate MIME type and decoded bytes before accepting an image. Local and embedded images use bounded reads and atomic temp-file replacement.
- Bind each prepared local attachment to a SHA-256 content identity carried through hydration and managed-file capture. Size and path checks alone do not authorize a mutable source file.
- Remote Markdown images are cataloged without network access during run settlement, with a per-run cap on agent-authored image references. OpenWaggle materializes and caches one only after the user explicitly opens its preview, using HTTPS only, no ambient credentials, bounded redirects and response size, SSRF-safe address checks, and MIME/byte validation. Unsafe unsanitized formats remain ordinary file resources unless OpenWaggle sanitizes or rasterizes them.
- Failed capture leaves an unavailable catalog entry with Retry and Open original actions. A failed capture must not break transcript projection.
- Existing Sessions are backfilled lazily and idempotently from recoverable Pi image blocks, user attachments, explicit links/tool resources, and resolvable local outputs. Each pass has bounded attachment, image, and shared user/agent link work and resumes by skipping deterministic occurrences already in the catalog.

### Projection emits references and candidates

- Pi projection emits renderer-safe image resource references plus main-process-only capture candidates. The application persists the Pi snapshot and projects its candidates through the resource repository.
- User attachment metadata supplements Pi image blocks so names and original provenance survive. Content identity deduplicates the two observations.
- Explicit signals only become resources: user attachments, Pi image blocks, image-producing tool results, Markdown image syntax, explicit links/tool reads, and declared Outputs. URL-like prose and arbitrary modified workspace files are not inferred.
- Transcript, Summary, and browser thumbnails never prefetch uncached remote images. Opening the image viewer is the user action that authorizes one bounded materialization; the resulting managed copy serves later previews without another network request. Thumbnail IPC returns only a transient main-process-rasterized WebP bounded to 256 pixels. Full viewer and download payloads use the managed streaming protocol and never cross IPC as base64.
- Commits and created change requests are explicit Outputs. The Environment section owns the complete working-tree change list.

### The Session Summary is host-owned

- Show the Summary only after the first message. Before first send, the existing setup dock owns project, environment, and run target.
- Render the same content in one top-right floating overlay after the first message. It never reserves transcript or composer width. Hide it automatically when the chat container is too narrow or the right sidebar opens, but keep a Layout list toggle in the header available so the user can explicitly reopen or hide the overlay at any width.
- Initial first-party order is Environment, Hive, Outputs, Sources. Add future capabilities as explicitly named conditional sections. Do not add generic Activity or Usage buckets.
- The order may include truthful named conditional capabilities around that spine. For this baseline, active event subscriptions appear as Subscriptions and declarative extension placements remain deterministic; absent product domains do not render empty sections.
- Authorization mode and model context usage remain in the composer before and after first send.
- Environment exposes Changes, Local/worktree, Branch, adaptive commit/push, and provider-specific GitHub PR or GitLab MR actions through existing guarded Git services.
- The change-request composer shows source and target refs, editable branch/title/description, optional commit-and-push, draft and normal creation, and browser fallback. Native creation requires an installed authenticated `gh` or `glab` CLI.
- An existing request opens in a right-sidebar lifecycle inspector rather than launching the browser. The inspector lists only the current-branch request and additional change-request Outputs owned by the opened Session through a dedicated bounded catalog view, shows bounded provider detail, and makes opening the provider URL explicit. Unrelated Outputs cannot hide a request from that view.
- Merge actions are provider-neutral at the renderer boundary. Main verifies the Session working path and exact repository-owned request identity, requires native confirmation, then revalidates identity, merge availability, and the expected head commit before an SHA-guarded `gh` or `glab` merge.
- Hive shows only the opened Session's immediate parent and direct Workers, groups Workers as Active, Done, and Archived, and keeps the agreed per-session expansion behavior.
- The hosted-task admission path records a new child Session's origin Session and caller profile once, then advances its delegation state through working, accepted, needs-attention, or cancelled. Session-list projection derives Queen/Worker roles and direct/active counts from those rows, including archived Workers; it never infers Hive data from renderer fixtures or task JSON alone.
- Permanent deletion preserves that lineage: a Queen with any direct Worker, including a completed or archived Worker, cannot be deleted until those Workers are deleted. Whole-project removal deletes Hive leaves before their parents.

### Sources, Outputs, and images share navigation

- Sources and Outputs each show an exact count, compact bounded preview, and Show all action.
- A single active-session Resource Browser occupies the existing right sidebar and has Sources and Outputs tabs. On Session change it clears selection and rebinds atomically before rendering the new Session's data.
- Every transcript, Summary, and browser image opens one full-size gallery. The gallery contains the opened Session's images, orders every ancestor and leaf occurrence on the active transcript path before other branches, and closes on Session change. A targeted location query supplies an exact ordinal and adjacent resources for deep links without scanning all preceding pages.
- Inline-image discovery follows the transcript's bounded visible window. Opening a very large Session queries only the newest mounted rows; loading earlier rows expands discovery on demand instead of attaching one query observer per historical chunk.
- Summary previews use exact counts with small first pages. The Resource Browser and gallery use
  stable keyset cursors, bounded occurrence previews, and targeted exact-item reads. A monotonic
  per-Session catalog revision invalidates a continuation after any resource or occurrence mutation;
  the renderer discards mixed-revision pages and restarts from page one.
- The viewer supports zoom-to-fit, 25/50/100/150/200 percent zoom, +/- controls,
  Cmd/Ctrl-wheel trackpad zoom, centered zoom, drag-to-pan, visible and keyboard navigation, Escape
  close, Copy image, Add to chat through the registered attachment pipeline, download, and local
  open/reveal when available. Copy and attachment preparation accept only Session and resource ids;
  main resolves the owned managed content and rejects cross-Session or non-image requests.
- Chat Markdown never mounts an author- or tool-supplied `<img src>`. It renders a non-fetching label
  while the session-owned resource projection supplies the sole thumbnail and explicit viewer path.

### Extensions contribute data, not renderer code

- Add a declarative Session Summary contribution family to the public extension contract.
- The host renders section labels, rows, counts, badges, disclosures, resource references, and actions. Extensions request `context`, `coordination`, or `details` placement; the host keeps core ordering and deterministic extension ordering.
- Actions may open an already declared extension command, side panel, or dialog through the capability broker. A summary contribution cannot embed HTML, callbacks, React components, writable stores, or direct Electron access.
- Declaring a contribution grants no transcript or resource access. Extensions need the existing explicit broker capability and user approval for any data they read or publish.
- Extension-published resources join Sources or Outputs instead of appearing twice.
- Empty contributions stay hidden. Loading or failure in one extension cannot block the Summary or another section.

## Consequences

The change adds a persistence port/adapter, migration, managed-file service, typed IPC, renderer resource feature, Summary shell, Resource Browser, image viewer, extension contract additions, and provider-aware change-request workflow UI. Tests must cover session isolation, branch provenance, idempotent backfill, archive/delete lifecycle, capture limits and SSRF protection, Session switching, floating-overlay responsiveness, sidebar yielding, extension isolation, image keyboard/zoom behavior, and GitHub/GitLab workflows. Real hidden Electron QA and end-to-end interaction tests are required because layout ownership, route state, and image rendering cannot be proven through unit tests alone.

## Alternatives considered

**Keep image bytes in transcript JSON.** Rejected because Pi JSONL stays runtime state, large base64 payloads would leak across IPC and renderer memory, and deduplication/lifecycle would remain implicit.

**Treat original attachment paths as durable.** Rejected because files outside the project may move or disappear, and a renderer-controlled path cannot become durable filesystem authority.

**Infer resources from every URL or modified file.** Rejected because it produces false Sources/Outputs and turns repository state into an unreliable artifact feed.

**Allow extensions to mount arbitrary Summary components.** Rejected because it breaks host ordering, responsive behavior, permissions, and failure isolation.

**Use separate viewers for attachments, generated images, and Markdown images.** Rejected because the user is navigating one Session's image history. The category that produced an image remains provenance, not a different viewer.
