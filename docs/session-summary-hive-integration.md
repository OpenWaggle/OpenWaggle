# Session Summary and Session Host compatibility

## Scope

The Summary renders Hive information and navigation. The Session Host owns spawning, immutable ancestry, delegation state, authorization, and orchestration commands. API compatibility does not mean the unfinished Session Host backend has been merged or validated together with the Summary.

On 2026-09-08 the owner of task `01a03a0c-20e2-77f3-b7c6-37dce925aead`, **Design agent session interactions**, confirmed this contract. Its active integration checkout was `hive-release-bEO1qr/repo`, based on commit `50c8b0996417a883e1750b53e3c6b6e0a2cc7b87`, with ongoing uncommitted work. The original `c7a1` checkout was not the latest integration source.

## Read contract

```ts
listHiveSessionCatalogPage(sessionId, limit, cursor?)
  // Promise<{ context: readonly SessionSummary[],
  //           workers: readonly SessionSummary[], nextCursor?: string }>
```

- `context` contains the focused Session and its immediate parent, in no guaranteed order.
- `workers` contains one keyset page of direct Workers, including archived Workers. It is not a recursive Hive traversal.
- `lineage` is optional for ordinary Sessions. Optional parent, agent-definition, and delegation fields may be absent, not explicitly null.
- The seven delegation states remain `working`, `waiting`, `needs_attention`, `ready_for_review`, `revision_requested`, `accepted`, and `cancelled`.
- Direct and active counts come from the Host projection, not the number of loaded rows. An active Worker beyond page one still keeps the Hive expanded.

The Summary requests 50 Workers per page and loads subsequent pages only when requested. It resolves the current and parent Session by identity, checks direct-worker ownership, and deduplicates Workers across page boundaries. A session-keyed query prevents a late page from appearing after navigation to another Session.

`SessionHiveReader` is a read-only structural subset. It accepts both API generations without requiring the orchestration branch to adopt the Summary's older nullable lineage DTO. When `listHiveSessionCatalogPage` exists, it is authoritative. The Summary uses `getSessionHiveRelations` only when the new capability is absent. A Host error never triggers fallback to the old projection.

The IPC proxy exposes real capability membership through the `in` operator. Its missing-method fallback functions are not evidence that a capability exists.

## Live updates

One workspace-level subscription listens to `onSessionHostEvent`. It batches `session-list-changed` and `session-state-changed` into Hive query invalidation, suppresses duplicate or older sequences from the current Host, and ignores transport-token events. Invalidation includes the focused Hive even when a newly spawned Worker was absent from every loaded page.

`onSessionHostResyncRequired` resets cached Hive pages and reloads active queries from page one. This discards continuation cursors after Host restart, cursor expiration, or slow-consumer recovery. The existing title-update path also invalidates Hive queries. Unsubscribing prevents queued refresh work from running after teardown.

## Integration ownership

When the branches are integrated:

1. Preserve the Host's canonical `session_spawn_lineage`, delegation contracts, catalog reader, and Host events. Do not introduce a second orchestration writer or read the Summary's old `session_lineage` table as Host truth.
2. Preserve `useSessionHiveInvalidation()` in the workspace lifecycle alongside the Host's other refresh handlers. Preserve title-update invalidation of `queryKeys.sessionHives`.
3. Remove the transitional legacy reader and its persistence path after the old hosted-task lifecycle is migrated. Do not copy historical lineage blindly into the Host's authorization/delegation model.
4. Run a combined real-Host scenario: spawn a Worker, change its delegation state, spawn its child, archive/unarchive it, restart the Host, and switch focused Sessions during pending catalog reads. Verify that the Summary shows only the focused Session's immediate relatives and preserves separate resource catalogs.

The combined real-Host scenario remains a merge-integration gate. Current Electron Hive screenshots use explicitly seeded projection data; they do not prove live Host orchestration.

## Evidence

The Summary's `SessionHiveReader` and `SessionHiveEventSource` were assigned directly from the other checkout's actual `OpenWaggleApi` in a strict TypeScript compile using that checkout's shared-type resolution. The compile passed without casts or copied replacement API declarations.

Repeat the read-only check against the current Host checkout before integration:

```sh
pnpm exec tsx scripts/check-session-hive-api-compatibility.ts /path/to/host-checkout
```

The command keeps its probe in a new OS temporary directory. It does not write into either checkout or execute Host code. Missing required Host methods, a failed producer typecheck, or incompatible reader/event signatures fail the command; this does not replace the combined runtime test.

Inspected source SHA-256 fingerprints:

| Host source | SHA-256 |
| --- | --- |
| `src/shared/types/session.ts` | `ae686328fb8718293b17f575d5d90501932903b504a4c8a202b9499f9b686f55` |
| `src/shared/types/openwaggle-api.ts` | `04159ee8fb0acfcf77ff3eeb803df4ef04a3f301a3e7320324707b354ecfaf41` |
| `src/shared/types/session-host-event.ts` | `ba36427e60cece5765d89596cd27886ea5818d8453e3400c7cc4a0c7df137450` |

Regression tests cover both read generations, absent optional fields, unordered context, ownership rejection, Host-error behavior, lazy pagination, later-page retry, stale responses after navigation, live refresh without token-triggered reads, and resync from page one. The existing native Electron Hive test covers the current projection through the real preload/IPC path.
