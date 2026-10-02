import type { SessionId, SupportedModelId } from '@shared/types/brand'
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

/** Session settings kept in the Session's execution profile, which every Run reads when it starts. */
export interface SessionSettingsRepositoryShape {
  readonly setModel: (
    sessionId: SessionId,
    model: SupportedModelId,
  ) => Effect.Effect<SessionSettingChange, SessionControlRepositoryError>
  readonly setThinkingLevel: (
    sessionId: SessionId,
    thinkingLevel: ThinkingLevel,
  ) => Effect.Effect<SessionSettingChange, SessionControlRepositoryError>
}

export class SessionSettingsRepository extends Context.Tag('@openwaggle/SessionSettingsRepository')<
  SessionSettingsRepository,
  SessionSettingsRepositoryShape
>() {}
