import { formatDisplayPath } from './display-path'

/**
 * Abbreviate the OS home-directory prefix of a filesystem path to `~` for
 * display, so the meaningful tail of long paths (e.g. `~/.openwaggle/...`) stays
 * visible instead of being eaten by the home prefix and truncated.
 *
 * Display-only and heuristic: the renderer has no access to the real home
 * directory, so this matches the common macOS/Linux/Windows home roots and
 * leaves any other path unchanged (never fabricates or hides a non-home path).
 */
export function tildifyPath(path: string): string {
  const displayPath = formatDisplayPath(path, [])
  const unix = /^\/(?:Users|home)\/([^/]+)(\/.*)?$/.exec(displayPath)
  if (unix) {
    const [, name, tail] = unix
    // /Users/Shared is a macOS system folder, not a home directory.
    return name === 'Shared' ? displayPath : `~${tail ?? ''}`
  }
  const win = /^[A-Za-z]:\\Users\\([^\\]+)(\\.*)?$/.exec(displayPath)
  if (win) {
    const [, name, tail] = win
    // Well-known Windows non-home entries under C:\Users.
    const winSystem = new Set(['Public', 'Default', 'Default User', 'All Users'])
    return winSystem.has(name ?? '') ? displayPath : `~${tail ?? ''}`
  }
  return displayPath
}
