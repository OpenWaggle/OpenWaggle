---
title: "Session Recovery"
description: "Understand the one-time Session Host cutover and explicitly inspect, restore, or remove its recovery copy."
order: 5
section: "Configuration"
---

The Session Host release performs one breaking, one-time migration from the legacy `openwaggle.db` to its complete Session Host schema. It builds the target database beside the source, preserves stable Session and transcript identities, rebuilds Workspace bindings and the complete lexical search projection, validates the authoritative result, closes it durably, and only then installs it atomically.

Semantic search is a resumable derived projection, so it does not hold the app or CLI hostage during a large first launch. The migration durably queues every migrated Session, and the authoritative Session Host prepares embeddings in the background after it becomes available. Search remains complete through the lexical index while semantic readiness reports `preparing` or `failed`; hybrid search explicitly degrades to lexical until enough semantic coverage is ready. A restart resumes the remaining queue instead of repeating the canonical migration.

A failed or cancelled migration leaves the legacy database untouched and refuses to open a partial target. After success, ordinary launches use only `session-host/session-host.sqlite`; the migration ledger prevents the cutover from repeating. OpenWaggle retains `session-host/pre-cutover-openwaggle.sqlite` as an explicit recovery copy and never reads or writes it during normal operation.

## Inspect recovery state

```sh
openwaggle recovery status --json
```

The result names the active and recovery paths, sizes, timestamps, and active schema compatibility. Inspecting status does not start a second database authority.

## Restore explicitly

Quit every OpenWaggle window and allow active Runs to finish so the Session Host stops, then run:

```sh
openwaggle recovery restore-pre-cutover --yes --json
```

Restore requires exclusive ownership. Before replacement it preserves the current active database as a timestamped artifact, then reruns the authoritative and lexical migration from the recovery copy and resumes semantic preparation in the background. Sessions and mutations created after the original cutover are not present in that restored history. If restoration fails, the current active database is put back.

OpenWaggle never restores automatically after a crash, Run failure, or validation error because doing so could discard valid newer work.

## Remove the recovery copy

After the migrated history has been verified and the recovery copy is no longer needed:

```sh
openwaggle recovery delete-pre-cutover --yes --json
```

This is explicit and irreversible. The Session Host must be stopped, and the command reports the exact removed path and size.
