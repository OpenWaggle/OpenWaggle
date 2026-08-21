import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import { modeConsultsGrants } from '@shared/types/agent-authorization-grants'
import type { AgentLoopConfirmInteraction } from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { createLogger } from '../logger'
import { findGrantCovering, grantForProject, grantForSession } from './agent-authorization-grants'
import { requestAgentLoopInteraction } from './agent-loop-interaction-broker'

const logger = createLogger('agent-authorization-request')

export interface AuthorizationRequestInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly projectPath: string | null
  readonly title: string
  readonly message: string
  readonly scopeKey: AgentAuthorizationScopeKey
  readonly resolveAuthorizationMode: () => Promise<AgentAuthorizationMode>
  readonly onEvent: (event: AgentTransportEvent) => void
  readonly runSignal: AbortSignal
  readonly interactionSignal?: AbortSignal
  readonly newInteractionId: () => string
  readonly now?: () => number
}

function mergedSignal(runSignal: AbortSignal, interactionSignal?: AbortSignal) {
  if (!interactionSignal) return runSignal
  return AbortSignal.any([runSignal, interactionSignal])
}

async function persistDecision(input: {
  readonly scope: 'session' | 'project'
  readonly sessionId: SessionId
  readonly projectPath: string | null
  readonly scopeKey: AgentAuthorizationScopeKey
}) {
  if (input.scope === 'session') {
    grantForSession(input.sessionId, input.scopeKey)
    return
  }

  if (!input.projectPath) {
    // Nowhere to write a project grant, so keep it for the session instead of dropping the
    // user's intent on the floor. Narrower than asked for, never wider.
    logger.warn('No project path for a project-scoped approval; keeping it for the session only', {
      sessionId: input.sessionId,
    })
    grantForSession(input.sessionId, input.scopeKey)
    return
  }

  try {
    await grantForProject(input.projectPath, input.scopeKey)
  } catch (cause) {
    logger.warn('Failed to persist a project approval; keeping it for the session only', {
      projectPath: input.projectPath,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    grantForSession(input.sessionId, input.scopeKey)
  }
}

/**
 * Asks for permission to perform an identified capability.
 *
 * The only path that full access may answer on its own, which is why it is a distinct entry point
 * rather than a flag on the generic confirm. Order matters: full access short-circuits before any
 * event is emitted, so an auto-granted call leaves no transcript entry at all, and an existing
 * grant short-circuits before a prompt, so a kept approval is not asked again.
 */
export async function requestAuthorization(input: AuthorizationRequestInput): Promise<boolean> {
  const mode = await input.resolveAuthorizationMode()
  if (mode === 'yolo') return true

  if (modeConsultsGrants(mode)) {
    const covering = await findGrantCovering({
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      key: input.scopeKey,
    })
    if (covering) return true
  }

  const interaction: AgentLoopConfirmInteraction = {
    interactionId: input.newInteractionId(),
    sessionId: input.sessionId,
    runId: input.runId,
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: (input.now ?? Date.now)(),
    title: input.title,
    message: input.message,
    purpose: 'authorization',
    scopeKey: input.scopeKey,
  }

  const response = await requestAgentLoopInteraction({
    interaction,
    onEvent: input.onEvent,
    signal: mergedSignal(input.runSignal, input.interactionSignal),
  })

  if (response.kind !== 'confirm' || !response.accepted) return false

  if (response.scope === 'session' || response.scope === 'project') {
    await persistDecision({
      scope: response.scope,
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      scopeKey: input.scopeKey,
    })
  }

  return true
}
