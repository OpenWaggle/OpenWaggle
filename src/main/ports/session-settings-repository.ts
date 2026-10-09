import type { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionThinkingLevelChange } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

/**
 * The outcome of changing a Session setting (its model or thinking level). A setting changes only
 * while the Session has no starting, active, or stopping Run (`canChangeSessionSettings`); a
 * Session whose Follow-ups wait in its queue is not active.
 */
export type SessionSettingChange = SessionThinkingLevelChange

/**
 * `forRun`: the Run that is starting may change its own Session's settings before it reads its
 * profile, as a discovered Session's first Run does to continue with its Pi file's (ADR 0051).
 * Any other Run still refuses the change.
 */
export interface SessionSettingChangeOptions {
  readonly forRun?: RunId
}

/** Session settings kept in the Session's execution profile, which every Run reads when it starts. */
export interface SessionSettingsRepositoryShape {
  readonly setModel: (
    sessionId: SessionId,
    model: SupportedModelId,
    options?: SessionSettingChangeOptions,
  ) => Effect.Effect<SessionSettingChange, SessionControlRepositoryError>
  readonly setThinkingLevel: (
    sessionId: SessionId,
    thinkingLevel: ThinkingLevel,
    options?: SessionSettingChangeOptions,
  ) => Effect.Effect<SessionSettingChange, SessionControlRepositoryError>
}

export class SessionSettingsRepository extends Context.Tag('@openwaggle/SessionSettingsRepository')<
  SessionSettingsRepository,
  SessionSettingsRepositoryShape
>() {}
