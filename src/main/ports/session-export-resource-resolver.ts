import type { FileHandle } from 'node:fs/promises'
import type { SessionExportResourceInput } from '@shared/types/session-export-operation'
import { Context, type Effect } from 'effect'
import type { SessionExportArtifactError } from '../errors'

export interface ResolvedSessionExportResource {
  readonly path: string
  /**
   * An already-authorized descriptor. Consumers must never reopen the caller-controlled path:
   * doing so would reintroduce a check/use race after workspace confinement was established.
   */
  readonly sourceHandle: FileHandle
  readonly size: number
}

export interface SessionExportResourceResolverShape {
  readonly resolve: (input: {
    readonly sessionId: string
    readonly resource: SessionExportResourceInput
    /** Canonical workspace root authorized immediately before this resource read. */
    readonly expectedWorkspacePath?: string
  }) => Effect.Effect<ResolvedSessionExportResource, SessionExportArtifactError>
}

export class SessionExportResourceResolver extends Context.Tag(
  '@openwaggle/SessionExportResourceResolver',
)<SessionExportResourceResolver, SessionExportResourceResolverShape>() {}
