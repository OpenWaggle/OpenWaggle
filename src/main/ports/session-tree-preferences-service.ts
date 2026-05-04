import type { SessionTreeFilterMode } from '@shared/types/session'
import { Context, type Effect } from 'effect'

export interface SessionTreePreferencesServiceShape {
  readonly getTreeFilterMode: (
    projectPath?: string | null,
  ) => Effect.Effect<SessionTreeFilterMode, Error>
  readonly setTreeFilterMode: (
    mode: SessionTreeFilterMode,
    projectPath?: string | null,
  ) => Effect.Effect<void, Error>
  readonly getBranchSummarySkipPrompt: (
    projectPath?: string | null,
  ) => Effect.Effect<boolean, Error>
}

export class SessionTreePreferencesService extends Context.Tag(
  '@openwaggle/SessionTreePreferencesService',
)<SessionTreePreferencesService, SessionTreePreferencesServiceShape>() {}
