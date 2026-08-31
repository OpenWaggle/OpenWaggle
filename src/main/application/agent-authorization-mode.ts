import {
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import { getProjectPreferencesStrict } from '../config/project-config'
import { createLogger } from '../logger'

const logger = createLogger('agent-authorization-mode')

/**
 * The mode used when nothing can be determined.
 *
 * Deliberately the cautious one. A permission control that cannot read its own configuration must
 * ask rather than assume, so a corrupted settings file or an unreadable project config produces
 * prompts instead of silent full access.
 */
export const FAIL_CLOSED_AUTHORIZATION_MODE: AgentAuthorizationMode = 'ask-for-approval'

/**
 * Picks the effective mode from the three levels.
 *
 * `undefined` or `null` at a level means that level holds no override and the next one decides. It
 * never means `yolo`. Pure so the precedence rule can be tested without a database or a filesystem.
 */
export function pickAuthorizationMode(input: {
  readonly sessionOverride?: AgentAuthorizationMode | null
  readonly projectDefault?: AgentAuthorizationMode | null
  readonly globalDefault?: AgentAuthorizationMode | null
}): AgentAuthorizationMode {
  return (
    input.sessionOverride ??
    input.projectDefault ??
    input.globalDefault ??
    FAIL_CLOSED_AUTHORIZATION_MODE
  )
}

async function readProjectDefault(projectPath: string | null) {
  if (!projectPath) return undefined

  try {
    const preferences = await getProjectPreferencesStrict(projectPath)
    return preferences?.authorizationMode
  } catch (cause) {
    logger.warn('Failed to read the project authorization default', {
      projectPath,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    // Fail closed rather than fall through. Returning undefined here would defer to the global
    // default, which ships as full access, so an unreadable project file would silently escalate a
    // project that had chosen Ask for Approval.
    return FAIL_CLOSED_AUTHORIZATION_MODE
  }
}

async function readGlobalDefault() {
  try {
    const { getSettings } = await import('../store/settings')
    const stored = getSettings().defaultAuthorizationMode
    return isAgentAuthorizationMode(stored) ? stored : undefined
  } catch (cause) {
    logger.warn('Failed to read the global authorization default', {
      error: cause instanceof Error ? cause.message : String(cause),
    })
    return undefined
  }
}

function authorizationBoundaryRequiresApproval(input: {
  readonly boundary: {
    readonly execution_ceiling: AgentAuthorizationMode
    readonly grant_ceiling: AgentAuthorizationMode | null
    readonly profile_ceiling: AgentAuthorizationMode | null
    readonly profile_revoked_at: number | null
    readonly grant_revoked_at: number | null
  }
  readonly callerBoundary: {
    readonly revoked: boolean
    readonly authorizationCeiling: AgentAuthorizationMode
  } | null
}) {
  return (
    input.boundary.profile_revoked_at !== null ||
    input.boundary.grant_revoked_at !== null ||
    input.callerBoundary?.revoked === true ||
    input.boundary.execution_ceiling === 'ask-for-approval' ||
    input.boundary.grant_ceiling === 'ask-for-approval' ||
    input.boundary.profile_ceiling === 'ask-for-approval' ||
    input.callerBoundary?.authorizationCeiling === 'ask-for-approval'
  )
}

/**
 * Resolves the mode a session runs under, reading every level at the moment of the call.
 *
 * Called when a request is raised rather than when a run starts, which is what makes a mode change
 * mid-run govern the rest of that run, and what makes a session with no override follow a later
 * change to its project or global default.
 */
export async function resolveEffectiveAuthorizationMode(
  sessionId: SessionId,
  runOverride?: AgentAuthorizationMode,
  authorityCallerId?: string,
): Promise<AgentAuthorizationMode> {
  try {
    const {
      getSessionAuthorizationBoundary,
      getSessionCallerAuthorizationBoundary,
      getSessionDetail,
    } = await import('../store/session-details')
    const [session, boundary, callerBoundary] = await Promise.all([
      getSessionDetail(sessionId),
      getSessionAuthorizationBoundary(sessionId),
      authorityCallerId ? getSessionCallerAuthorizationBoundary(authorityCallerId) : null,
    ])
    if (!session) {
      logger.warn('No session row while resolving the authorization mode; failing closed', {
        sessionId,
      })
      return FAIL_CLOSED_AUTHORIZATION_MODE
    }

    const [projectDefault, globalDefault] = await Promise.all([
      readProjectDefault(session.projectPath),
      readGlobalDefault(),
    ])

    const preferredMode =
      runOverride ??
      pickAuthorizationMode({
        sessionOverride: session.authorizationMode,
        projectDefault,
        globalDefault,
      })
    if (!boundary) return FAIL_CLOSED_AUTHORIZATION_MODE
    return authorizationBoundaryRequiresApproval({ boundary, callerBoundary })
      ? FAIL_CLOSED_AUTHORIZATION_MODE
      : preferredMode
  } catch (cause) {
    logger.warn('Failed to resolve the authorization mode; failing closed', {
      sessionId,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    return FAIL_CLOSED_AUTHORIZATION_MODE
  }
}
