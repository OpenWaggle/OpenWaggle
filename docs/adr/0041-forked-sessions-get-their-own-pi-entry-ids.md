# A forked Session gets its own Pi entry ids

Status: accepted

Date: 2026-09-30

## Context

Pi forks a session by copying the path to the fork point into a new session file. The copied entries keep their ids, because Pi only needs ids to be unique within one file.

OpenWaggle projects every Session into one SQLite `session_nodes` table whose primary key is the node id alone. Several other tables reference `session_nodes(id)`: branches, exports, search rows, semantic indexes. A fork snapshot that reuses the source ids collides with the source Session's own nodes, so the lifecycle transaction failed with `UNIQUE constraint failed: session_nodes.id`. No GUI fork or clone of a Session with history ever saved: the user's database had no `session_derivations` rows.

Two fixes were considered:

- **Key nodes by `(session_id, id)`.** This is the faithful model of Pi's identity, but about 130 SQL statements and 25 `node_id` columns assume a global id. The migration would rebuild the largest tables of a database of several hundred megabytes at startup.
- **Re-key the forked file.** The fork file is new and has not been read by anything yet, so its ids can be replaced before it is projected.

## Decision

After Pi forks, and before OpenWaggle projects the fork, every entry gets a new id in Pi's format (the first eight characters of a UUID). The tree and Pi's cross-entry references are rewritten with it: `parentId`, a compaction's `firstKeptEntryId`, a branch summary's `fromId`, and the `targetId` of labels and context edits. A reference to an entry outside the file, such as a branch summary's source on another path, is left as it is. The entries are taken from the fork's in-memory session, because Pi writes a fork file only once the copied path holds an assistant message; a fork of a Session's first message has no file yet. The file is created or replaced atomically, then reopened with Pi's `SessionManager` for the snapshot.

The fork keeps its provenance in `session_derivations`, whose `source_node_id` is the source Session's node id.

## Consequences

Forks and clones save, and a forked Session is an ordinary Pi session with ids of its own, so a later run, branch, or compaction in it cannot collide with its source either. A forked node has a different id from the node it was copied from, and the derivation row records the fork point. Per-node data that lives only in the projection, such as the ownership of an inline visualization in an assistant message's metadata, is not carried into the fork, so such a visualization may not resolve there.

Independent Sessions still share the global node key. Pi's ids are random, so a collision between unrelated Sessions is unlikely but possible, and would fail that Session's snapshot. Keying nodes by Session remains the complete fix if that ever happens.
