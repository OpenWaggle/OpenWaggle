import { formatDisplayPath } from './display-path'
import { api } from './ipc'

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/u

/** The home directory the preload exposes; absent outside Electron and in most tests. */
function windowHomeDirectory() {
  if (!('getHomeDirectory' in api)) return null
  const home: unknown = api.getHomeDirectory()
  return typeof home === 'string' ? home : null
}

/** `path` from `home` as `~…`, or null when it is not inside it. Windows drives ignore case. */
function underHomeDirectory(path: string, home: string) {
  const root = home.replace(/[\\/]+$/u, '')
  if (root === '') return null
  const windows = WINDOWS_DRIVE_PATH.test(root)
  const head = path.slice(0, root.length)
  if (windows ? head.toLowerCase() !== root.toLowerCase() : head !== root) return null
  const tail = path.slice(root.length)
  if (tail === '') return '~'
  return tail.startsWith('/') || (windows && tail.startsWith('\\')) ? `~${tail}` : null
}

/**
 * Abbreviate the OS home-directory prefix of a filesystem path to `~` for
 * display, so the meaningful tail of long paths (e.g. `~/.openwaggle/...`) stays
 * visible instead of being eaten by the home prefix and truncated.
 *
 * Display-only. The home directory main passes to the window (`api.getHomeDirectory()`) is shortened
 * wherever it is; without it, this matches the common macOS/Linux/Windows home roots and
 * leaves any other path unchanged (never fabricates or hides a non-home path).
 */
export function tildifyPath(path: string, homeDirectory = windowHomeDirectory()): string {
  const displayPath = formatDisplayPath(path, [])
  const fromHome = homeDirectory === null ? null : underHomeDirectory(displayPath, homeDirectory)
  if (fromHome !== null) return fromHome
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
