import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'

interface StoredSession {
  readonly id: string
  readonly projectPath: string
  readonly hiveRootSessionId: string
}

export const SESSIONS: readonly StoredSession[] = [
  { id: 'a-root', projectPath: '/repo-a', hiveRootSessionId: 'a-root' },
  { id: 'a-worker', projectPath: '/repo-a', hiveRootSessionId: 'a-root' },
  { id: 'a-sub', projectPath: '/repo-a/packages/sub', hiveRootSessionId: 'a-sub' },
  { id: 'b-root', projectPath: '/repo-b', hiveRootSessionId: 'b-root' },
  { id: 'c-root', projectPath: '/repo-c', hiveRootSessionId: 'c-root' },
]

function sessionMatches(scope: LocalSessionProfileScope, session: StoredSession) {
  return (
    scope.all === true ||
    (scope.projectPaths ?? []).includes(session.projectPath) ||
    (scope.sessionIds ?? []).includes(session.id) ||
    (scope.hiveRootSessionIds ?? []).includes(session.hiveRootSessionId)
  )
}

export const repositoryLayer = Layer.succeed(SessionAuthorizationTargetRepository, {
  listAuthorizedSessionIds: (scope) =>
    Effect.succeed(SESSIONS.filter((session) => sessionMatches(scope, session)).map((s) => s.id)),
  resolveWorkspaceProjectPaths: (roots) =>
    Effect.succeed([
      ...new Set(
        SESSIONS.map((session) => session.projectPath).filter((projectPath) =>
          roots.some((root) => projectPath === root || projectPath.startsWith(`${root}/`)),
        ),
      ),
    ]),
  runInputWidensReach: () => Effect.die('not used'),
  resolve: () => Effect.die('not used'),
  resolveDelegation: () => Effect.die('not used'),
  listLiveDerivedAuthorities: () => Effect.succeed([]),
})
