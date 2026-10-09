import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { SessionDetail } from '@shared/types/session'
import { resolvePiSessionDirectory } from '../pi-session-directory'

/** `2026-10-09T10-41-32-337Z` at the start of a Pi file name, before `_<id>.jsonl`. */
const FILE_NAME_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?=_)/
/** Its time of day, with the `:` and `.` a file name cannot hold as `-`. */
const FILE_NAME_TIME = /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/

/** The ISO timestamp Pi named a file after, as its header records it. */
function fileNameTimestamp(name: string) {
  return FILE_NAME_TIMESTAMP.exec(name)?.[0].replace(FILE_NAME_TIME, 'T$1:$2:$3.$4Z')
}

/**
 * Starts the file named for a new Session when it was created, which Pi had not written yet: the
 * first Run writes that same file, so the recorded name and folder stay as they are, and a file
 * that was never written is not taken for one deleted since. Only a file named for the Session's
 * own Pi session id is started; a header is all it holds until the first message.
 */
export function startRecordedPiSessionFile(session: SessionDetail, cwd: string) {
  const file = session.piSessionFile?.trim()
  const id = session.piSessionId
  if (!file || !id || existsSync(file)) return undefined
  if (!basename(file).endsWith(`_${id}.jsonl`)) return undefined
  const header = SessionManager.inMemory(cwd, { id }).getHeader()
  if (!header) return undefined
  const timestamp = fileNameTimestamp(basename(file))
  try {
    mkdirSync(dirname(file), { recursive: true })
    // `wx`: never over a file another writer created meanwhile.
    writeFileSync(file, `${JSON.stringify({ ...header, ...(timestamp ? { timestamp } : {}) })}\n`, {
      flag: 'wx',
    })
  } catch {
    return existsSync(file) ? file : undefined
  }
  return file
}

/**
 * Where a new Pi file for `session` goes when it runs in `runDirectory`. A Session in a managed
 * worktree keeps it where the project's Sessions are (ADR 0051): Pi's settings are read, and a
 * relative `sessionDir` resolved, from the project, not from the worktree, which OpenWaggle
 * removes with the Session and where `pi --resume` in the project would not look.
 */
export function newPiSessionDirectory(session: SessionDetail, runDirectory: string) {
  const worktree = session.worktreePath?.trim()
  const project = session.projectPath?.trim()
  // A worktree Session's first send creates its worktree, so the Session the Run gets may not
  // name it yet: worktree mode alone says the Run is in one.
  const inWorktree =
    project &&
    (session.environmentMode === 'worktree' ||
      (worktree !== undefined && worktree !== '' && resolve(worktree) === resolve(runDirectory)))
  return resolvePiSessionDirectory(inWorktree ? project : runDirectory)
}
