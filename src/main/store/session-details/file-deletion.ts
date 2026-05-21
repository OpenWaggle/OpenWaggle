import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { createLogger } from '../../logger'
import { STAGED_SESSION_DELETE_SUFFIX } from './constants'
import { describeError, hasNodeErrorCode } from './errors'
import type { StagedSessionFileDeletion } from './types'

const logger = createLogger('session-details')

function noopAsync(): Promise<void> {
  return Promise.resolve()
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
