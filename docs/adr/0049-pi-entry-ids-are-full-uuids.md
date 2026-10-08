# Pi entry ids are full UUIDs, and colliding entries are renamed when saved

Status: accepted

Date: 2026-10-04

Amends: [0041](0041-forked-sessions-get-their-own-pi-entry-ids.md)

## Context

ADR 0041 kept `session_nodes` keyed by node id alone and accepted that independent Sessions could still collide, because Pi's eight-character entry ids are random and only unique within one file. It named keying nodes by Session as the complete fix "if that ever happens".

It happened. A user's database held 81,882 nodes across 312 Sessions, so each new eight-character id collided with an existing node about once in 52,000 entries. An entry written on 2026-10-04 reused the id of a node in an archived Session. From then on every snapshot of that Session failed with `UNIQUE constraint failed: session_nodes.id`, and every reply ended with "This response couldn't be saved". Pi had written all of them, but after a restart the transcript stopped at the collision. The odds grow with the database, so every heavy user eventually hits one.

Two fixes were considered:

- **Key nodes by `(session_id, id)`.** This is the faithful model of Pi's identity. It touches about 74 files and 134 SQL statements, makes every foreign key to `session_nodes` composite, and rebuilds the largest tables, plus their search, embedding and export tables, at startup on databases of several hundred megabytes.
- **Stop minting colliding ids, and rename the colliding entries already written.** OpenWaggle already patches Pi, and ADR 0041 already re-keys whole fork files.

## Decision

OpenWaggle's Pi patch makes `SessionManager` mint every new entry id as a full random UUID instead of its first eight characters. A full UUID cannot equal an eight-character id, and two of them never collide in practice, so no new entry can collide with any node, old or new.

Entries written before the patch, or by a Pi elsewhere, can still reuse an id another Session holds. Saving a snapshot first checks the node ids the Session does not hold yet against other Sessions' nodes, inside the transaction, and fails with an error that names each id and the Session holding it. The Session repository then asks the transcript repair port to rename those entries in the Pi file, with the same reference rewriting as a fork re-key, and saves the re-projected snapshot. Only entries the rename changed are projected again; every other node is kept as the caller built it. The repair runs under the Session lock, after the run or operation that took the snapshot has released its Pi session. Only an entry this Session's projection does not hold can collide, because a node id belongs to at most one Session, so renaming it changes no saved node.

The rewrite is atomic and durable: the new content is synced before it replaces the file, and the directory after. It is refused, leaving the file as it was and failing the save with the named conflict, when a line of the file does not parse, when a conflicting id is not a Pi entry of the file, or when the file changed while it was being renamed. The Session lock does not cover Pi readers outside a run or Session operation, such as context-usage reads. The last check keeps an append that lands before the rename from being lost, and the rename is retried; it cannot help a writer that read the file before the rename and appends after it, which only an exclusive lock on the file would.

Node writes in snapshot reconciliation are also scoped by `session_id`, so a rewrite of one Session's nodes can never reach another Session's rows.

## Consequences

The stuck Session saves on its next run after the upgrade, and the turns missing from its projection come back from the Pi file. Its colliding entry gets a new id. The other Session keeps its own.

New entry ids are 36 characters instead of 8. OpenWaggle never assumed the shorter length; forked entries have used full UUIDs since ADR 0041. The repair stays for files written before the patch, and for files written by a separately installed Pi that shares `~/.pi/agent/sessions`.

Every snapshot save runs one extra indexed lookup over the node ids it adds.

Keying nodes by Session remains possible later. It is no longer needed to keep Sessions apart.
