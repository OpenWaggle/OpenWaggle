import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { createLogger } from '../logger'
import {
  type AdoptDiscoveredPiSessionInput,
  type DiscoveredPiSession,
  PI_SESSION_DISCOVERY_IDEMPOTENCY_PREFIX,
  PiSessionDiscoveryRepository,
  PiSessionFiles,
} from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { hostBackgroundGate } from './host-background-gate'
import { announceCreatedSessionsWithMissingPiFiles } from './pi-session-created-file-notices'
import { removeSessionsWithDeletedPiFiles } from './pi-session-deleted-files'
import {
  removeUnadoptedSession,
  removeUnattachedDiscoveredSessions,
} from './pi-session-discovery-cleanup'
import { isPiSessionDiscoveryPaused, unpausedProjects } from './pi-session-discovery-pauses'
import {
  discoveredTitle,
  requestDiscoveredSessionTitle,
  titleDiscoveredSessions,
} from './pi-session-discovery-titles'

/**
 * Pi session discovery (ADR 0051). Pi sessions the `pi` CLI created in an OpenWaggle project, or
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

/** The lifecycle idempotency key for one version of a discovered file. */
export function discoveredSessionCreateKey(
  session: Pick<DiscoveredPiSession, 'piSessionId' | 'size' | 'updatedAt'>,
) {
  return `${PI_SESSION_DISCOVERY_IDEMPOTENCY_PREFIX}${session.piSessionId}:${session.size}:${session.updatedAt}`
}

/**
 * Creates the Session for a discovered file. A replay names the Session an earlier pass created
 * for this version of the file; if that Session was deleted since, as when the project was
 * removed and added back, a new one is created instead.
 */
function createSessionForFile<R>(
  session: DiscoveredPiSession,
  title: string,
  create: DiscoveredSessionCreator<R>,
  keys: string[],
) {
  return Effect.gen(function* () {
    const key = discoveredSessionCreateKey(session)
    const input = { projectPath: session.projectPath, title }
    keys.push(key)
    const created = yield* create({ ...input, idempotencyKey: key })
    if (!created?.replayed) return created?.sessionId ?? null
    if (yield* (yield* SessionProjectionRepository).getOptional(created.sessionId)) {
      return created.sessionId
    }
    const fresh = `${key}:${randomUUID()}`
    keys.push(fresh)
    const recreated = yield* create({ ...input, idempotencyKey: fresh })
    return recreated?.sessionId ?? null
  })
}

function attachFile(
  session: DiscoveredPiSession,
  sessionId: SessionId,
  titleSource: AdoptDiscoveredPiSessionInput['titleSource'],
) {
  return Effect.gen(function* () {
    const adopted = yield* (yield* PiSessionDiscoveryRepository).adoptDiscovered({
      sessionId,
      piSessionId: session.piSessionId,
      piSessionFile: session.piSessionFile,
      cwd: session.cwd,
      createdAt: Math.floor(Math.min(session.createdAt, session.updatedAt)),
      updatedAt: Math.floor(session.updatedAt),
      titleSource,
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
  now: number,
) {
  const keys: string[] = []
  const title = discoveredTitle(session, now)
  // Once the Session is attached or removed, the Host start no longer needs to know of it. A
  // create that failed, or one a Host stop interrupted, keeps its record for that start.
  const forget = Effect.flatMap(PiSessionDiscoveryRepository, (repository) =>
    repository.forgetDiscoveryCreates(keys),
  ).pipe(Effect.ignore)
  return Effect.gen(function* () {
    const sessionId = yield* createSessionForFile(session, title.title, create, keys)
    if (!sessionId) {
      yield* forget
      return null
    }
    const attached = yield* attachFile(session, sessionId, title.source).pipe(
      Effect.onError((cause) =>
        removeUnadoptedSession(sessionId).pipe(
          Effect.zipRight(Cause.isInterrupted(cause) ? Effect.void : forget),
          Effect.ignore,
        ),
      ),
    )
    yield* forget
    if (attached && title.source === 'provisional') requestDiscoveredSessionTitle(attached, session)
    return attached
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
    yield* removeSessionsWithDeletedPiFiles()
    yield* announceCreatedSessionsWithMissingPiFiles()
    const scope = yield* repository.readScope()
    const projectPaths = yield* openWaggleProjectPaths(scope.sessionProjectPaths)
    const unpaused = new Set(unpausedProjects(projectPaths, options.now))
    // A project being removed still owns the sessions in its folders, so a nested project's
    // sessions do not move to the enclosing project until the removal is done.
    const discovered = yield* files.discover({
      projectPaths,
      isKnownFile: (file) => scope.knownPiSessionFiles.has(file),
    })
    const now = options.now ?? Date.now()
    const pending = discovered
      .filter((session) => unpaused.has(session.projectPath))
      .filter((session) => !scope.knownPiSessionIds.has(session.piSessionId))
      .filter((session) => session.updatedAt <= now - NEW_FILE_QUIET_PERIOD_MS)
      .filter((session) => !isBackedOff(session, now))
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const listed: SessionId[] = []
    // Only Sessions actually listed count against the cap, so failing files cannot use it up.
    for (const session of pending) {
      if (listed.length >= MAX_SESSIONS_LISTED_PER_PASS) break
      if (!(yield* isStillListed(session.projectPath, scope.sessionProjectPaths))) continue
      const sessionId = yield* createDiscoveredSession(session, options.createSession, now).pipe(
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
    yield* titleDiscoveredSessions(now)
    return listed
  })
}

export { removeUnattachedDiscoveredSessions }

export function runPiSessionDiscoveryBackground<R>(createSession: DiscoveredSessionCreator<R>) {
  const logFailure = (cause: Cause.Cause<unknown>) =>
    Effect.sync(() => {
      if (Cause.isInterruptedOnly(cause)) return
      logger.warn('Pi session discovery failed', { cause: Cause.pretty(cause) })
    })
  // Each pass waits until a client has been attached a moment, and while none is (A-F9).
  const whenAllowed = Effect.promise(() => hostBackgroundGate.whenOpen())
  return Effect.forkScoped(
    whenAllowed.pipe(
      Effect.zipRight(removeUnattachedDiscoveredSessions()),
      Effect.catchAllCause(logFailure),
      Effect.zipRight(
        whenAllowed.pipe(
          Effect.zipRight(discoverPiSessions({ createSession })),
          Effect.catchAllCause(logFailure),
          Effect.repeat(Schedule.spaced(DISCOVERY_INTERVAL_MS)),
        ),
      ),
    ),
  )
}
