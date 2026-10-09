import { boundGeneratedSessionTitle } from '@shared/session-title'
import { type RunId, SessionId } from '@shared/types/brand'
import type { SessionQuery } from '@shared/types/session-query'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { createLogger } from '../logger'
import {
  PiSessionDiscoveryRepository,
  type PiSessionFileFingerprint,
  type PiSessionFileSnapshot,
  PiSessionFiles,
  type PiSessionProjectionState,
} from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SessionTitleRepository } from '../ports/session-title-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hasAnyActiveRun, isSessionRemovalFenced } from './active-session-runs'
import { appendDurableAgentLoopEvents } from './agent-run/agent-loop-events'
import { validateSessionId } from './host-ui-session-operation-validation'
import { continueWithPiSessionSettings } from './pi-session-continuation'
import { refuseRunWithDeletedPiFile } from './pi-session-deleted-files'

/**
 * A Session discovered from the `pi` CLI is projected the first time it is opened, and any Session
 * is projected again before it is shown or continued when its Pi file changed outside OpenWaggle
 * (ADR 0050). Nothing locks the file against the CLI; the last writer's entries are read next time.
 */

const logger = createLogger('pi-session-projection-refresh')

/** The fixed run id an external projection passes; it records no agent-loop events. */
const EXTERNAL_PROJECTION_RUN_ID = 'pi-session-discovery'

export type PiSessionProjectionRefresh =
  /** The Session has no Pi file yet, or no longer exists. */
  | 'missing'
  /** The file is as it was when it was last projected. */
  | 'fresh'
  /** The file changed but holds the projected entries; the projection was kept. */
  | 'unchanged'
  | 'projected'
  /** Another writer owns the Session; its own snapshot will include the file. */
  | 'busy'
  /** A snapshot landed while the file was read, so the read was dropped. */
  | 'superseded'

/**
 * Who asks: a reader opening the Session yields to any writer, while a Run that already owns the
 * Session's writer refreshes its projection before it starts.
 */
export type PiSessionProjectionRefreshOwner = 'reader' | 'run'

function sameFingerprint(left: PiSessionFileFingerprint, right: PiSessionFileFingerprint) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs
}

/** Titles the user did not choose, which a discovered Session's Pi `/name` replaces. */
const FOLLOWED_TITLE_SOURCES = ['default', 'provisional', 'generated'] as const

/**
 * A discovered Session's title follows its Pi session's latest `/name` (ADR 0050), unless the user
 * renamed the Session in OpenWaggle: that title is `manual`, and stays.
 */
function followPiSessionName(
  sessionId: SessionId,
  state: PiSessionProjectionState,
  snapshot: PiSessionFileSnapshot,
) {
  const name = snapshot.name ? boundGeneratedSessionTitle(snapshot.name) : undefined
  if (!state.piEntryNodeIdPrefix || !name) return Effect.void
  return Effect.gen(function* () {
    const titles = yield* Effect.serviceOption(SessionTitleRepository)
    if (Option.isNone(titles)) return
    const current = yield* titles.value.getState(sessionId)
    if (!current || current.title === name) return
    yield* titles.value.applyGenerated({
      sessionId,
      expected: { title: current.title, sources: FOLLOWED_TITLE_SOURCES },
      title: name,
      needsRefinement: false,
    })
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Could not follow a Pi session name', {
          sessionId,
          error: formatErrorMessage(Cause.squash(cause)),
        })
      }),
    ),
  )
}

function refreshProjection(
  sessionId: SessionId,
  owner: PiSessionProjectionRefreshOwner,
  runId: RunId | undefined,
) {
  return Effect.gen(function* () {
    const busy = () =>
      owner === 'reader' && (hasAnyActiveRun(sessionId) || isSessionRemovalFenced(sessionId))
    if (busy()) return 'busy' satisfies PiSessionProjectionRefresh
    const repository = yield* PiSessionDiscoveryRepository
    const files = yield* PiSessionFiles
    const state = yield* repository.getProjectionState(sessionId)
    if (!state?.piSessionFile || !state.projectPath) return 'missing'
    const fingerprint = yield* files.fingerprint(state.piSessionFile)
    if (!fingerprint) return 'missing'
    if (state.fingerprint && sameFingerprint(state.fingerprint, fingerprint)) return 'fresh'

    const snapshot = yield* files.readSnapshot({
      piSessionFile: state.piSessionFile,
      cwd: state.projectPath,
      ...(state.piEntryNodeIdPrefix ? { piEntryNodeIdPrefix: state.piEntryNodeIdPrefix } : {}),
      projectedPiEntryCount: state.projectedPiEntryCount,
      projectedNodeIds: state.projectedNodeIds,
    })
    if (snapshot.kind === 'unchanged') {
      // The projection was taken from these entries (cache refreshes since add nothing to show);
      // keep it, the branch the user selected, and the Session's place in the sidebar.
      yield* repository.recordUnchanged({
        sessionId,
        expectedRevision: state.revision,
        fingerprint: snapshot.fingerprint,
      })
      return 'unchanged'
    }
    if (busy()) return 'busy'

    const existingTree = yield* (yield* SessionRepository).getTree(sessionId)
    const persisted = yield* repository.persistExternal({
      sessionId,
      expectedRevision: state.revision,
      piSessionId: snapshot.piSessionId,
      piSessionFile: snapshot.piSessionFile,
      fingerprint: snapshot.fingerprint,
      sessionSnapshot: appendDurableAgentLoopEvents({
        snapshot: snapshot.sessionSnapshot,
        events: [],
        runId: EXTERNAL_PROJECTION_RUN_ID,
        existingNodes: existingTree?.nodes ?? [],
      }),
    })
    if (!persisted) return 'superseded'
    yield* afterProjection(sessionId, owner, state, snapshot, runId)
    return 'projected'
  })
}

/**
 * A Run that already started keeps its model, and a reader can still change the next Run's. The
 * first projection, whoever asks, makes the Session continue as `pi --resume` would: a Run
 * admitted before anyone opened the Session projects it before reading its profile.
 */
function afterProjection(
  sessionId: SessionId,
  owner: PiSessionProjectionRefreshOwner,
  state: PiSessionProjectionState,
  snapshot: PiSessionFileSnapshot,
  runId: RunId | undefined,
) {
  return Effect.gen(function* () {
    if (owner === 'reader' || state.projectedPiEntryCount === 0) {
      const outcome = yield* continueWithPiSessionSettings(sessionId, state, snapshot, {
        ...(runId ? { forRun: runId } : {}),
      })
      // A Run admitted meanwhile holds the Session; it applies these before reading its profile.
      if (outcome === 'refused-by-run') refusedContinuations.set(sessionId, { state, snapshot })
      else refusedContinuations.delete(sessionId)
    }
    yield* followPiSessionName(sessionId, state, snapshot)
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
  })
}

/** Pi settings a reader could not apply because a Run held the Session, for that Run to apply. */
const refusedContinuations = new Map<
  string,
  { readonly state: PiSessionProjectionState; readonly snapshot: PiSessionFileSnapshot }
>()

/** The Run applies the Pi settings a reader's projection could not, for its own Session. */
function applyRefusedContinuation(sessionId: SessionId, runId: RunId | undefined) {
  const refused = runId ? refusedContinuations.get(sessionId) : undefined
  if (!refused || !runId) return Effect.void
  return continueWithPiSessionSettings(sessionId, refused.state, refused.snapshot, {
    forRun: runId,
  }).pipe(
    Effect.tap((outcome) =>
      Effect.sync(() => {
        if (outcome === 'applied') refusedContinuations.delete(sessionId)
      }),
    ),
  )
}

/** Refreshes started for a Session, per owner; a concurrent caller waits for the same one. */
const refreshesInFlight = new Map<string, Promise<PiSessionProjectionRefresh>>()

/**
 * Projects a Session's Pi file again when it changed outside OpenWaggle, or for the first time
 * after discovery. One `stat` when nothing changed; the file is read only when it did.
 */
export function refreshPiSessionProjection(
  sessionId: SessionId,
  owner: PiSessionProjectionRefreshOwner,
  runId?: RunId,
) {
  return Effect.gen(function* () {
    const key = `${owner}:${sessionId}`
    const pending = refreshesInFlight.get(key)
    if (pending) return yield* Effect.promise(() => pending)
    // A reader's projection, with the Pi settings it applies, finishes before a Run reads the
    // Session: otherwise the Run could find the file projected and start with its old settings.
    const reading = owner === 'run' ? refreshesInFlight.get(`reader:${sessionId}`) : undefined
    if (reading) yield* Effect.promise(() => reading.catch(() => undefined))
    const runtime = yield* Effect.runtime<
      PiSessionDiscoveryRepository | PiSessionFiles | SessionRepository
    >()
    const refresh = Runtime.runPromise(runtime)(
      refreshProjection(sessionId, owner, runId).pipe(
        Effect.tap(() => applyRefusedContinuation(sessionId, runId)),
      ),
    ).finally(() => refreshesInFlight.delete(key))
    refreshesInFlight.set(key, refresh)
    return yield* Effect.promise(() => refresh)
  })
}

/**
 * The best-effort refresh a Session read or a Run start performs. It never fails the caller: a
 * runtime without discovery skips it, and a failed read leaves the current projection in place.
 */
export function refreshPiSessionProjectionSafely(
  sessionId: SessionId,
  owner: PiSessionProjectionRefreshOwner,
  runId?: RunId,
) {
  return Effect.gen(function* () {
    const repository = yield* Effect.serviceOption(PiSessionDiscoveryRepository)
    const files = yield* Effect.serviceOption(PiSessionFiles)
    const sessions = yield* Effect.serviceOption(SessionRepository)
    if (Option.isNone(repository) || Option.isNone(files) || Option.isNone(sessions)) return
    yield* refreshPiSessionProjection(sessionId, owner, runId).pipe(
      Effect.provideService(PiSessionDiscoveryRepository, repository.value),
      Effect.provideService(PiSessionFiles, files.value),
      Effect.provideService(SessionRepository, sessions.value),
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('Could not project a Pi session file that changed outside OpenWaggle', {
            sessionId,
            error: formatErrorMessage(Cause.squash(cause)),
          })
        }),
      ),
    )
  })
}

/**
 * Before a Run reads its Session or profile: refuses a discovered Session whose Pi file was
 * deleted, then takes in what the Pi CLI wrote since the last projection (ADR 0050).
 */
export function prepareSessionForRun(sessionId: SessionId, runId?: RunId) {
  return Effect.zipRight(
    refuseRunWithDeletedPiFile(sessionId),
    refreshPiSessionProjectionSafely(sessionId, 'run', runId),
  )
}

/** A Session read: the Session is shown as its Pi file is now (ADR 0050). */
export function openedSessionId(value: unknown) {
  return Effect.tap(validateSessionId(value), (sessionId) =>
    refreshPiSessionProjectionSafely(sessionId, 'reader'),
  )
}

/**
 * A Run's Session, after taking in what the Pi CLI added since it was last projected. A
 * discovered Session whose Pi file was deleted is refused.
 */
export function loadSessionForRun(sessionId: SessionId, runId?: RunId) {
  return Effect.zipRight(
    prepareSessionForRun(sessionId, runId),
    Effect.flatMap(SessionProjectionRepository, (repository) => repository.getOptional(sessionId)),
  )
}

/**
 * A Session read through the Sessions tool or `openwaggle sessions` shows the Pi file as it is
 * now, like the sidebar does (ADR 0050). It runs once the caller is resolved; projecting a file
 * only refreshes what the query would read anyway and returns nothing to the caller.
 */
export function refreshBeforeSessionQuery(query: SessionQuery) {
  if (query.operation !== 'read' && query.operation !== 'turns' && query.operation !== 'items') {
    return Effect.void
  }
  return refreshPiSessionProjectionSafely(SessionId(query.sessionId), 'reader')
}
