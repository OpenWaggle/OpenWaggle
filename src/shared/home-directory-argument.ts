/**
 * The window's renderer has no access to the user's home directory, which display paths shorten
 * to `~`. The main process passes its `os.homedir()` as a renderer argument, and the preload
 * exposes it as `window.api.getHomeDirectory()`, the way the error-report switch reaches the preload.
 */
const HOME_DIRECTORY_RENDERER_SWITCH = '--openwaggle-home-directory='

const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:$/u
/** `//server` with forward slashes. A `//server/share` can be a home: per-user home shares exist. */
const UNC_SERVER_ROOT = /^\/\/[^/]+$/u

/**
 * `home` with forward slashes and no trailing separators, or null when that leaves a filesystem
 * root (`/`, `C:\`, `\\server`) or nothing: shortening a root would turn every path on it
 * into `~`.
 */
export function homeDirectoryRoot(home: string) {
  const root = home.replaceAll('\\', '/').replace(/\/+$/u, '')
  if (root === '' || WINDOWS_DRIVE_ROOT.test(root) || UNC_SERVER_ROOT.test(root)) return null
  return root
}

/** The renderer argument for `home`; none for an empty home or a filesystem root. */
export function homeDirectoryRendererArguments(home: string) {
  return homeDirectoryRoot(home) === null ? [] : [`${HOME_DIRECTORY_RENDERER_SWITCH}${home}`]
}

/** The home directory main passed in a renderer's `process.argv`, or null. */
export function homeDirectoryFromRendererArguments(argv: readonly string[]) {
  const argument = argv.find((entry) => entry.startsWith(HOME_DIRECTORY_RENDERER_SWITCH))
  const home = argument?.slice(HOME_DIRECTORY_RENDERER_SWITCH.length) ?? ''
  return home === '' ? null : home
}
