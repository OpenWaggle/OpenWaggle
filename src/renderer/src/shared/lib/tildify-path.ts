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
  const unix = /^\/(?:Users|home)\/[^/]+(\/.*)?$/.exec(path)
  if (unix) return `~${unix[1] ?? ''}`
  const win = /^[A-Za-z]:\\Users\\[^\\]+(\\.*)?$/.exec(path)
  if (win) return `~${win[1] ?? ''}`
  return path
}
