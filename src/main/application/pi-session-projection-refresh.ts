import { boundGeneratedSessionTitle } from '@shared/session-title'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionQuery } from '@shared/types/session-query'
import { THINKING_LEVELS } from '@shared/types/settings'
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
import { ProviderService } from '../ports/provider-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SessionSettingsRepository } from '../ports/session-settings-repository'
import { SessionTitleRepository } from '../ports/session-title-repository'
import { ThinkingLevelDefaultService } from '../ports/thinking-level-default-service'
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

/**
 * The model `pi --resume` would continue with, when OpenWaggle can run it: the model change
 * before the latest response if it names a virtual model, otherwise the branch's last model.
 */
function continuationModel(snapshot: PiSessionFileSnapshot, projectPath: string) {
  return Effect.gen(function* () {
    const providers = yield* Effect.serviceOption(ProviderService)
    if (Option.isNone(providers)) return undefined
    const lookUp = (reference: string) =>
      providers.value.getProviderForModel(reference, projectPath).pipe(
        Effect.map((provider) => provider.models.find((model) => model.id === reference)),
        Effect.orElseSucceed(() => undefined),
      )
    const change = snapshot.lastModelChange
    const changed = change ? yield* lookUp(change) : undefined
    if (change && changed?.virtual) return changed.available ? change : undefined
    const model = snapshot.lastModel
    if (!model) return undefined
    return (yield* lookUp(model))?.available ? model : undefined
  })
}

/**
 * A discovered Pi session continues the way `pi --resume` would (ADR 0048): with the model and
 * thinking level its branch last used, not OpenWaggle's default, and with Pi's default thinking
 * level when the branch never changed it. Applied when OpenWaggle takes in what another program
 * wrote, and only while no Run is active; a model OpenWaggle cannot run keeps the Session's
 * current one rather than leaving it unable to run.
 */
function continueWithPiSessionSettings(
  sessionId: SessionId,
  state: PiSessionProjectionState,
  snapshot: PiSessionFileSnapshot,
) {
  const { projectPath, piEntryNodeIdPrefix } = state
  if (!piEntryNodeIdPrefix || !projectPath) return Effect.void
  return Effect.gen(function* () {
    const settings = yield* Effect.serviceOption(SessionSettingsRepository)
    if (Option.isNone(settings)) return
    const model = yield* continuationModel(snapshot, projectPath)
    if (model) yield* settings.value.setModel(sessionId, SupportedModelId(model))
    const recorded = THINKING_LEVELS.find((level) => level === snapshot.lastThinkingLevel)
    const defaults = yield* Effect.serviceOption(ThinkingLevelDefaultService)
    const thinkingLevel =
      recorded ?? (Option.isSome(defaults) ? yield* defaults.value.getDefault() : undefined)
    if (thinkingLevel) yield* settings.value.setThinkingLevel(sessionId, thinkingLevel)
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Could not continue a Pi session with its own model settings', {
          sessionId,
          error: formatErrorMessage(Cause.squash(cause)),
        })
      }),
    ),
  )
}

/** Titles the user did not choose, which a discovered Session's Pi `/name` replaces. */
const FOLLOWED_TITLE_SOURCES = ['default', 'provisional', 'generated'] as const

/**
 * A discovered Session's title follows its Pi session's latest `/name` (ADR 0048), unless the user
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
    // A Run already started with its model; a reader can still change the next Run's.
    if (owner === 'reader') yield* continueWithPiSessionSettings(sessionId, state, snapshot)
    yield* followPiSessionName(sessionId, state, snapshot)
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

/**
 * A Session read through the Sessions tool or `openwaggle sessions` shows the Pi file as it is
 * now, like the sidebar does (ADR 0048). It runs once the caller is resolved; projecting a file
 * only refreshes what the query would read anyway and returns nothing to the caller.
 */
export function refreshBeforeSessionQuery(query: SessionQuery) {
  if (query.operation !== 'read' && query.operation !== 'turns' && query.operation !== 'items') {
    return Effect.void
  }
  return refreshPiSessionProjectionSafely(SessionId(query.sessionId), 'reader')
}
