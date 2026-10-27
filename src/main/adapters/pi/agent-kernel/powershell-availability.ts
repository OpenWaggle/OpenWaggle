import { accessSync, constants } from 'node:fs'
import path from 'node:path'

const POWERSHELL_EXECUTABLE = 'pwsh'

let cached: { readonly searchPath: string; readonly found: boolean } | undefined

function isExecutable(filePath: string) {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function pwshOnPath(searchPath: string) {
  return searchPath
    .split(path.delimiter)
    .filter((directory) => directory.length > 0)
    .some((directory) => isExecutable(path.join(directory, POWERSHELL_EXECUTABLE)))
}

/**
 * Whether a Run offers Pi's `powershell` tool. Windows always has PowerShell; elsewhere the tool is
 * only declared when `pwsh` is on the PATH tools run with, so a macOS or Linux model is not handed
 * a tool, and a "bash or PowerShell" rule, it cannot use. The lookup is cached per PATH value.
 */
export function offersPowerShellTool(
  platform: NodeJS.Platform,
  searchPath: string | undefined,
): boolean {
  if (platform === 'win32') return true
  if (!searchPath) return false
  if (cached?.searchPath !== searchPath) {
    cached = { searchPath, found: pwshOnPath(searchPath) }
  }
  return cached.found
}
