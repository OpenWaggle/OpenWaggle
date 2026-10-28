import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { CliPathKind, TopLevelCliEnvironment } from './top-level-cli-route'

function pathKind(absolutePath: string): CliPathKind {
  try {
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) return 'directory'
    return 'file'
  } catch {
    return 'missing'
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

export function nodeTopLevelCliEnvironment(isPackaged: boolean): TopLevelCliEnvironment {
  return {
    workingDirectory: workingDirectory(),
    homeDirectory: homedir(),
    pathKind,
    isPackaged,
  }
}
