# Product and UX

Product decisions that constrain the UI: the Session Summary default, Projects-only
navigation, when the UI may name Pi, Waggle scope and agent count, and path display.
Load when making a product or UX decision; run the `grill-with-docs` skill for new ones.

## Product And UX Memory

- The Session Summary is shown by default (ADR 0026 amendment, #439). It docks when the chat panel keeps `CHAT_MIN_WIDTH` beside its 332px footprint, a 752px panel (`use-session-summary-space.ts`). Narrower, or while a floating browser preview shows, it auto-hides and an explicit open is a transient overlay; the right sidebar hides it entirely. A docked Summary moves every `CHAT_CONTENT_FRAME_CLASS` frame clear of it, not the panel: the hook sets `--session-summary-reserve` (`sessionSummaryReservePx`) and an unlayered globals.css rule keyed on `.session-summary-docking:has(> div > aside[data-session-summary-mode="persistent"])` re-centers the frames, so the transcript scroller and its scrollbar keep the full width. Padding the panel instead stopped wheel scrolling in the right strip and put the scrollbar under the Summary. The old rule (dock only beside the centered 720px column, a 1,384px panel) hid it at the default 1,200px window and every laptop width; a plain overlay covered right-aligned user messages. Website screenshot captures hide the Summary when `openSession` opens a Session.
- Pi-native sidebar navigation is Projects-only. Do not add a global projectless Chats section.
- The UI may name Pi only for resources Pi owns (ADR 0051): "Pi, all projects", Pi sessions, Pi's settings, `~/.pi/agent/mcp.json`. `renderer-visible-identifiers.unit.test.ts` scans JSX text and label attributes only, so a label kept in a string map (`Record<Kind, string>`) is invisible to it; Settings > MCP's file names became the `McpFileName` component for that reason. Ternary attribute values (`emptyText={x ? a : 'Pi did…'}`) are not scanned either.
- Waggle mode must run inside Pi as extension/runtime behavior, not as an OpenWaggle application loop that calls Pi once per agent turn.
- Waggle currently supports exactly two agents. Third-agent JSON edits must be rejected at core, Pi extension, shared schema, store schema, and application-service boundaries until N-agent turn policy, prompts, consensus, and UI are implemented first-class.
- Waggle and standard mode share session, branch, draft, archive, transcript, active-run, composer, settings, diff, and git semantics unless Pi imposes a narrow technical constraint.
- Composer branch/config changes are branch-scoped; child branches inherit parent config by default.
- User-facing filesystem paths are relative to the active Session working root or project root. Canonical absolute `WorkingPath` and `RepositoryPath` values stay internal for IPC, filesystem operations, and copy actions; first-party UI must never expose OpenWaggle's worktree storage prefix.
