# Session resources

Session resources: the capture, catalog and viewer pipeline for files and images a
Session produces, locators, invalidation, the Host-aware resource protocol and extension
resource contributions.
Load when touching `session-resource*` code or the resource viewer.

## Filed under "Electron Runtime Memory"

- The Session resource protocol must use its default Host-aware reader. `index.ts` used to inject a GUI-local `openSessionResourceContentStream` reader, which always found nothing in the client-isolated GUI database, so every image viewer `<img>` got a 404 even though thumbnails (Host-routed IPC) rendered.

## Filed under "Renderer And Session Memory"

- Session-resource run-completion invalidation is keyed by the event's Session id, not the currently opened Session. Background Sessions otherwise retain a fresh-looking cached catalog and omit newly captured resources when reopened.
- Extension resource contributions use the approved `openwaggle.resources` broker capability with explicit Session scope. Publish payloads accept only credential-free HTTPS links/images; the host derives actor, occurrence, canonical identity, and Session ownership. List results expose display metadata only—never locators, managed paths, canonical keys, or occurrence history—and invalidation events carry the affected Session id.
- Session resources retain two distinct locator concepts: the original public locator for provenance/open/reveal and the host-managed path for safe rendering. Raster image status is established from stored bytes, not filenames or declared MIME; SVG remains an ordinary file rather than renderable active content.
- A remote image read refreshes its Session resource projection only after managed content materializes. Refreshing after a failed read bumps the resource revision and immediately repeats the same failed query; failures remain stable until the user explicitly retries.
- After Session Host cutover, Session-resource catalog, backfill, and managed-content reads are Host-owned: the GUI `AppDatabase` is client-isolated and cannot see durable Session nodes. Route resource operations through a revisioned Host UI contract, return only bounded validated image bytes for GUI-native clipboard/attachment/protocol actions, and never add a second database writer. Agent-emitted local Markdown images may be copied only from the Session workspace or dedicated `electron-qa-evidence`/`openwaggle-evidence` directories under the platform temp parents; never authorize the whole shared temp tree. Keep the transcript path as provenance while rendering only the managed copy.

## Filed under "Renderer polish from the beta.25 QA (#356, October 2026)"

- A Markdown image destination means what its author meant (`MarkdownImageOrigin` in `session-resource-extraction-types.ts`). Agents write local screenshots as plain absolute paths, but an `openwaggle_docs` topic writes its screenshots root-relative (`/screenshots/hive-sessions.png`), which are website pages; the installed docs bundle does not ship them. Backfill read them as local files, failed, and stored unavailable "Created by openwaggle_docs" outputs with no locator, whose Open called `shell:open-path` on `/screenshots/…`. `toolResultOutputGroups` now resolves an OpenWaggle topic's images against `OPENWAGGLE_WEBSITE_ORIGIN` (an image source the tool read) and ignores local image paths in Pi and extension topics (`details.source`). Every caller reads a tool group through `collectToolOutputGroupResources`, so live capture, backfill slots and display order agree. Migration 73 (after #366's 72) deletes the stored rows and resets those Sessions' backfill state.
- An unavailable resource offers neither Open nor Reveal (`resourceOriginalPath` returns a path only for an available one): its file could not be read, and a recorded path may not be a file at all.

## Filed under "Syntax And Workspace Editing Memory"

- Session resource invalidation belongs to the workspace lifecycle, not the opened ChatPanel. Invalidate the event's Session key even while another Session or Settings is open. The message-resource semaphore holds each permit until its underlying IPC call settles; aborting a TanStack observer does not cancel main-process work and must not release that permit early.
- Classic, direct Waggle, and agent-triggered Waggle handoffs share `captureRunResultResources` before reporting completion. Capture the follow-on run's persisted messages and node/branch provenance even when its outcome is aborted or failed; capturing only the classic handoff request leaves the resulting collaboration outputs missing from an already-mounted catalog.

## Filed under "Usage statistics recorder and reporter"

Session resource images follow a capture→catalog→viewer pipeline, and each stage has a distinct gate. Agents reference screenshots as Markdown images with plain absolute paths (the evidence-directory convention); `session-resource-markdown-extraction.ts` resolved only `file:` URIs until PR #297, so those references silently became `[Image: alt]` placeholders and nothing reached Sources. The extractor now resolves plain absolute paths too (POSIX, drive-letter, UNC); relative destinations stay ignored, and the capture roots + image validator + size bounds still gate every read at `filesystem-session-resource-source-reader.ts`. `file://` duplicates of an already-captured file deduplicate by content hash into one resource with two occurrences.

An image the agent embeds in its own message is stored with actor `agent`, activity `created`, which classifies it as an output only (`occurrenceRole` derives `is_source`/`is_output` from activity). Since Sources is where a person looks for a conversation's images, PR #297 makes agent-embedded images source AND output, and the Sources catalog view's `activityFilter` hydrates agent image occurrences (otherwise the row would exist without its message placement). Tool-captured images (`actor: 'tool'`) and agent-created files stay output-only. The chat's per-message grid reads through `listSessionResourceNodePage`, which has no activity filter, so it needed no change.

The full-size image viewer can 404 inside the hidden automation app (`bun run dev:debug`): there the GUI's session-command route stays `local` (no host configured) while its app database is client-isolated `:memory:`, so the protocol fallback `openSessionResourceContentStream` reads an empty database and `sessions:resources:host-content` is never tried (the local route returns `handled: false` before the host path). A real attached session has route mode `remote`, where the host serves content bytes and the viewer works. Diagnosed with temporary protocol-handler instrumentation; do not treat an automation-app viewer 404 as a product regression — seed catalog rows and assert the grid, Sources listing and viewer navigation instead.
