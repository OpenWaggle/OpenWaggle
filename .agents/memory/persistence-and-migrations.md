# Persistence and migrations

SQLite and settings persistence: migration ids and rebuild hazards, adding columns,
Session Host migration bookkeeping, settings keys, SELECT column lists, better-sqlite3
versions, and empty legacy database files.
Load when adding a migration or settings key, or touching `database-*` or `store/` code.

## SELECT column lists are invisible to the type checker

`sql<SessionSummaryRow>` asserts the row shape; it does not verify the query selects those
columns. Three queries typed that way omitted `environment_mode` and `worktree_path`, so
every session in the list reported local mode with no worktree and the per-session git
indicators were absent. Typecheck, lint and the whole suite stayed green; it was found by
opening the app.

The columns now come from `SESSION_SUMMARY_COLUMN_NAMES` in `store/sessions/types.ts`,
interpolated as a fragment by `sessionSummaryColumns(sql)`. Three layers keep it closed:
the shared fragment, a repository-standards rule rejecting an inline column list in a
`sql<SessionSummaryRow>` query, and `store/__tests__/session-summary-columns.integration.test.ts`
which drives the real SQLite path. The detail-side `session-queries.ts` is exempted by name:
its `SessionSummaryRow` is a different type with `message_count` and table aliases.

Note the detail worth remembering: dropping a column fails the integration test but produces
**zero** typecheck errors. Types cannot see into a SQL string.

## Startup compatibility needs persisted-profile tests

Startup compatibility checks must exercise the complete SQLite-to-settings path with maps from older releases. A literal-key Effect `Schema.Record` requires every current command, so fill missing shortcut keys before strict persisted-settings validation; do not replace present malformed values. Zustand terminal layout version 2 also needs a `migrate` callback, otherwise it skips the existing merge decoder for version-1 layouts and logs an error while discarding their tabs. Both paths now have actual-store hydration regressions.

New settings must join `CURRENT_SETTINGS_KEYS` as well as the shared update schema, snapshot builder, and persistence plan. The global compaction threshold follows the same fail-closed saved-data contract: absence uses 80 percent, but a present invalid value remains untouched and blocks settings reads.

## Filed under "Generated Session titles (ADR 0043, October 2026)"

- Adding a Session Host migration needs three places beyond the migration list: the ID in `session-host-schema-identity.ts` plus `SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID`, and the identity in `currentIdentities` of `session-host-ledger-compatibility.ts`, or database bootstrap fails with "incompatible or mixed identities". Hand-written `CREATE TABLE sessions` fixtures in adapter tests need new columns too; cutover fixtures must keep the legacy shape.

## Filed under "Access Modes And Authorization Memory"

- Migration 24 is `pinned-sessions` and had already shipped. Never renumber or replace a migration id
  that users have applied.
- Rebuilding the `sessions` table is not safe: it is the parent of cascading foreign keys, and a
  rebuild under `PRAGMA foreign_keys = ON` deletes every node and pinned row with it. Add a column.
- SQLite has no `ADD COLUMN IF NOT EXISTS`, and the migration ledger only guards the same id. A column
  that exists under a different id fails the `ALTER` and takes boot with it, which is reachable
  whenever a migration is renumbered. Guard the column, not just the id.

## Filed under "Session Host authority and subscriptions are live boundaries"

The September 2026 terminal/browser merge preserves released setup migrations 26/27 and moves
the prerelease Hive identities 26–31 to 28–33. `session-host-ledger-compatibility.ts` plans only
exact known-name mappings, and the owner applies them descending in one transaction, preserving
timestamps. Read-only completion preflight recognizes old alpha ledgers without mutating them.
Unknown or mixed identities fail closed. Desktop owner/fence journals are migration 34; immutable
browser attachment metadata is migration 35. Never reuse the old bare numeric Hive IDs in tests.

The September 2026 native action verification reproduced a SQLite worker teardown abort on pristine
main with transitive better-sqlite3 12.11.1. Root and Effect SQLite now share 13.0.3, which includes the
upstream 13.0.2 worker-termination fix. Migration compatibility fixtures must create the historical
schema with a bounded migration list; creating today's tables and erasing later ledger entries
causes false duplicate-table failures as new non-idempotent migrations are added.

## Filed under "Expired provider credentials, refused Title models, empty legacy files (#357, October 2026)"

- A 0-byte `openwaggle.db` (no WAL frames) is absent for restore and cutover
  (`legacy-database-file.ts`). It blocked `recovery restore-pre-cutover`, and on a fresh install
  the cutover tried to migrate it and failed with "no such table: _migrations". `recovery status`
  lists leftover `openwaggle.db` and top-level `session-host.sqlite` under `legacy`.
- Fixed by #371: `session-host-upgrade-blockers.ts` opened the live Host database with
  `node:sqlite` inside the Host process. It now reads through the Host's connection, and
  `check:repository-standards` rejects `node:sqlite` outside browser import (see the
  one-SQLite-library entry under Renderer And Session Memory).
