import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionProjectionRepositoryError } from '../errors'
import type { AgentKernelSessionSnapshot } from './agent-kernel-service'

/**
 * Pi session discovery (ADR 0048): Pi sessions created outside OpenWaggle inside an OpenWaggle
 * project become ordinary Sessions, and a Pi file that changed outside OpenWaggle is projected
 * again before it is shown or continued.
 */

/** The file state a projection was read from. Pi files are append-only, so any write changes it. */
export interface PiSessionFileFingerprint {
  readonly size: number
  readonly mtimeMs: number
}

export interface DiscoveredPiSession {
  readonly piSessionId: string
  readonly piSessionFile: string
  /** The working directory recorded in the session header. */
  readonly cwd: string
  /** The OpenWaggle project the working directory is inside: the most specific one. */
  readonly projectPath: string
  /** The session's Pi `/name`, when one was found. */
  readonly name: string | null
  /** The first user message's text, when one was found. */
  readonly firstUserMessage: string | null
  readonly createdAt: number
  /** When the session was last used. */
  readonly updatedAt: number
}

export interface PiSessionDiscoveryInput {
  readonly projectPaths: readonly string[]
  /** Files OpenWaggle already has a Session for; they are skipped without being read. */
  readonly isKnownFile: (piSessionFile: string) => boolean
}

export interface PiSessionFileSnapshot {
  readonly piSessionId: string
  readonly piSessionFile: string
  /** The Pi entries in the file, which the projection stores one node each. */
  readonly entryCount: number
  /** Taken before the file was read, so a write during the read is seen next time. */
  readonly fingerprint: PiSessionFileFingerprint
  readonly sessionSnapshot: AgentKernelSessionSnapshot
}

/**
 * A read of a Pi file against its projection. `unchanged` when the file holds the projected
 * entries and at most usage entries after them (cache refreshes, which a transcript does not
 * show), so nothing needs projecting.
 */
export type PiSessionFileRead =
  | ({ readonly kind: 'changed' } & PiSessionFileSnapshot)
  | {
      readonly kind: 'unchanged'
      readonly fingerprint: PiSessionFileFingerprint
    }

export interface PiSessionFilesShape {
  readonly discover: (
    input: PiSessionDiscoveryInput,
  ) => Effect.Effect<readonly DiscoveredPiSession[], Error>
  /** Null when the file does not exist (yet). */
  readonly fingerprint: (piSessionFile: string) => Effect.Effect<PiSessionFileFingerprint | null>
  /**
   * `piEntryNodeIdPrefix` is the Session's, for a discovered Pi session (ADR 0048).
   * `projectedPiEntryCount` is how many of the file's entries the projection already holds.
   */
  readonly readSnapshot: (input: {
    readonly piSessionFile: string
    readonly cwd: string
    readonly piEntryNodeIdPrefix?: string
    readonly projectedPiEntryCount?: number
  }) => Effect.Effect<PiSessionFileRead, Error>
}

export class PiSessionFiles extends Context.Tag('@openwaggle/PiSessionFiles')<
  PiSessionFiles,
  PiSessionFilesShape
>() {}

export interface PiSessionDiscoveryScope {
  readonly knownPiSessionIds: ReadonlySet<string>
  /** Session files OpenWaggle has a Session for, or is deleting. */
  readonly knownPiSessionFiles: ReadonlySet<string>
  /** Projects of the Sessions OpenWaggle lists, which count as OpenWaggle projects. */
  readonly sessionProjectPaths: readonly string[]
}

export interface AdoptDiscoveredPiSessionInput {
  /** A Session the Session Host just created in the discovered session's project. */
  readonly sessionId: SessionId
  readonly piSessionId: string
  readonly piSessionFile: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PiSessionProjectionState {
  readonly sessionId: SessionId
  readonly piSessionFile: string | null
  readonly projectPath: string | null
  /** Set for a discovered Pi session, whose node ids carry it before each Pi entry id. */
  readonly piEntryNodeIdPrefix?: string
  /** The Pi entries the projection holds (durable agent-loop nodes are not Pi entries). */
  readonly projectedPiEntryCount: number
  /** Advances on every persisted snapshot, so a projection read earlier can tell it is stale. */
  readonly revision: number
  /** The file state the last persisted snapshot came from, when this Host recorded one. */
  readonly fingerprint: PiSessionFileFingerprint | null
}

export interface PersistExternalPiProjectionInput {
  readonly sessionId: SessionId
  readonly expectedRevision: number
  readonly piSessionId: string
  readonly piSessionFile: string
  readonly fingerprint: PiSessionFileFingerprint
  readonly sessionSnapshot: AgentKernelSessionSnapshot
}

export interface PiSessionDiscoveryRepositoryShape {
  readonly readScope: () => Effect.Effect<PiSessionDiscoveryScope, SessionProjectionRepositoryError>
  /**
   * Points a newly created, still empty Session at the discovered Pi file. False when another
   * Session already has the file or its id, or the Session already has a transcript.
   */
  readonly adoptDiscovered: (
    input: AdoptDiscoveredPiSessionInput,
  ) => Effect.Effect<boolean, SessionProjectionRepositoryError>
  readonly getProjectionState: (
    sessionId: SessionId,
  ) => Effect.Effect<PiSessionProjectionState | null, SessionProjectionRepositoryError>
  /** Records that the projection still matches the file; false when a snapshot landed meanwhile. */
  readonly recordUnchanged: (input: {
    readonly sessionId: SessionId
    readonly expectedRevision: number
    readonly fingerprint: PiSessionFileFingerprint
  }) => Effect.Effect<boolean>
  /** Replaces the projection with the file's; false when a snapshot landed meanwhile. */
  readonly persistExternal: (
    input: PersistExternalPiProjectionInput,
  ) => Effect.Effect<boolean, SessionProjectionRepositoryError>
}

export class PiSessionDiscoveryRepository extends Context.Tag(
  '@openwaggle/PiSessionDiscoveryRepository',
)<PiSessionDiscoveryRepository, PiSessionDiscoveryRepositoryShape>() {}
