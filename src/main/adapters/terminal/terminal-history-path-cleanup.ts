import path from 'node:path'
import type { TerminalKey } from '@shared/types/terminal'
import type { TerminalHistoryFiles } from './terminal-history-files'

function isPathWithin(candidatePath: string, directoryPath: string) {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(candidatePath))
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

export async function removeTerminalHistoryForPath(
  files: TerminalHistoryFiles,
  directoryPath: string,
  onRemove: (key: TerminalKey) => void,
) {
  await files.ensureDirectory()
  const entries = await files.listWorkingDirectories()
  for (const entry of entries) {
    if (!isPathWithin(entry.cwd, directoryPath)) continue
    onRemove(entry.key)
    await files.remove([
      entry.files.logFile,
      entry.files.metadataFile,
      entry.files.workingDirectoryFile,
    ])
  }
}
