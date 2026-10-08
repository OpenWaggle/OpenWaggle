import { randomUUID } from 'node:crypto'
import { SessionId } from '@shared/types/brand'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { dispatchLocalSessionCommand } from './local-session-command-dispatcher'
import type { DiscoveredSessionCreateInput } from './pi-session-discovery'

/**
 * A discovered session becomes a Session the way the desktop user creates one, through the Session
 * Host's lifecycle, so it gets the project's Workspace, an execution profile, and its queue. The
 * idempotency key names the version of the file that was read, so a pass interrupted before the
 * file was attached replays the same Session instead of creating another, while a file refused
 * once and written again since gets a fresh attempt.
 *
 * The Session Host entry passes this to discovery; discovery does not import it, because the
 * command dispatcher depends on the Host runtime that starts discovery.
 */
export function createDiscoveredSessionWithLifecycle(input: DiscoveredSessionCreateInput) {
  return Effect.gen(function* () {
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: input.projectPath },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          command: {
            operation: 'create',
            projectPath: input.projectPath,
            title: input.title,
            workspace: { mode: 'local' },
          },
        },
      },
    })
    if (
      result.contract !== 'session-lifecycle-v2' ||
      result.response.outcome.effect !== 'created-root'
    ) {
      return null
    }
    return {
      sessionId: SessionId(result.response.outcome.sessionId),
      replayed: result.response.replayed,
    }
  })
}
