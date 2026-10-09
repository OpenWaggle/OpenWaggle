import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import path, { basename, dirname, join, resolve } from 'node:path'
import { getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail } from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import { resolvePiSessionDirectory } from '../pi-session-directory'
import { isInsideProjectLocation, physicalPath } from '../pi-session-project-paths'
import { logger } from './constants'
import { piEntryNodeIds } from './pi-entry-node-ids'
import { onlyUsageAppendedAfter } from './usage-only-appends'

/**
 * The opened checkout for a session.
 *
 * Distinct from {@link resolveSessionWorkingPath}: this is the repository the user opened,
 * never a Session worktree. Worktree birth needs it specifically, because it creates the
 * worktree *from* the primary checkout.
 */
export function requireSessionProjectPath(session: SessionDetail): string {
  const projectPath = session.projectPath
  if (!projectPath) {
    throw new Error('No project path set on the session - cannot run Pi agent')
  }
  return projectPath
}

/** Enough of a Pi file for its header line. */
const HEADER_READ_BYTES = 64 * 1024
/** Header working directories by file; a Pi session's header never changes. */
const headerCwdByFile = new Map<string, string | null>()

function readHeaderCwd(file: string) {
  let descriptor: number | undefined
  try {
    descriptor = openSync(file, 'r')
    const buffer = Buffer.alloc(HEADER_READ_BYTES)
    const bytesRead = readSync(descriptor, buffer, 0, HEADER_READ_BYTES, 0)
    for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (!line.trim()) continue
      const header: unknown = JSON.parse(line)
      if (typeof header !== 'object' || header === null || !('cwd' in header)) return null
      return typeof header.cwd === 'string' ? header.cwd : null
    }
    return null
  } catch {
    // A missing or unreadable file has no folder to offer; the checkout is used.
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** The working directory a Session's Pi file records in its header. */
function piFileCwd(piSessionFile: string | undefined) {
  if (!piSessionFile) return null
  const cached = headerCwdByFile.get(piSessionFile)
  if (cached !== undefined) return cached
  const cwd = readHeaderCwd(piSessionFile)
  if (cwd !== null) headerCwdByFile.set(piSessionFile, cwd)
  return cwd
}

/**
 * Where a local-mode Session's agent works: the folder its Pi session runs in when that is inside
 * the opened checkout, otherwise the checkout. For a Pi session discovered from the `pi` CLI that
 * is the folder the CLI ran in, so it continues there as `pi --resume` would (ADR 0050); a fork
 * or copy of it records the same folder in its own file's header. A folder that is gone or outside
 * the project falls back to the checkout.
 */
export function resolveLocalWorkingPath(session: SessionDetail, projectPath: string) {
  const cwd = session.piSessionCwd ?? piFileCwd(session.piSessionFile)
  // Pi records the physical folder, so a project opened through a link is matched by both.
  if (!cwd || !isInsideProjectLocation(cwd, projectPath) || !existsSync(cwd)) return projectPath
  return path.resolve(cwd)
}

/**
 * The working tree a Pi agent for this session must run in.
 *
 * Worktree-mode sessions run in their dedicated Session worktree (ADR 0010); local-mode
 * sessions run in the opened checkout unchanged.
 *
 * A recorded worktree that no longer exists throws rather than falling back to the opened
 * checkout. The fallback was silent, and its effect was to hand the agent the user's own
 * checkout as its working directory — the isolation worktree mode exists to provide,
 * removed without anything in the UI saying so. Worktree birth refuses for the same
 * reason, and the composer blocks the send and offers to recreate or switch, so a user
 * who hits this has a way forward that does not involve guessing.
 */
export function resolveSessionWorkingPath(session: SessionDetail): string {
  const projectPath = requireSessionProjectPath(session)
  if (session.environmentMode !== 'worktree') return resolveLocalWorkingPath(session, projectPath)

  const worktreePath = session.worktreePath?.trim()
  if (!worktreePath) return projectPath
  if (existsSync(worktreePath)) return worktreePath

  throw new Error(
    "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout.",
  )
}

/**
 * Moves a reopened Pi session to the conversation position the projection selected.
 *
 * Pi opens a session file at its last entry and keeps later tree navigation in memory only. A
 * branch switch or a retry from an earlier message is a separate Pi operation from the run that
 * follows it, so without this the run would continue whichever branch was written last: the
 * message lands on another branch than the one the user is looking at, and the model answers
 * from that other branch's context. See `SessionResumePosition` for the freshness rule.
 */
function resumeSelectedPosition(sessionManager: SessionManager, session: SessionDetail) {
  const position = session.resumePosition
  if (!position) return
  // Only warming refreshes may have been appended since the projection, or it is stale.
  if (!onlyUsageAppendedAfter(sessionManager.getEntries(), position.piEntryCount)) return
  const entryId = piEntryNodeIds(session).toEntryId(String(position.nodeId))
  if (!sessionManager.getEntry(entryId)) return
  if (leafContinuesThrough(sessionManager, entryId)) return
  sessionManager.branch(entryId)
}

/**
 * Whether the leaf is the selected entry, or follows it through warming refreshes only. Pi then
 * chains the next message onto the refreshes; branching back to the entry would leave them as a
 * sibling branch.
 */
function leafContinuesThrough(sessionManager: SessionManager, entryId: string) {
  let current = sessionManager.getLeafId()
  while (current) {
    if (current === entryId) return true
    const entry = sessionManager.getEntry(current)
    if (entry?.type !== 'usage') return false
    current = entry.parentId
  }
  return false
}

function piSessionFilesIn(directory: string, piSessionId: string) {
  try {
    // Exact id match: Pi allows `_` in session ids, so `<time>_review_<id>.jsonl` also ends with
    // `_<id>.jsonl` but belongs to another Pi session.
    return readdirSync(directory)
      .filter((name) => piSessionIdOfFile(name) === piSessionId)
      .map((name) => join(directory, name))
  } catch (error) {
    if (!(isRecord(error) && error.code === 'ENOENT')) {
      logger.warn('Could not list a Pi session directory', {
        directory,
        code: isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown',
      })
    }
    return []
  }
}

function modifiedAt(file: string) {
  try {
    return statSync(file).mtimeMs
  } catch {
    return Number.NEGATIVE_INFINITY
  }
}

/**
 * The directory Pi keeps `cwd`'s session files in, computed without creating it: a configured
 * session directory (`resolvePiSessionDirectory`), otherwise Pi's default folder for `cwd`.
 */
export function piSessionDirectoryFor(cwd: string) {
  const configured = resolvePiSessionDirectory(cwd)
  if (configured) return configured
  const safePath = `--${resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  return join(getAgentDir(), 'sessions', safePath)
}

type PiSessionFileLocation = Pick<
  SessionDetail,
  'piSessionFile' | 'piSessionId' | 'projectPath' | 'worktreePath'
>

const PI_SESSION_FILE_EXTENSION = '.jsonl'

/**
 * The Pi session id a Pi session file belongs to, read from its name.
 *
 * Pi names every session file `<creation time>_<Pi session id>.jsonl`, and the creation time holds
 * no underscore. A path that does not follow that convention identifies no Pi session.
 */
export function piSessionIdOfFile(file: string) {
  const name = basename(file)
  if (!name.endsWith(PI_SESSION_FILE_EXTENSION)) return undefined
  const separator = name.indexOf('_')
  if (separator < 0) return undefined
  const piSessionId = name.slice(separator + 1, -PI_SESSION_FILE_EXTENSION.length)
  return piSessionId || undefined
}

/**
 * Every file that holds a transcript of the Session's Pi session id, newest first.
 *
 * Looks in the run directory's Pi session directory, the recorded path's directory, and the
 * directories of the Session's checkout and worktree, in case the Session moved between them.
 * See {@link findExistingPiSessionFile} for why a transcript can live outside the recorded path.
 * Only files named for the Session's own Pi session id are returned, never another session's.
 */
export function findPiSessionFiles(session: PiSessionFileLocation, runDirectory?: string) {
  const piSessionId = session.piSessionId
  if (!piSessionId) return []
  const directories = new Set<string>()
  // A folder's files may be under its path or, as `pi` and new Sessions file them, the folder it
  // resolves to.
  const addFolder = (folder: string) => {
    directories.add(piSessionDirectoryFor(folder))
    directories.add(piSessionDirectoryFor(physicalPath(folder)))
  }
  if (runDirectory) addFolder(runDirectory)
  if (session.piSessionFile) directories.add(dirname(session.piSessionFile))
  if (session.projectPath) addFolder(session.projectPath)
  const worktreePath = session.worktreePath?.trim()
  if (worktreePath) addFolder(worktreePath)
  const candidates = [...directories].flatMap((directory) =>
    piSessionFilesIn(directory, piSessionId),
  )
  // The newest file is the one the last run wrote; earlier ones are abandoned copies.
  return candidates.sort((left, right) => modifiedAt(right) - modifiedAt(left))
}

/**
 * Finds the Pi file a Session's transcript lives in when the recorded path does not exist.
 *
 * The recorded path is only a hint until the first run settles. Preparation records the file of
 * a manager it creates in the opened checkout, but Pi writes a file lazily, on the first assistant
 * message, and the first run opens its own manager in the run directory: for a worktree Session
 * that is a different Pi session directory, and Pi names the file by the time it was created. The
 * file the run writes is only recorded when the run's snapshot is persisted. A Host that stops
 * during that first run, or a run whose snapshot is not saved, leaves the Session pointing at a
 * file that was never written while its transcript sits in another file with the same Pi session
 * id. Starting a fresh manager then silently drops the whole conversation, so look for that file
 * first, with {@link findPiSessionFiles}.
 */
export function findExistingPiSessionFile(session: PiSessionFileLocation, runDirectory: string) {
  if (session.piSessionFile && existsSync(session.piSessionFile)) return session.piSessionFile
  return findPiSessionFiles(session, runDirectory)[0]
}

const sessionsWarnedForLostTranscript = new Set<string>()

/**
 * No file is expected before a Session's first assistant reply: Pi writes its file lazily, so a
 * first run aborted before replying leaves none. Once the Session holds an assistant reply, a
 * missing file means the transcript is gone and the run starts over without it. Logged once per
 * Session, because every Pi operation on it would repeat the search.
 */
function warnIfTranscriptLost(session: SessionDetail) {
  if (!session.messages.some((message) => message.role === 'assistant')) return
  const sessionId = String(session.id)
  if (sessionsWarnedForLostTranscript.has(sessionId)) return
  sessionsWarnedForLostTranscript.add(sessionId)
  logger.warn('Session Pi transcript file is missing; starting a new transcript', {
    sessionId,
    piSessionId: session.piSessionId,
    piSessionFile: session.piSessionFile,
  })
}

/**
 * Where a new Pi file for `session` goes when it runs in `runDirectory`. A Session in a managed
 * worktree keeps it where the project's Sessions are (ADR 0050): Pi's settings are read, and a
 * relative `sessionDir` resolved, from the project, not from the worktree, which OpenWaggle
 * removes with the Session and where `pi --resume` in the project would not look.
 */
function newPiSessionDirectory(session: SessionDetail, runDirectory: string) {
  const worktree = session.worktreePath?.trim()
  const project = session.projectPath?.trim()
  const inWorktree = worktree && project && resolve(worktree) === resolve(runDirectory)
  return resolvePiSessionDirectory(inWorktree ? project : runDirectory)
}

export function createSessionManagerForSession(session: SessionDetail, projectPath: string) {
  const existingFile = findExistingPiSessionFile(session, projectPath)
  if (existingFile) return openSessionManager(session, existingFile, projectPath)

  warnIfTranscriptLost(session)
  // Headed and filed under the physical folder, as `pi` run there would be.
  const fresh = SessionManager.create(
    physicalPath(projectPath),
    newPiSessionDirectory(session, projectPath),
  )
  if (session.piSessionId) {
    fresh.newSession({ id: session.piSessionId })
  }
  return fresh
}

function openSessionManager(session: SessionDetail, file: string, projectPath: string) {
  const sessionManager = SessionManager.open(file, undefined, projectPath)
  resumeSelectedPosition(sessionManager, session)
  return sessionManager
}

/**
 * A session manager for reading the Session's Pi file without writing it: a manager that does
 * not persist, pointed at the file. Opening the file for a Run migrates an older format in place
 * and records the thinking level, which would change a discovered session's file, and what
 * `pi --resume` continues with, just because OpenWaggle showed it (ADR 0050). Pi writes nothing
 * for a manager that does not persist, and extensions still see the file, as `getSessionFile()`
 * and a fork's `previousSessionFile`. A missing file has nothing to protect, so it gets the same
 * fresh manager as a Run, which writes nothing until a reply.
 */
export async function createReadOnlySessionManagerForSession(
  session: SessionDetail,
  projectPath: string,
) {
  const file = findExistingPiSessionFile(session, projectPath)
  if (!file) return createSessionManagerForSession(session, projectPath)
  // Pi reads the file when the manager is pointed at it; with persistence off it writes nothing,
  // not even the migration of an older format.
  const sessionManager = SessionManager.inMemory(projectPath)
  sessionManager.setSessionFile(file)
  resumeSelectedPosition(sessionManager, session)
  return sessionManager
}
