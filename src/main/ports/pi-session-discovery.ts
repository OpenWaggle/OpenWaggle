import type { PiSessionFileUnavailability } from '@shared/domain/pi-session-file-messages'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { Context, type Effect } from 'effect'
import type { SessionProjectionRepositoryError } from '../errors'
import type { AgentKernelSessionSnapshot } from './agent-kernel-service'

/**
 * Pi session discovery (ADR 0051): Pi sessions created outside OpenWaggle inside an OpenWaggle
 * project become ordinary Sessions, and a Pi file that changed outside OpenWaggle is projected
 * again before it is shown or continued.
 */

/**
 * Where a projection's last entry ends in its Pi file, with a digest of the file's first bytes and
 * of that entry's line, so a later read can tell the file only grew since (D6).
 */
export interface PiSessionFileTailMarker {
  readonly offset: number
  readonly lineStart: number
  readonly digest: string
  readonly lastEntryId: string
}

/** The file state a projection was read from. Pi files are append-only, so any write changes it. */
export interface PiSessionFileFingerprint {
  readonly size: number
  readonly mtimeMs: number
  /** The tail of the content the projection was read from, when it ends in a complete entry. */
  readonly tail?: PiSessionFileTailMarker | null
}

/** A projection's recorded tail: where its entries end, how many there are, and its leaf. */
export interface PiSessionProjectedTail extends PiSessionFileTailMarker {
  readonly entryCount: number
  readonly leafNodeId: string | null
}

/** What a discovered Session is titled from, read from the start of its Pi file. */
export interface PiSessionTitleSource {
  /** The session's Pi `/name`, when one was found. */
  readonly name: string | null
  /** The first user message's text, when one was found. */
  readonly firstUserMessage: string | null
  /** When the first user message was sent, when known. */
  readonly firstUserMessageAt: number | null
  /** The model the session had when the first user message was sent, as `provider/model`. */
  readonly model: string | null
}

export interface DiscoveredPiSession extends PiSessionTitleSource {
  readonly piSessionId: string
  readonly piSessionFile: string
  /** The working directory recorded in the session header. */
  readonly cwd: string
  /** The OpenWaggle project the working directory is inside: the most specific one. */
  readonly projectPath: string
  readonly createdAt: number
  /** When the session was last used: the file's last modification. */
  readonly updatedAt: number
  /** The file's size, which with `updatedAt` identifies the version of the file that was read. */
  readonly size: number
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
  /**
   * The model the branch last used, as `provider/model`: its last model change, or the model
   * that gave the latest response after it.
   */
  readonly lastModel?: string
  /**
   * The model change before the latest response. `pi --resume` keeps it instead of `lastModel`
   * when it names a virtual model, which routes each request to a physical one.
   */
  readonly lastModelChange?: string
  /** The branch's last thinking level change; without one `pi --resume` uses Pi's default. */
  readonly lastThinkingLevel?: string
  /**
   * Pi's `defaultThinkingLevel` for the folder the session ran in, project settings over global
   * ones, when either names one: what `pi --resume` uses when the branch never changed it.
   */
  readonly defaultThinkingLevel?: string
  /** The session's latest `/name`, which a discovered Session's title follows. */
  readonly name?: string
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

export type PiSessionContinuation =
  | { readonly kind: 'file'; readonly file: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'unsearchable'; readonly folder: string }

/**
 * Who wrote a Pi file's latest prompt: an OpenWaggle Run, or something outside OpenWaggle such as
 * the `pi` CLI.
 */
export type PiSessionPromptOrigin = 'openwaggle' | 'outside'

export interface PiSessionFilesShape {
  readonly discover: (
    input: PiSessionDiscoveryInput,
  ) => Effect.Effect<readonly DiscoveredPiSession[], Error>
  /**
   * What titles a Pi file OpenWaggle already lists, read as discovery reads a new one; null when
   * it is not a Pi session or cannot be read.
   */
  readonly titleSource: (piSessionFile: string) => Effect.Effect<PiSessionTitleSource | null>
  /** Who wrote the file's latest prompt; null when it has none or cannot be read. */
  readonly lastPromptOrigin: (piSessionFile: string) => Effect.Effect<PiSessionPromptOrigin | null>
  /** Null when the file does not exist (yet). */
  readonly fingerprint: (piSessionFile: string) => Effect.Effect<PiSessionFileFingerprint | null>
  /** The file was deleted: it is missing while its folder is there. */
  readonly isDeleted: (piSessionFile: string) => Effect.Effect<boolean>
  /**
   * Why the file is out of reach, undefined while it is not: its folder is missing, as on a
   * drive not connected (`folder`), or it may not be read or links to nothing (`file`).
   */
  readonly unavailability: (
    piSessionFile: string,
  ) => Effect.Effect<PiSessionFileUnavailability | undefined>
  /**
   * The Pi file a Run of `session` would continue, which may be a copy under its Pi session id
   * when the recorded file is gone from its folder, or that it would start a new one; unknown
   * while a folder that may hold a copy cannot be read.
   */
  readonly continuedFile: (session: SessionDetail) => Effect.Effect<PiSessionContinuation>
  /**
   * `piEntryNodeIdPrefix` is the Session's, for a discovered Pi session (ADR 0051).
   * `projectedPiEntryCount` is how many of the file's entries the projection already holds.
   */
  readonly readSnapshot: (input: {
    readonly piSessionFile: string
    readonly cwd: string
    readonly piEntryNodeIdPrefix?: string
    readonly projectedPiEntryCount?: number
    readonly projectedNodeIds?: ReadonlySet<string>
    /**
     * The projection's recorded tail. While the file only grew past it, only the appended bytes
     * are read to tell whether anything but usage entries was added.
     */
    readonly projectedTail?: PiSessionProjectedTail | null
    /** The Session whose projection a changed file's snapshot may keep entries of. */
    readonly sessionId?: SessionId
  }) => Effect.Effect<PiSessionFileRead, Error>
}

export class PiSessionFiles extends Context.Tag('@openwaggle/PiSessionFiles')<
  PiSessionFiles,
  PiSessionFilesShape
>() {}

/** Every lifecycle create discovery sends has an idempotency key that starts with this. */
export const PI_SESSION_DISCOVERY_IDEMPOTENCY_PREFIX = 'pi-session-discovery:'

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
  /** The working directory in the session header, inside the project. */
  readonly cwd: string
  readonly createdAt: number
  readonly updatedAt: number
  /**
   * Who chose the title the Session was created with: `default` for none, `provisional` for one
   * a Title model request will replace, `generated` for one discovery keeps (a Pi `/name`).
   */
  readonly titleSource: 'default' | 'provisional' | 'generated'
  /**
   * Asked inside the adoption's transaction; false refuses it. Discovery uses it to stay out of a
   * project whose removal started after the Session was created.
   */
  readonly isStillWanted: () => boolean
}

export interface TitleOwedDiscoveredSession {
  readonly sessionId: SessionId
  readonly piSessionFile: string
  readonly titleSource: 'default' | 'provisional'
}

export interface PiSessionProjectionState {
  readonly sessionId: SessionId
  readonly piSessionFile: string | null
  readonly projectPath: string | null
  /** Set for a discovered Pi session, whose node ids carry it before each Pi entry id. */
  readonly piEntryNodeIdPrefix?: string
  /** The Pi entries the projection holds (durable agent-loop nodes are not Pi entries). */
  readonly projectedPiEntryCount: number
  /** Every projected node's id, Pi entries and durable agent-loop nodes alike. */
  readonly projectedNodeIds: ReadonlySet<string>
  /** Advances on every persisted snapshot, so a projection read earlier can tell it is stale. */
  readonly revision: number
  /** The file state the last persisted snapshot came from, when this Host recorded one. */
  readonly fingerprint: PiSessionFileFingerprint | null
  /** Where the projected entries end in the file, when the last snapshot recorded it (D6). */
  readonly projectedTail: PiSessionProjectedTail | null
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
   * Session already has the file or its id, the Session already has a transcript, or
   * `isStillWanted` says no.
   */
  readonly adoptDiscovered: (
    input: AdoptDiscoveredPiSessionInput,
  ) => Effect.Effect<boolean, SessionProjectionRepositoryError>
  readonly getProjectionState: (
    sessionId: SessionId,
  ) => Effect.Effect<PiSessionProjectionState | null, SessionProjectionRepositoryError>
  /**
   * Sessions discovery created that never got a Pi file attached and are still empty, such as
   * one a Host stopped with between creating it and attaching the file. Only creates discovery
   * recorded count, not every key under its prefix.
   */
  readonly listUnattachedDiscoveredSessions: () => Effect.Effect<
    readonly SessionId[],
    SessionProjectionRepositoryError
  >
  /**
   * Records a lifecycle create discovery is about to send, so the Host start knows the Session
   * as discovery's, and the lifecycle admits the key.
   */
  readonly recordDiscoveryCreate: (
    idempotencyKey: string,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  /** Forgets finished creates; all of them once the Host start cleaned up after them. */
  readonly forgetDiscoveryCreates: (
    idempotencyKeys?: readonly string[],
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  /**
   * Why the Session cannot be deleted, such as a fork or Worker that depends on it; undefined
   * when it can. Nothing is changed.
   */
  readonly deletionRefusal: (
    sessionId: SessionId,
  ) => Effect.Effect<string | undefined, SessionProjectionRepositoryError>
  /**
   * Unarchived discovered Sessions whose title discovery still owes: those without one, and
   * those with a Provisional title last used after `activeAfter`, most recent first.
   */
  readonly listTitleOwedDiscoveredSessions: (input: {
    readonly activeAfter: number
    readonly limit: number
  }) => Effect.Effect<readonly TitleOwedDiscoveredSession[], SessionProjectionRepositoryError>
  /** Every discovered Session that has its Pi file attached, with the file. */
  readonly listAdoptedPiSessionFiles: () => Effect.Effect<
    readonly { readonly sessionId: SessionId; readonly piSessionFile: string }[],
    SessionProjectionRepositoryError
  >
  /** Every unarchived Session OpenWaggle created that holds a transcript and records a Pi file. */
  readonly listCreatedPiSessionFiles: () => Effect.Effect<
    readonly { readonly sessionId: SessionId; readonly piSessionFile: string }[],
    SessionProjectionRepositoryError
  >
  /** Records that the projection still matches the file; false when a snapshot landed meanwhile. */
  readonly recordUnchanged: (input: {
    readonly sessionId: SessionId
    readonly expectedRevision: number
    readonly fingerprint: PiSessionFileFingerprint
  }) => Effect.Effect<boolean, SessionProjectionRepositoryError>
  /** Replaces the projection with the file's; false when a snapshot landed meanwhile. */
  readonly persistExternal: (
    input: PersistExternalPiProjectionInput,
  ) => Effect.Effect<boolean, SessionProjectionRepositoryError>
}

export class PiSessionDiscoveryRepository extends Context.Tag(
  '@openwaggle/PiSessionDiscoveryRepository',
)<PiSessionDiscoveryRepository, PiSessionDiscoveryRepositoryShape>() {}
