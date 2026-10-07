import { randomUUID } from 'node:crypto'
import { boundGeneratedSessionTitle } from '@shared/session-title'
import { DEFAULT_SESSION_TITLE } from '@shared/session-title-source'
import { SessionId } from '@shared/types/brand'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
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
import { dispatchLocalSessionCommand } from './local-session-command-dispatcher'

/**
 * Pi session discovery (ADR 0048). Pi sessions the `pi` CLI created in an OpenWaggle project, or
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
 * A Session the lifecycle created for a file another writer claimed meanwhile, such as a fork or
 * copy whose preparation recorded the file after discovery read its scope. It is still empty and
 * was never shown with a transcript, so it is deleted rather than left as a stray "New session".
 */
function removeUnadoptedSession(sessionId: SessionId) {
  return Effect.gen(function* () {
    const projection = yield* SessionProjectionRepository
    if (!(yield* projection.getOptional(sessionId))) return
    yield* projection.delete(sessionId)
  })
}

/**
 * A discovered session becomes a Session the way the desktop user creates one, through the Session
 * Host's lifecycle, so it gets the project's Workspace, an execution profile, and its queue. The
 * idempotency key names the version of the file that was read, so a pass interrupted before the
 * file was attached replays the same Session instead of creating another, while a file refused
 * once and written again since gets a fresh attempt.
 */
function createDiscoveredSession(session: DiscoveredPiSession) {
  return Effect.gen(function* () {
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: session.projectPath },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: `pi-session-discovery:${session.piSessionId}:${session.size}:${session.updatedAt}`,
          command: {
            operation: 'create',
            projectPath: session.projectPath,
            title: discoveredTitle(session),
            workspace: { mode: 'local' },
          },
        },
      },
    })
    if (
      result.contract !== 'session-lifecycle-v2' ||
      result.response.outcome.effect !== 'created-root'
    ) {
      return null
    }
    const sessionId = SessionId(result.response.outcome.sessionId)
    const adopted = yield* (yield* PiSessionDiscoveryRepository).adoptDiscovered({
      sessionId,
      piSessionId: session.piSessionId,
      piSessionFile: session.piSessionFile,
      createdAt: Math.floor(Math.min(session.createdAt, session.updatedAt)),
      updatedAt: Math.floor(session.updatedAt),
    })
    if (adopted) return sessionId
    yield* removeUnadoptedSession(sessionId)
    return null
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
export function discoverPiSessions(options: { readonly now?: number } = {}) {
  return Effect.gen(function* () {
    const repository = yield* PiSessionDiscoveryRepository
    const files = yield* PiSessionFiles
    const scope = yield* repository.readScope()
    const projectPaths = yield* openWaggleProjectPaths(scope.sessionProjectPaths)
    const discovered = yield* files.discover({
      projectPaths,
      isKnownFile: (file) => scope.knownPiSessionFiles.has(file),
    })
    const quietBefore = (options.now ?? Date.now()) - NEW_FILE_QUIET_PERIOD_MS
    const pending = discovered
      .filter((session) => !scope.knownPiSessionIds.has(session.piSessionId))
      .filter((session) => session.updatedAt <= quietBefore)
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const listed: SessionId[] = []
    for (const session of pending) {
      if (listed.length >= MAX_SESSIONS_LISTED_PER_PASS) break
      const sessionId = yield* createDiscoveredSession(session).pipe(
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
      if (sessionId) listed.push(sessionId)
    }
    const last = listed.at(-1)
    // One notice per pass: the lifecycle announced each new Session, and this one makes the
    // sidebar read the adopted titles and times once.
    if (last) {
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId: last, change: 'updated' })
      logger.info('Listed Pi sessions', { count: listed.length })
    }
    return listed
  })
}

export const runPiSessionDiscoveryBackground = Effect.forkScoped(
  discoverPiSessions().pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) return
        logger.warn('Pi session discovery failed', { cause: Cause.pretty(cause) })
      }),
    ),
    Effect.repeat(Schedule.spaced(DISCOVERY_INTERVAL_MS)),
  ),
)
