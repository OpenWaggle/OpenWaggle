import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import type { SessionId } from '@shared/types/brand'
import { createLogger } from '../../logger'
import { STAGED_SESSION_DELETE_SUFFIX } from './constants'
import { describeError, hasNodeErrorCode } from './errors'
import type { StagedSessionFileDeletion } from './types'

const logger = createLogger('session-details')

function noopAsync(): Promise<void> {
  return Promise.resolve()
}

/** Commit has succeeded. Nothing here may restore files or report a rejected deletion. */
export async function completeSessionDeletion(
  sessionId: SessionId,
  stagedFile: StagedSessionFileDeletion,
  onCommitted?: () => void,
): Promise<void> {
  try {
    onCommitted?.()
  } catch (error) {
    logger.warn('Failed runtime cleanup after session deletion', {
      sessionId,
      error: describeError(error),
    })
  }
  try {
    await stagedFile.cleanup()
  } catch (error) {
    logger.warn('Failed staged Pi session file cleanup after session deletion', {
      sessionId,
      error: describeError(error),
    })
  }
}

export async function stageSessionFileDeletion(
  filePath: string | null,
): Promise<StagedSessionFileDeletion> {
  if (!filePath) {
    return { cleanup: noopAsync, restore: noopAsync }
  }

  const stagedPath = `${filePath}.${randomUUID()}.${STAGED_SESSION_DELETE_SUFFIX}`
  try {
    await rename(filePath, stagedPath)
  } catch (error) {
    if (hasNodeErrorCode(error, 'ENOENT')) {
      return { cleanup: noopAsync, restore: noopAsync }
    }
    throw error
  }

  return {
    cleanup: () => rm(stagedPath, { force: true }),
    restore: async () => {
      try {
        await rename(stagedPath, filePath)
      } catch (error) {
        if (hasNodeErrorCode(error, 'ENOENT')) {
          return
        }
        logger.warn('Failed to restore staged Pi session file after delete failure', {
          path: filePath,
          stagedPath,
          error: describeError(error),
        })
      }
    },
  }
}
