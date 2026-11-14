import { statSync } from 'node:fs'
import { homedir } from 'node:os'

function pathKind(absolutePath: string) {
  try {
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) return 'directory' as const
    return 'file' as const
  } catch {
    return 'missing' as const
  }
}

/** A launch from a directory that was since deleted must still reach the desktop app. */
function workingDirectory() {
  try {
    return process.cwd()
  } catch {
    return homedir()
  }
}

export function nodeTopLevelCliEnvironment(isPackaged: boolean) {
  return {
    workingDirectory: workingDirectory(),
    homeDirectory: homedir(),
    pathKind,
    isPackaged,
  }
}
