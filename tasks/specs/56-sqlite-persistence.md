# 56 — SQLite Persistence

**Status:** Not Started
**Priority:** P2
**Category:** Enhancement (Infrastructure)
**Depends on:** None (but synergizes with Spec 55 for checkpoint storage)
**Origin:** T3Code competitive analysis — t3code uses SQLite with native `node:sqlite` bindings for all persistence. Reference: [t3code](https://github.com/pingdotgg/t3code) SQLite persistence with custom Effect SQL bindings.

---

## Problem

OpenWaggle uses JSON files for conversation persistence (`src/main/store/conversations.ts`):

- **Conversations** stored as individual JSON files in `{userData}/conversations/{id}.json`
- **Index** maintained separately in `{userData}/conversations/index.json`
- Protected by `AsyncMutex` for concurrent access safety
- Atomic writes via `atomicWriteJSON()` (temp file + rename)
- `electron-store` for settings (also JSON-based, in OS config dir)

This approach has scaling issues:

1. **Loading large conversations** — Entire conversation JSON must be parsed to read any part of it. A conversation with 500 messages loads all 500 message objects into memory.
2. **No indexing** — Cannot search across conversations without loading every file. No way to efficiently query "all conversations mentioning file X" or "conversations from last week."
3. **File I/O overhead** — Each save rewrites the entire conversation file. For large conversations, this becomes expensive.
4. **Index maintenance** — The separate `index.json` file must be kept in sync with conversation files. Crashes between writing the conversation and updating the index can cause inconsistencies.
5. **No efficient pagination** — Cannot load "messages 50-60" without parsing the entire file first.
6. **Concurrent access** — Manual `AsyncMutex` works but is fragile; SQLite provides proper ACID transactions.

### What t3code Does

t3code uses SQLite (via native `node:sqlite`) with:
- Event sourcing events stored in SQLite tables
- Proper schema with migrations
- WAL mode for concurrent reads during writes
- Custom SQL bindings integrated with their Effect runtime

## Library Investigation

This spec requires evaluating two SQLite options before implementation:

### Option A: `better-sqlite3`

| Aspect | Details |
|--------|---------|
| Maturity | 7+ years, 5K+ GitHub stars, widely used in Electron apps |
| API | Synchronous (blocking) — simple, predictable, no callback hell |
| Performance | Very fast for typical desktop workloads; synchronous API avoids event loop overhead |
| Native addon | Yes — requires `node-gyp` compilation, which adds build complexity |
| Electron compatibility | Excellent — explicitly supports Electron with prebuild binaries via `prebuild-install` |
| electron-rebuild | Required after Electron version upgrades |
| WAL mode | Supported |
| Thread safety | Single-connection; safe for Electron main process (single-threaded) |
| Bundle size | ~4MB native binary |

### Option B: `node:sqlite`

| Aspect | Details |
|--------|---------|
| Maturity | Introduced Node 22.5.0 (experimental), stabilized Node 23+ |
| API | Synchronous, similar to better-sqlite3 |
| Performance | Comparable to better-sqlite3 |
| Native addon | None — built into Node.js runtime |
| Electron compatibility | **Uncertain** — Electron bundles its own Node version; `node:sqlite` availability depends on Electron's Node version |
| Stability | Experimental flag in Node 22; may have breaking changes |
| Documentation | Limited compared to better-sqlite3 |
| Community | No established Electron usage patterns yet |

### Recommendation Criteria

The spec implementation should:
1. Benchmark both options on real conversation data (load, save, query, search)
2. Verify Electron compatibility (especially `node:sqlite` with current Electron 40)
3. Assess build pipeline impact (native addon compilation for CI, release builds)
4. Document findings in this spec before proceeding with implementation

## Implementation

### Phase 1: Database Setup & Schema

- [ ] **Evaluate and select** library based on investigation above (document decision here)
- [ ] Create `src/main/store/database.ts`:
  - Initialize SQLite database at `{userData}/openwaggle.db`
  - Enable WAL mode: `PRAGMA journal_mode=WAL`
  - Enable foreign keys: `PRAGMA foreign_keys=ON`
  - Set busy timeout: `PRAGMA busy_timeout=5000`
  - Export singleton `getDatabase(): Database` getter
  - Handle database creation on first launch
- [ ] Create schema migration system in `src/main/store/migrations/`:
  - `src/main/store/migrations/runner.ts` — migration executor
  - Migration table: `CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`
  - Migrations run in order on app startup
  - Each migration is a function: `(db: Database) => void`
  - Forward-only (no rollback — keep schema changes additive)
- [ ] Create initial migration `src/main/store/migrations/001-initial-schema.ts`:
  ```sql
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL,
    project_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    plan_mode INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT DEFAULT '{}'
  );

  CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
  CREATE INDEX idx_conversations_project ON conversations(project_path);
  CREATE INDEX idx_conversations_archived ON conversations(archived);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    created_at TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    metadata_json TEXT DEFAULT '{}'
  );

  CREATE INDEX idx_messages_conversation ON messages(conversation_id, sort_order);

  CREATE TABLE message_parts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE INDEX idx_parts_message ON message_parts(message_id, sort_order);

  CREATE TABLE checkpoints (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_index INTEGER NOT NULL,
    tool_call_id TEXT,
    created_at TEXT NOT NULL,
    label TEXT NOT NULL,
    project_path TEXT NOT NULL,
    diffs_json TEXT NOT NULL
  );

  CREATE INDEX idx_checkpoints_conversation ON checkpoints(conversation_id, created_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ```

### Phase 2: Repository Layer

- [ ] Create `src/main/store/repositories/conversation-repository.ts`:
  - `getAll(options?: { archived?: boolean, limit?: number, offset?: number }): ConversationSummary[]`
  - `getById(id: ConversationId): Conversation | null` — loads conversation with all messages and parts
  - `create(conversation: NewConversation): Conversation`
  - `update(id: ConversationId, updates: Partial<ConversationMetadata>): void`
  - `delete(id: ConversationId): void` — CASCADE deletes messages, parts, checkpoints
  - `search(query: string): ConversationSummary[]` — full-text search across message content
  - `getMessageCount(id: ConversationId): number` — efficient count without loading
  - All methods use prepared statements for performance
  - Transaction wrapping for multi-table operations

- [ ] Create `src/main/store/repositories/message-repository.ts`:
  - `getByConversation(conversationId: ConversationId, options?: { limit?: number, offset?: number }): Message[]`
  - `append(conversationId: ConversationId, message: Message): void`
  - `truncateAfter(conversationId: ConversationId, messageIndex: number): void` — for checkpoint revert
  - `getLatest(conversationId: ConversationId, count: number): Message[]` — for context window
  - Parts are loaded eagerly with messages (JOIN query)

- [ ] Create `src/main/store/repositories/settings-repository.ts`:
  - `get<T>(key: string, schema: z.ZodType<T>): T | undefined`
  - `set(key: string, value: unknown): void`
  - `getAll(): Record<string, unknown>`
  - `delete(key: string): void`
  - Replaces `electron-store` for settings persistence

- [ ] Create `src/main/store/repositories/checkpoint-repository.ts`:
  - `getByConversation(conversationId: ConversationId): CheckpointSummary[]`
  - `getById(conversationId: ConversationId, checkpointId: CheckpointId): Checkpoint | null`
  - `save(checkpoint: Checkpoint): void`
  - `deleteAfter(conversationId: ConversationId, checkpointId: CheckpointId): void`
  - `prune(conversationId: ConversationId, maxCount: number): void`

### Phase 3: JSON → SQLite Migration

- [ ] Create `src/main/store/migrations/json-to-sqlite.ts`:
  - Runs once on first launch after upgrade
  - Detects JSON conversations exist: checks `{userData}/conversations/index.json`
  - Migration steps:
    1. Read all JSON conversation files
    2. Validate with Zod schemas (handle legacy formats via `LEGACY_MODEL_MAP`)
    3. Insert into SQLite tables within a single transaction
    4. Migrate `electron-store` settings to SQLite `settings` table
    5. Verify migration: count records in SQLite match JSON file count
    6. Rename JSON directory to `{userData}/conversations-backup-{timestamp}/` (keep as rollback)
    7. Write migration marker: `{userData}/.sqlite-migrated`
  - **Safety:** Never delete JSON files — only rename. User can manually delete after verifying.
  - **Idempotent:** If migration marker exists, skip. If migration fails mid-way, rollback transaction — next launch retries.
  - **Logging:** Detailed structured logs for each step (file count, record count, timing)
- [ ] Handle edge cases:
  - Corrupted JSON files → skip with warning log, continue migration
  - Very large conversations (1000+ messages) → batch inserts for memory efficiency
  - Concurrent launches during migration → mutex on migration marker file

### Phase 4: Wire Repositories to Existing Code

- [ ] Replace `src/main/store/conversations.ts` internals:
  - Keep the same exported API surface (functions used by IPC handlers)
  - Swap JSON file operations for `ConversationRepository` calls
  - Remove `AsyncMutex` (SQLite handles concurrency)
  - Remove `atomicWriteJSON` calls (SQLite transactions are atomic)
  - Keep `loadConversation`, `saveConversation`, `listConversations` function signatures unchanged
- [ ] Replace `electron-store` usage in `src/main/store/settings.ts`:
  - Swap `electron-store` calls for `SettingsRepository` calls
  - Handle encrypted fields: settings that were encrypted by electron-store need decryption during migration
  - API keys: continue using OS keychain integration if available, fall back to SQLite with encryption
- [ ] Wire checkpoint repository if Spec 55 has been implemented:
  - Replace JSON checkpoint storage with `CheckpointRepository`
  - If Spec 55 not yet done, prepare the repository for when it ships

### Phase 5: Cleanup & Optimization

- [ ] Remove dependencies: `electron-store` (if fully replaced)
- [ ] Add database backup command:
  - IPC channel `'database:backup'` → copies `.db` file to user-chosen location
  - Triggered from Settings or menu bar
- [ ] Add database integrity check on startup:
  - `PRAGMA integrity_check` on launch
  - If corruption detected, attempt repair or fall back to JSON backup
- [ ] Performance optimization:
  - Prepared statement caching (better-sqlite3 handles this natively)
  - Batch inserts for multi-message operations
  - Read-ahead for conversation loading (predict next conversation)
- [ ] Add full-text search index:
  ```sql
  CREATE VIRTUAL TABLE message_fts USING fts5(content, content_rowid='rowid');
  ```
  - Enables fast search across all conversations
  - Populated during migration and on new message insert

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/main/store/database.ts` | SQLite database initialization and singleton |
| `src/main/store/migrations/runner.ts` | Migration system executor |
| `src/main/store/migrations/001-initial-schema.ts` | Initial database schema |
| `src/main/store/migrations/json-to-sqlite.ts` | One-time JSON → SQLite migration |
| `src/main/store/repositories/conversation-repository.ts` | Conversation CRUD |
| `src/main/store/repositories/message-repository.ts` | Message CRUD |
| `src/main/store/repositories/settings-repository.ts` | Settings CRUD |
| `src/main/store/repositories/checkpoint-repository.ts` | Checkpoint CRUD |

## Files to Modify

| File | Change |
|------|--------|
| `src/main/store/conversations.ts` | Replace JSON I/O with repository calls |
| `src/main/store/settings.ts` | Replace electron-store with repository calls |
| `src/main/index.ts` | Initialize database and run migrations on startup |
| `package.json` | Add SQLite library; potentially remove electron-store |
| `electron.vite.config.ts` | Handle native addon (if better-sqlite3) in build config |
| `electron-builder.yml` (or equivalent) | Include native addon in distribution builds |

## Cross-References

- **Spec 13 (Backup/Recovery)** — SQLite's ACID transactions supersede the unimplemented `.bak` rotation and load-failure recovery from Spec 13. Those remaining items can be considered resolved once SQLite ships.
- **Spec 55 (Checkpoint/Revert)** — Checkpoints can be stored in the `checkpoints` SQLite table instead of individual JSON files if this spec ships first or concurrently.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during JSON → SQLite migration | Critical | Transaction-based migration; keep JSON backup; idempotent retry |
| Native addon build failures in CI | High | Use prebuilt binaries; test CI pipeline early |
| Electron version incompatibility (node:sqlite) | High | Investigation phase before committing to library |
| Performance regression for simple operations | Medium | Benchmark before/after; prepared statements |
| Database corruption | Medium | WAL mode; integrity checks; backup command |
| Encrypted settings migration | Medium | Decrypt during migration; document process |
| electron-store removal breaks settings | Medium | Full API compatibility layer; staged removal |

## Definition of Done

1. SQLite database created and initialized on app startup
2. All conversations stored in SQLite with proper schema
3. JSON → SQLite migration runs automatically on upgrade, preserving all data
4. JSON backup directory retained for rollback safety
5. Settings migrated from electron-store to SQLite
6. Search across conversations works via FTS5
7. Conversation loading is at least as fast as JSON (benchmark)
8. All existing IPC handlers work unchanged (repository swapped transparently)
9. Production builds include SQLite native addon (all platforms)
10. Database backup export available from settings

## Testing Strategy

- **Unit tests:** Repository tests with in-memory SQLite database:
  - `conversation-repository.unit.test.ts` — CRUD, search, pagination
  - `message-repository.unit.test.ts` — append, truncate, load with parts
  - `settings-repository.unit.test.ts` — get, set, delete
- **Integration tests:** `json-to-sqlite.integration.test.ts`:
  - Migration from fixture JSON files → SQLite → verify all data matches
  - Migration with corrupted JSON files → skipped gracefully
  - Idempotent re-run → no duplicates
- **Performance benchmarks:** `sqlite-benchmarks.test.ts`:
  - Load conversation with 500 messages: JSON vs SQLite
  - List all conversations: JSON vs SQLite
  - Search across 100 conversations: JSON (impossible) vs SQLite FTS5
  - Append single message to large conversation: JSON vs SQLite
- **Build tests:** Verify native addon included in production builds for macOS, Windows, Linux
