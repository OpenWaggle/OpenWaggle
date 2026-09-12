import type { McpTurnSnapshot } from '@shared/types/mcp'
import { Effect, Ref } from 'effect'
import { McpStaleToolHandle } from '../../../ports/mcp-errors'

interface SnapshotIdentity {
  readonly id: string
  readonly revision: string
}

type SnapshotAuthority = ReadonlyMap<string, SnapshotIdentity | null>

function identityOf(snapshot: McpTurnSnapshot): SnapshotIdentity {
  return { id: snapshot.id, revision: snapshot.revision }
}

function identitiesMatch(left: SnapshotIdentity, right: SnapshotIdentity) {
  return left.id === right.id && left.revision === right.revision
}

/**
 * Tracks which turn snapshot may initiate new Session-scoped MCP work.
 *
 * Management snapshots are linearized by the application management gate and
 * deliberately carry a separate runtime namespace. Session snapshots become
 * authoritative at lifecycle boundaries; once a Session has participated in
 * that lifecycle, an absent/older snapshot can never resurrect its clients.
 * Missing entries remain allowed for legacy callers and isolated unit tests
 * that use the runtime directly without a turn lifecycle.
 */
export function makeMcpRuntimeSnapshotAuthority() {
  return Effect.gen(function* () {
    const state = yield* Ref.make<SnapshotAuthority>(new Map())

    const set = (sessionId: string, snapshot: McpTurnSnapshot | null) =>
      Ref.update(state, (current) => {
        const next = new Map(current)
        next.set(sessionId, snapshot ? identityOf(snapshot) : null)
        if (snapshot && snapshot.sessionId !== sessionId) {
          next.set(snapshot.sessionId, identityOf(snapshot))
        }
        return next
      })

    return {
      assert: (snapshot: McpTurnSnapshot) => {
        if (snapshot.runtimeNamespace !== undefined) return Effect.void
        return Ref.get(state).pipe(
          Effect.flatMap((current) => {
            const authority = current.get(snapshot.sessionId)
            if (authority === undefined || (authority && identitiesMatch(authority, snapshot))) {
              return Effect.void
            }
            return Effect.fail(
              new McpStaleToolHandle({
                message: `MCP snapshot ${snapshot.id} is no longer authoritative for Session ${snapshot.sessionId}.`,
              }),
            )
          }),
        )
      },
      set,
      tombstone: (sessionId: string) => set(sessionId, null),
      tombstoneAll: () =>
        Ref.update(
          state,
          (current) => new Map([...current.keys()].map((sessionId) => [sessionId, null] as const)),
        ),
    }
  })
}
