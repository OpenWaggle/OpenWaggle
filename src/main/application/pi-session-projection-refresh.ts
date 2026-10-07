import type { SessionId } from '@shared/types/brand'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { createLogger } from '../logger'
import {
  PiSessionDiscoveryRepository,
  type PiSessionFileFingerprint,
  PiSessionFiles,
} from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hasAnyActiveRun, isSessionRemovalFenced } from './active-session-runs'
import { appendDurableAgentLoopEvents } from './agent-run/agent-loop-events'
import { validateSessionId } from './host-ui-session-operation-validation'

/**
 * A Session discovered from the `pi` CLI is projected the first time it is opened, and any Session
 * is projected again before it is shown or continued when its Pi file changed outside OpenWaggle
 * (ADR 0048). Nothing locks the file against the CLI; the last writer's entries are read next time.
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

function refreshProjection(sessionId: SessionId, owner: PiSessionProjectionRefreshOwner) {
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
    })
    if (snapshot.entryCount === state.projectedPiEntryCount) {
      // The projection was taken from these entries; keep it, and the branch the user selected.
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
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
    return 'projected'
  })
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
) {
  return Effect.gen(function* () {
    const key = `${owner}:${sessionId}`
    const pending = refreshesInFlight.get(key)
    if (pending) return yield* Effect.promise(() => pending)
    const runtime = yield* Effect.runtime<
      PiSessionDiscoveryRepository | PiSessionFiles | SessionRepository
    >()
    const refresh = Runtime.runPromise(runtime)(refreshProjection(sessionId, owner)).finally(() =>
      refreshesInFlight.delete(key),
    )
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
) {
  return Effect.gen(function* () {
    const repository = yield* Effect.serviceOption(PiSessionDiscoveryRepository)
    const files = yield* Effect.serviceOption(PiSessionFiles)
    const sessions = yield* Effect.serviceOption(SessionRepository)
    if (Option.isNone(repository) || Option.isNone(files) || Option.isNone(sessions)) return
    yield* refreshPiSessionProjection(sessionId, owner).pipe(
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

/** A Session read: the Session is shown as its Pi file is now (ADR 0048). */
export function openedSessionId(value: unknown) {
  return Effect.tap(validateSessionId(value), (sessionId) =>
    refreshPiSessionProjectionSafely(sessionId, 'reader'),
  )
}

/** A Run's Session, after taking in what the Pi CLI added since it was last projected. */
export function loadSessionForRun(sessionId: SessionId) {
  return Effect.zipRight(
    refreshPiSessionProjectionSafely(sessionId, 'run'),
    Effect.flatMap(SessionProjectionRepository, (repository) => repository.getOptional(sessionId)),
  )
}
