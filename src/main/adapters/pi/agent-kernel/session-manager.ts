import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path, { basename, dirname, join, resolve } from 'node:path'
import { getAgentDir, parseSessionEntries, SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail } from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import { resolvePiSessionDirectory } from '../pi-session-directory'
import { logger } from './constants'
import { piEntryNodeIds } from './pi-entry-node-ids'

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

function isInsideProject(candidate: string, projectPath: string) {
  const relative = path.relative(path.resolve(projectPath), path.resolve(candidate))
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

/**
 * Where a local-mode Session's agent works: the opened checkout, or, for a Pi session discovered
 * from the `pi` CLI, the folder inside it the CLI ran in, so it continues there as
 * `pi --resume` would (ADR 0050). A folder that is gone or outside the project falls back to the
 * checkout.
 */
export function resolveLocalWorkingPath(session: SessionDetail, projectPath: string) {
  const cwd = session.piSessionCwd
  if (!cwd || !isInsideProject(cwd, projectPath) || !existsSync(cwd)) return projectPath
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
  if (sessionManager.getEntries().length !== position.piEntryCount) return
  const entryId = piEntryNodeIds(session).toEntryId(String(position.nodeId))
  if (sessionManager.getLeafId() === entryId || !sessionManager.getEntry(entryId)) return
  sessionManager.branch(entryId)
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
  if (runDirectory) directories.add(piSessionDirectoryFor(runDirectory))
  if (session.piSessionFile) directories.add(dirname(session.piSessionFile))
  if (session.projectPath) directories.add(piSessionDirectoryFor(session.projectPath))
  const worktreePath = session.worktreePath?.trim()
  if (worktreePath) directories.add(piSessionDirectoryFor(worktreePath))
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

export function createSessionManagerForSession(session: SessionDetail, projectPath: string) {
  const existingFile = findExistingPiSessionFile(session, projectPath)
  if (existingFile) return openSessionManager(session, existingFile, projectPath)

  warnIfTranscriptLost(session)
  const fresh = SessionManager.create(projectPath, resolvePiSessionDirectory(projectPath))
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
 * A session manager for reading the Session's Pi file without writing it: an in-memory copy of
 * the file's entries. Opening the file for a Run migrates an older format in place and records
 * the thinking level, which would change a discovered session's file, and what `pi --resume`
 * continues with, just because OpenWaggle showed it (ADR 0050). A missing file has nothing to
 * protect, so it gets the same fresh manager as a Run, which writes nothing until a reply.
 */
export async function createReadOnlySessionManagerForSession(
  session: SessionDetail,
  projectPath: string,
) {
  const file = findExistingPiSessionFile(session, projectPath)
  if (!file) return createSessionManagerForSession(session, projectPath)
  const entries = parseSessionEntries(await readFile(file, 'utf8'))
  const sessionManager = SessionManager.inMemory(projectPath, undefined, entries)
  resumeSelectedPosition(sessionManager, session)
  return sessionManager
}
