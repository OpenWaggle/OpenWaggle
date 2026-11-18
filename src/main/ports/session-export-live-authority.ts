import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { Context, type Effect } from 'effect'

export interface SessionExportAuthorityTarget {
  readonly sessionId: string
  readonly projectPath?: string
  readonly hiveRootSessionId: string
  readonly workingPath?: string
}

export interface SessionExportLiveAuthorityShape {
  readonly liveAuthorityBlockReason: (
    callerId: string,
    targetSessionId: string,
  ) => Effect.Effect<string | undefined, Error>
  readonly loadTarget: (
    sessionId: string,
  ) => Effect.Effect<SessionExportAuthorityTarget | undefined, Error>
  readonly loadCaller: (callerId: string) => Effect.Effect<LocalSessionCallerIdentity, Error>
  readonly resolveOriginProfileId: (callerId: string) => Effect.Effect<string | undefined, Error>
}

export class SessionExportLiveAuthority extends Context.Tag(
  '@openwaggle/SessionExportLiveAuthority',
)<SessionExportLiveAuthority, SessionExportLiveAuthorityShape>() {}
