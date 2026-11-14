import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'

/**
 * The Session Host query the hive tool sends before it reads another project's Agent definitions:
 * one Session of that project, archived ones included, as `list` with `catalogScope: project`
 * asks. The Host authorizes the project as a target of the caller by the scope rule launch and
 * create follow, so its refusal (`target_scope_denied`) answers for a project outside the
 * caller's reach, and a caller in scope learns whether the project has a Session.
 * `session-tool-cross-project-authority.unit.test.ts` runs this exact payload through the Host's
 * authorization.
 */
export function agentDefinitionProjectProbe(projectPath: string) {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: { operation: 'list', limit: 1, projectPath },
    },
  } satisfies LocalSessionCommandPayload
}
