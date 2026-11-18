import { homeDirectoryRoot } from '@shared/home-directory-argument'
import { formatDisplayPath } from './display-path'
import { api } from './ipc'

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:\//u
const WINDOWS_UNC_PATH = /^\/\/[^/]/u

/** The home directory the preload exposes; absent outside Electron and in most tests. */
function windowHomeDirectory() {
  if (!('getHomeDirectory' in api)) return null
  const home: unknown = api.getHomeDirectory()
  return typeof home === 'string' ? home : null
}

/** Forward slashes only, so `C:\Users\x` and `C:/Users/x` compare equal. */
function withForwardSlashes(path: string) {
  return path.replaceAll('\\', '/')
}

/** The home directory with forward slashes, or null when it is unknown or a filesystem root. */
function usableHomeRoot(home: string | null) {
  return home === null ? null : homeDirectoryRoot(home)
}

/**
 * `path` from `root` as `~…`, or null when it is not inside it. Separators are compared
 * normalised; Windows drive and UNC paths ignore case. The tail keeps the path's own separators.
 */
function underHomeDirectory(path: string, root: string) {
  const comparable = withForwardSlashes(path)
  const caseInsensitive = WINDOWS_DRIVE_PATH.test(`${root}/`) || WINDOWS_UNC_PATH.test(root)
  const head = comparable.slice(0, root.length)
  if (caseInsensitive ? head.toLowerCase() !== root.toLowerCase() : head !== root) return null
  const tail = path.slice(root.length)
  if (tail === '') return '~'
  return tail.startsWith('/') || tail.startsWith('\\') ? `~${tail}` : null
}

/** The common macOS/Linux/Windows home roots, used only when the real home is unknown. */
function guessedHomePath(displayPath: string) {
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

/**
 * Abbreviate the OS home-directory prefix of a filesystem path to `~` for
 * display, so the meaningful tail of long paths (e.g. `~/.openwaggle/...`) stays
 * visible instead of being eaten by the home prefix and truncated.
 *
 * Display-only. When main passed the home directory (`api.getHomeDirectory()`), only that
 * directory is shortened, wherever it is; another user's home stays as it is. Only without
 * it does this guess the common macOS/Linux/Windows home roots. A non-home path is never
 * changed.
 */
export function tildifyPath(path: string, homeDirectory = windowHomeDirectory()) {
  const displayPath = formatDisplayPath(path, [])
  const homeRoot = usableHomeRoot(homeDirectory)
  if (homeRoot === null) return guessedHomePath(displayPath)
  return underHomeDirectory(displayPath, homeRoot) ?? displayPath
}
