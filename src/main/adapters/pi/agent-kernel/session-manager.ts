import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail, SessionResumePosition } from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import { logger } from './constants'

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
  if (session.environmentMode !== 'worktree') return projectPath

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
 * from that other branch's context. See {@link SessionResumePosition} for the freshness rule.
 */
function resumeSelectedPosition(
  sessionManager: SessionManager,
  position: SessionResumePosition | undefined,
) {
  if (!position) return
  if (sessionManager.getEntries().length !== position.piEntryCount) return
  const nodeId = String(position.nodeId)
  if (sessionManager.getLeafId() === nodeId || !sessionManager.getEntry(nodeId)) return
  sessionManager.branch(nodeId)
}

function piSessionFilesIn(directory: string, piSessionId: string) {
  const suffix = `_${piSessionId}.jsonl`
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(suffix))
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

/** Pi's default session directory for a working directory, computed without creating it. */
export function piSessionDirectoryFor(cwd: string) {
  const safePath = `--${resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  return join(getAgentDir(), 'sessions', safePath)
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
 * first: in the run directory's Pi session directory, the recorded path's directory, and the
 * directories of the Session's checkout and worktree, in case the Session moved between them.
 */
export function findExistingPiSessionFile(
  session: Pick<SessionDetail, 'piSessionFile' | 'piSessionId' | 'projectPath' | 'worktreePath'>,
  runDirectory: string,
) {
  if (session.piSessionFile && existsSync(session.piSessionFile)) return session.piSessionFile
  const piSessionId = session.piSessionId
  if (!piSessionId) return undefined
  const directories = new Set([piSessionDirectoryFor(runDirectory)])
  if (session.piSessionFile) directories.add(dirname(session.piSessionFile))
  if (session.projectPath) directories.add(piSessionDirectoryFor(session.projectPath))
  const worktreePath = session.worktreePath?.trim()
  if (worktreePath) directories.add(piSessionDirectoryFor(worktreePath))
  const candidates = [...directories].flatMap((directory) =>
    piSessionFilesIn(directory, piSessionId),
  )
  // The newest file is the one the last run wrote; earlier ones are abandoned copies.
  return candidates.sort((left, right) => modifiedAt(right) - modifiedAt(left))[0]
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
  const fresh = SessionManager.create(projectPath)
  if (session.piSessionId) {
    fresh.newSession({ id: session.piSessionId })
  }
  return fresh
}

function openSessionManager(session: SessionDetail, file: string, projectPath: string) {
  const sessionManager = SessionManager.open(file, undefined, projectPath)
  resumeSelectedPosition(sessionManager, session.resumePosition)
  return sessionManager
}
