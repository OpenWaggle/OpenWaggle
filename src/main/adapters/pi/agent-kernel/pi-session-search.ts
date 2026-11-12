import { readdirSync } from 'node:fs'
import type { SessionDetail } from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import { piSessionSearchDirectories, resolveSessionWorkingPath } from './session-manager'

/** Where a Run of `session` would run; undefined when there is none, as once its worktree is gone. */
export function runDirectoryOf(session: SessionDetail) {
  try {
    return resolveSessionWorkingPath(session)
  } catch {
    return undefined
  }
}

function isUnsearchable(folder: string) {
  try {
    readdirSync(folder)
    return false
  } catch (error) {
    return isRecord(error) && (error.code === 'EACCES' || error.code === 'EPERM')
  }
}

/**
 * A folder the Session's Pi files are looked for in that may not be read, so it may hold a copy
 * of a deleted file: which file a Run would continue is then unknown.
 */
export function unsearchablePiSessionFolder(
  session: SessionDetail,
  runDirectory = runDirectoryOf(session),
) {
  return piSessionSearchDirectories(session, runDirectory).find(isUnsearchable)
}
