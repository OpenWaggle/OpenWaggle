# 45 — Archived Threads

**Status:** Planned
**Priority:** P4
**Category:** Feature
**Depends on:** None (benefits from Spec 39 context window awareness for auto-archive suggestions)
**Origin:** Multi-agent conversation review — SettingsNav has disabled "Archived threads" tab (line 29), `SettingsTab` type includes `'archived'` (ui-store.ts line 15)

---

## Problem

Conversations can only be **kept** or **deleted**. There is no middle state. This creates two problems:

1. **Cluttered sidebar**: Long-time users accumulate dozens/hundreds of conversations in the sidebar list. There's no way to hide old conversations without permanently deleting them.
2. **Lost context**: Deleting a conversation removes all context forever. Users are reluctant to delete even stale conversations because they might contain useful context or decisions.

The product needs a **non-destructive archive** — conversations moved out of the active list but retrievable when needed.

### What Exists

- `SettingsNav.tsx` line 29: `archived` tab — `enabled: false`, icon: `Archive`
- `ui-store.ts` line 15: `SettingsTab` type includes `'archived'`
- **Conversation persistence** (`src/main/store/conversations.ts`):
  - `listConversations()` — reads all JSON files from `{userData}/conversations/`
  - `deleteConversation()` — permanently deletes the JSON file
  - `Conversation` type (`src/shared/types/conversation.ts`) — no archive flag
  - `ConversationSummary` type — displayed in sidebar, no archive state
- **Sidebar** (`src/renderer/src/components/layout/Sidebar.tsx`):
  - Renders all conversations from `listConversations()`
  - Delete action directly calls `deleteConversation()`
  - No filter/section for archived vs active

### What Conversation Lifecycle Should Look Like

```
Created → Active → [Archived] → [Restored to Active | Permanently Deleted]
```

Currently it's just: `Created → Active → Deleted`

### Reference: How other tools do this

| Tool | Archive Concept |
|------|----------------|
| Gmail | Archive removes from inbox but keeps searchable. Star/label for organization. |
| Slack | Archive channel — read-only, hidden from sidebar, searchable |
| Linear | Archive issues — removed from active views, available in filtered views |
| ChatGPT | No archive — conversations can only be kept or deleted (same gap) |
| Claude.ai | No archive — same gap |

## Architecture

### Storage Strategy

Two approaches, **Option A recommended**:

**Option A: Metadata flag (recommended)**
- Add `archivedAt?: number` to `Conversation` type
- `listConversations()` gets optional `includeArchived` parameter
- Sidebar filters out archived conversations by default
- Archive = set `archivedAt` to `Date.now()`; Unarchive = clear the field
- Pro: Simple, backward-compatible, no file moves
- Con: All conversations still loaded on startup (mitigated by Spec 03 lazy loading if implemented)

**Option B: Separate directory**
- Move archived conversations to `{userData}/conversations/archived/`
- `listConversations()` only reads from active directory
- `listArchivedConversations()` reads from archive directory
- Pro: Active conversation loading is faster (fewer files)
- Con: File moves are less atomic, need to handle cross-directory operations

### Archive Behavior

When a conversation is archived:
- Removed from sidebar active list immediately
- Not deleted from disk — still searchable via archived threads view
- Can be restored to active with one click
- Can be permanently deleted from archive

## Implementation

### Phase 1: Core archive mechanism

- [ ] Add `archivedAt?: number` to `Conversation` type in `src/shared/types/conversation.ts`
- [ ] Add `archivedAt` to conversation Zod schema in `src/main/store/conversations.ts` (optional number, backward-compatible)
- [ ] Add `archivedAt` to `ConversationSummary` type
- [ ] Add IPC channels:
  - `'conversations:archive'` — sets `archivedAt` on a conversation
  - `'conversations:unarchive'` — clears `archivedAt`
  - `'conversations:list-archived'` — returns only archived conversations
- [ ] Update `listConversations()` to exclude archived conversations by default
  - Add optional `filter?: { includeArchived?: boolean }` parameter

### Phase 2: Sidebar integration

- [ ] In `Sidebar.tsx`:
  - Filter out conversations where `archivedAt` is set
  - Add "Archive" action to conversation context menu (alongside existing "Delete")
  - Add small "Archived (N)" link at bottom of conversation list → navigates to archived threads view
- [ ] Add swipe-to-archive gesture (if applicable) or right-click context menu
- [ ] Add bulk archive: "Archive all conversations older than X days"

### Phase 3: Archived threads view (Settings tab)

- [ ] Enable `archived` tab in `SettingsNav.tsx` (line 29)
- [ ] Create `src/renderer/src/components/settings/sections/ArchivedSection.tsx`:
  - List of archived conversations: title, date archived, message count
  - Sort by archive date (most recent first)
  - Actions per conversation: Restore, Delete permanently, View (read-only)
  - Bulk actions: "Delete all archived", "Restore all"
  - Search within archived conversations (by title)
- [ ] Add to `SettingsPage.tsx` tab switch

### Phase 4: Smart archive suggestions (optional)

- [ ] Auto-suggest archive for stale conversations:
  - Conversations not updated in 7+ days
  - Conversations with context window exhaustion (ties to Spec 39)
  - Show: "You have N idle conversations. [Archive all] [Choose]"
- [ ] Auto-archive on context window exhaustion:
  - When Spec 39 detects a conversation can't continue
  - Offer: "Archive this conversation and start fresh? [Archive & New] [Keep]"

## Files to Create

- `src/renderer/src/components/settings/sections/ArchivedSection.tsx` — archived threads view

## Files to Modify

- `src/shared/types/conversation.ts` — add `archivedAt` to `Conversation` and `ConversationSummary`
- `src/main/store/conversations.ts` — archive/unarchive operations, filtered listing, Zod schema update
- `src/shared/types/ipc.ts` — archive IPC channels
- `src/renderer/src/components/layout/Sidebar.tsx` — filter archived, add archive action
- `src/renderer/src/components/settings/SettingsNav.tsx` — enable archived tab (line 29)
- `src/renderer/src/components/settings/SettingsPage.tsx` — add ArchivedSection

## Tests

- Unit: `listConversations()` excludes archived conversations by default
- Unit: `listConversations({ includeArchived: true })` includes all
- Unit: archive sets `archivedAt`, unarchive clears it
- Unit: backward-compatible load of conversations without `archivedAt` field (treated as not archived)
- Component: sidebar hides archived conversations
- Component: archived section renders list with restore/delete actions
- Component: archive action in context menu calls correct IPC
