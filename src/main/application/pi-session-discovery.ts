import { randomUUID } from 'node:crypto'
import { boundGeneratedSessionTitle } from '@shared/session-title'
import { DEFAULT_SESSION_TITLE } from '@shared/session-title-source'
import type { SessionId } from '@shared/types/brand'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { buildDeterministicTitle } from '../agent/title-generator'
import { createLogger } from '../logger'
import {
  type DiscoveredPiSession,
  PiSessionDiscoveryRepository,
  PiSessionFiles,
} from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { isPiSessionDiscoveryPaused, unpausedProjects } from './pi-session-discovery-pauses'

/**
 * Pi session discovery (ADR 0050). Pi sessions the `pi` CLI created in an OpenWaggle project, or
 * in a folder inside one, appear in the project's sidebar without importing or copying anything:
 * the Session keeps using the same Pi file, so `pi --resume` and OpenWaggle continue one history.
 *
 * Listing reads only the start of new files. A transcript is projected the first time the Session
 * is opened, and again before it is shown or continued whenever the file changed outside
 * OpenWaggle. Nothing locks the file against the CLI; the last writer's entries are read next time.
 */

const logger = createLogger('pi-session-discovery')

/** How often the Host looks for new Pi sessions while it runs. */
const DISCOVERY_INTERVAL_MS = 10_000
/** Bounds one pass, so a project with years of `pi` history fills its sidebar over a few passes. */
const MAX_SESSIONS_LISTED_PER_PASS = 100

/** The projects whose Pi sessions are listed: every folder the sidebar shows as a project. */
function openWaggleProjectPaths(sessionProjectPaths: readonly string[]) {
  return Effect.gen(function* () {
    const settings = yield* (yield* SettingsService).get()
    const paths = new Set<string>()
    const add = (projectPath: string | null | undefined) => {
      const trimmed = projectPath?.trim()
      if (trimmed) paths.add(trimmed)
    }
    add(settings.projectPath)
    for (const projectPath of settings.recentProjects) add(projectPath)
    for (const projectPath of Object.keys(settings.projectDisplayNames)) add(projectPath)
    for (const projectPath of sessionProjectPaths) add(projectPath)
    return [...paths]
  })
}

function discoveredTitle(session: DiscoveredPiSession) {
  if (session.name) return boundGeneratedSessionTitle(session.name)
  if (session.firstUserMessage) {
    return boundGeneratedSessionTitle(buildDeterministicTitle(session.firstUserMessage))
  }
  return DEFAULT_SESSION_TITLE
}

/**
 * A Session the lifecycle created for a file discovery then could not attach: another writer
 * claimed the file meanwhile (a fork or copy whose preparation recorded it after discovery read
 * its scope), the project's removal started, or attaching failed. While it is still unattached and
 * empty it was never shown with a transcript, so it is deleted rather than left as a stray
 * "New session".
 */
function removeUnadoptedSession(sessionId: SessionId) {
  return Effect.gen(function* () {
    const state = yield* (yield* PiSessionDiscoveryRepository).getProjectionState(sessionId)
    if (!state || state.piEntryNodeIdPrefix || state.projectedPiEntryCount > 0) return
    yield* (yield* SessionProjectionRepository).delete(sessionId)
  })
}

/** What discovery asks of the Session Host's lifecycle to create a discovered Session. */
export interface DiscoveredSessionCreateInput {
  readonly projectPath: string
  readonly title: string
  readonly idempotencyKey: string
}

/**
 * Creates a root Session for a discovered file, as the desktop user would; null when the
 * lifecycle refused. The Host passes its lifecycle in, so discovery does not depend on the
 * command dispatcher, which depends on the Host runtime.
 */
export type DiscoveredSessionCreator<R> = (
  input: DiscoveredSessionCreateInput,
) => Effect.Effect<{ readonly sessionId: SessionId; readonly replayed: boolean } | null, unknown, R>

/**
 * Creates the Session for a discovered file. A replay names the Session an earlier pass created
 * for this version of the file; if that Session was deleted since, as when the project was
 * removed and added back, a new one is created instead.
 */
function createSessionForFile<R>(
  session: DiscoveredPiSession,
  create: DiscoveredSessionCreator<R>,
) {
  return Effect.gen(function* () {
    const key = `pi-session-discovery:${session.piSessionId}:${session.size}:${session.updatedAt}`
    const input = { projectPath: session.projectPath, title: discoveredTitle(session) }
    const created = yield* create({ ...input, idempotencyKey: key })
    if (!created?.replayed) return created?.sessionId ?? null
    if (yield* (yield* SessionProjectionRepository).getOptional(created.sessionId)) {
      return created.sessionId
    }
    const recreated = yield* create({ ...input, idempotencyKey: `${key}:${randomUUID()}` })
    return recreated?.sessionId ?? null
  })
}

function attachFile(session: DiscoveredPiSession, sessionId: SessionId) {
  return Effect.gen(function* () {
    const adopted = yield* (yield* PiSessionDiscoveryRepository).adoptDiscovered({
      sessionId,
      piSessionId: session.piSessionId,
      piSessionFile: session.piSessionFile,
      cwd: session.cwd,
      createdAt: Math.floor(Math.min(session.createdAt, session.updatedAt)),
      updatedAt: Math.floor(session.updatedAt),
      isStillWanted: () => !isPiSessionDiscoveryPaused(session.projectPath),
    })
    if (adopted) return sessionId
    yield* removeUnadoptedSession(sessionId)
    return null
  })
}

function createDiscoveredSession<R>(
  session: DiscoveredPiSession,
  create: DiscoveredSessionCreator<R>,
) {
  return Effect.gen(function* () {
    const sessionId = yield* createSessionForFile(session, create)
    if (!sessionId) return null
    return yield* attachFile(session, sessionId).pipe(
      Effect.onError(() => removeUnadoptedSession(sessionId).pipe(Effect.ignore)),
    )
  })
}

/**
 * Asked right before each Session is created: a removal of the project may have started, or
 * finished, since the pass read the projects.
 */
function isStillListed(projectPath: string, sessionProjectPaths: readonly string[]) {
  return Effect.gen(function* () {
    if (isPiSessionDiscoveryPaused(projectPath)) return false
    return (yield* openWaggleProjectPaths(sessionProjectPaths)).includes(projectPath)
  })
}

/** The first wait before a file that could not be listed is tried again, doubling each time. */
const FAILED_FILE_FIRST_RETRY_MS = 60_000
const FAILED_FILE_MAX_RETRY_MS = 60 * 60_000
const FAILED_FILE_RETRY_GROWTH = 2

interface FailedFile {
  readonly size: number
  readonly updatedAt: number
  readonly failures: number
  readonly retryAt: number
}

/**
 * Files whose listing failed, such as one in a project whose settings file is broken. Without
 * this a broken file is retried every pass. Keyed by the version of the file, so a file written
 * again is retried at once; an unchanged one waits, doubling up to an hour, in case what broke
 * it was outside the file. Memory only: a Host restart tries each one again once.
 */
const failedFiles = new Map<string, FailedFile>()

function isBackedOff(session: DiscoveredPiSession, now: number) {
  const failed = failedFiles.get(session.piSessionFile)
  if (!failed) return false
  if (failed.size !== session.size || failed.updatedAt !== session.updatedAt) {
    failedFiles.delete(session.piSessionFile)
    return false
  }
  return now < failed.retryAt
}

function recordListingFailure(session: DiscoveredPiSession, now: number) {
  const previous = failedFiles.get(session.piSessionFile)
  const failures = (previous?.failures ?? 0) + 1
  const delay = Math.min(
    FAILED_FILE_FIRST_RETRY_MS * FAILED_FILE_RETRY_GROWTH ** (failures - 1),
    FAILED_FILE_MAX_RETRY_MS,
  )
  failedFiles.set(session.piSessionFile, {
    size: session.size,
    updatedAt: session.updatedAt,
    failures,
    retryAt: now + delay,
  })
}

/** Pi writes a session in bursts; a file is listed once it has been quiet this long. */
const NEW_FILE_QUIET_PERIOD_MS = 5_000

/**
 * Lists the Pi sessions in OpenWaggle projects that have no Session yet, most recently used first
 * and a bounded number per pass; returns the new Session ids. A file written in the last few
 * seconds waits for the next pass: a fork or copy OpenWaggle is preparing writes its file before
 * it records it, and the CLI writes a new session in more than one step.
 */
export function discoverPiSessions<R>(options: {
  readonly now?: number
  readonly createSession: DiscoveredSessionCreator<R>
}) {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    const files = yield* PiSessionFiles
    const scope = yield* repository.readScope()
    const projectPaths = unpausedProjects(
      yield* openWaggleProjectPaths(scope.sessionProjectPaths),
      options.now,
    )
    const discovered = yield* files.discover({
      projectPaths,
      isKnownFile: (file) => scope.knownPiSessionFiles.has(file),
    })
    const now = options.now ?? Date.now()
    const pending = discovered
      .filter((session) => !scope.knownPiSessionIds.has(session.piSessionId))
      .filter((session) => session.updatedAt <= now - NEW_FILE_QUIET_PERIOD_MS)
      .filter((session) => !isBackedOff(session, now))
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const listed: SessionId[] = []
    // Only Sessions actually listed count against the cap, so failing files cannot use it up.
    for (const session of pending) {
      if (listed.length >= MAX_SESSIONS_LISTED_PER_PASS) break
      if (!(yield* isStillListed(session.projectPath, scope.sessionProjectPaths))) continue
      const sessionId = yield* createDiscoveredSession(session, options.createSession).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            logger.warn('Could not list a Pi session', {
              piSessionFile: session.piSessionFile,
              error: formatErrorMessage(Cause.squash(cause)),
            })
            return null
          }),
        ),
      )
      if (sessionId) {
        failedFiles.delete(session.piSessionFile)
        listed.push(sessionId)
        continue
      }
      // A project removal refused it; the file is fine if the folder is added back.
      if (!isPiSessionDiscoveryPaused(session.projectPath)) recordListingFailure(session, now)
    }
    // The lifecycle announced each new Session before its file was attached. Each listed Session
    // is announced again once the pass is done, so the sidebar reads its adopted title and times.
    for (const sessionId of listed) {
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
    }
    if (listed.length > 0) logger.info('Listed Pi sessions', { count: listed.length })
    return listed
  })
}

export function runPiSessionDiscoveryBackground<R>(createSession: DiscoveredSessionCreator<R>) {
  return Effect.forkScoped(
    discoverPiSessions({ createSession }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          if (Cause.isInterruptedOnly(cause)) return
          logger.warn('Pi session discovery failed', { cause: Cause.pretty(cause) })
        }),
      ),
      Effect.repeat(Schedule.spaced(DISCOVERY_INTERVAL_MS)),
    ),
  )
}
