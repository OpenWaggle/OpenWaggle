/**
 * The window's renderer has no access to the user's home directory, which display paths shorten
 * to `~`. The main process passes its `os.homedir()` as a renderer argument, and the preload
 * exposes it as `window.api.getHomeDirectory()`, the way the error-report switch reaches the preload.
 */
const HOME_DIRECTORY_RENDERER_SWITCH = '--openwaggle-home-directory='

/** The renderer argument for `home`; none for an empty home or the filesystem root. */
export function homeDirectoryRendererArguments(home: string): readonly string[] {
  return home.replace(/[\\/]+$/u, '') === '' ? [] : [`${HOME_DIRECTORY_RENDERER_SWITCH}${home}`]
}

/** The home directory main passed in a renderer's `process.argv`, or null. */
export function homeDirectoryFromRendererArguments(argv: readonly string[]): string | null {
  const argument = argv.find((entry) => entry.startsWith(HOME_DIRECTORY_RENDERER_SWITCH))
  const home = argument?.slice(HOME_DIRECTORY_RENDERER_SWITCH.length) ?? ''
  return home === '' ? null : home
}
