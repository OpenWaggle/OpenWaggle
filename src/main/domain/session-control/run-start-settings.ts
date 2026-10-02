import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { ThinkingLevel } from '@shared/types/settings'
import type { SessionRunAvailability } from './message-submission'

/**
 * Session settings a caller may set only on a command that starts a Run on an idle Session:
 * creating a Session, or a `message` or `start` that starts a Run. They belong to the starting
 * Run, never to a Follow-up message, so a command that would queue, steer, or replace is refused.
 */
export interface RunStartSettings {
  /** Becomes the Session thinking level when the Run starts, as if chosen in the Session. */
  readonly thinkingLevel?: ThinkingLevel
  /** Applies to this Run and its descendants only; never persisted as the Session's mode. */
  readonly runAuthorizationOverride?: AgentAuthorizationMode
}

export type RunStartSettingsRejection =
  | 'thinking_level_requires_idle_session'
  | 'run_authorization_override_requires_idle_session'

/** The refusal for settings sent on a command that does not start a Run, if it names any. */
export function refuseRunStartSettings(
  settings: RunStartSettings | undefined,
): RunStartSettingsRejection | undefined {
  if (settings?.thinkingLevel !== undefined) return 'thinking_level_requires_idle_session'
  if (settings?.runAuthorizationOverride !== undefined) {
    return 'run_authorization_override_requires_idle_session'
  }
  return undefined
}

/** A starting Run's intent: the message content plus the settings it starts with. */
export function withRunStartSettings<Intent extends object>(
  intent: Intent,
  settings: RunStartSettings | undefined,
): Intent & RunStartSettings {
  return {
    ...intent,
    ...(settings?.thinkingLevel !== undefined ? { thinkingLevel: settings.thinkingLevel } : {}),
    ...(settings?.runAuthorizationOverride !== undefined
      ? { runAuthorizationOverride: settings.runAuthorizationOverride }
      : {}),
  }
}

/**
 * Whether a Session's settings (its model or thinking level) may change: only while no Run is
 * starting, active, or stopping. A Session whose Follow-ups wait in its queue is not active.
 */
export function canChangeSessionSettings(run: Pick<SessionRunAvailability, 'state'>) {
  return run.state === 'idle'
}
