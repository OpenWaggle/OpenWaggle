# A forked Session gets its own Pi entry ids

Status: accepted

Date: 2026-09-30

Amended by: [ADR 0047](0047-pi-entry-ids-are-full-uuids.md). Independent Sessions did collide, so Pi now mints full UUID entry ids, and an entry that reuses another Session's node id is renamed when its Session is saved.

## Context

Pi forks a session by copying the path to the fork point into a new session file. The copied entries keep their ids, because Pi only needs ids to be unique within one file.

OpenWaggle projects every Session into one SQLite `session_nodes` table whose primary key is the node id alone. Several other tables reference `session_nodes(id)`: branches, exports, search rows, semantic indexes. A fork snapshot that reuses the source ids collides with the source Session's own nodes, so the lifecycle transaction failed with `UNIQUE constraint failed: session_nodes.id`. No GUI fork or clone of a Session with history ever saved: the user's database had no `session_derivations` rows.

Two fixes were considered:

- **Key nodes by `(session_id, id)`.** This is the faithful model of Pi's identity, but about 130 SQL statements and 25 `node_id` columns assume a global id. The migration would rebuild the largest tables of a database of several hundred megabytes at startup.
- **Re-key the forked file.** The fork file is new and has not been read by anything yet, so its ids can be replaced before it is projected.

## Decision

After Pi forks, and before OpenWaggle projects the fork, every entry gets a new id, a full UUID. Pi's own ids are the first eight characters of a UUID and are unique only within a file; a fork mints all of its ids at once against a node key shared by every Session, where 32 bits collide too often (about 8% for forking a Session of 8,000 entries in a database of 46,000 nodes). A full UUID also cannot equal an id Pi generates later. Pi accepts any string as an entry id. The tree and Pi's cross-entry references are rewritten with it: `parentId`, a compaction's `firstKeptEntryId`, a branch summary's `fromId`, the `targetId` of labels and context edits, and the entry ids in the data of Pi's `pi.compaction_reconstruction` record. A reference to an entry outside the file, such as a branch summary's source on another path, is left as it is. The entries are taken from the fork's in-memory session, because Pi writes a fork file only once the copied path holds an assistant message; a fork of a Session's first message has no file yet. The file is created or replaced atomically, then reopened with Pi's `SessionManager` for the snapshot.

The fork keeps its provenance in `session_derivations`, whose `source_node_id` is the source Session's node id.

## Consequences

Forks and clones save, and a forked Session is an ordinary Pi session with ids of its own, so a later run, branch, or compaction in it cannot collide with its source either. A forked node has a different id from the node it was copied from, and the derivation row records the fork point. The fork result maps each new id to its source node, so per-node data that lives only in the projection can follow the copy. Inline visualizations use it: they are stored with the Session that rendered them, and a copied message keeps that Session as its visualization owner, through any number of copies. Deleting that Session deletes its visualizations, so its forks can no longer show them; archiving keeps them.

Independent Sessions still share the global node key. Pi's ids are random, so a collision between unrelated Sessions is unlikely but possible, and would fail that Session's snapshot. Keying nodes by Session remains the complete fix if that ever happens.
