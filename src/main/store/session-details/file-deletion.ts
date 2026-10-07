import { rename, rm } from 'node:fs/promises'
import { hasNodeErrorCode } from './errors'

export async function completeJournaledSessionFileDeletion(
  filePath: string | null,
  stagedPath: string | null,
): Promise<void> {
  if (!filePath || !stagedPath) return
  try {
    await rename(filePath, stagedPath)
  } catch (error) {
    if (!hasNodeErrorCode(error, 'ENOENT')) throw error
  }
  await rm(stagedPath, { force: true })
}

/** Removes files outright; files already gone are not an error, so a retry can repeat it. */
export async function removeSessionFiles(filePaths: readonly string[]): Promise<void> {
  for (const filePath of filePaths) {
    await rm(filePath, { force: true })
  }
}
