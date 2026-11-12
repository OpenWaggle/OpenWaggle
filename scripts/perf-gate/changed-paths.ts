/**
 * Which files a pull request changes decides whether the Performance Gate times it: a change to
 * nothing but the documentation, the website or the agent instructions cannot change how the
 * built app starts or how much memory it uses. Anything else counts as shipped code, including a
 * path this list does not know, a deleted file and the gate itself, so the list can only skip
 * what it names. The website's docs feed the bundled documentation the app reads on use.
 */
const UNSHIPPED_DIRECTORIES = ['docs/', 'website/', '.agents/'] as const
const UNSHIPPED_ROOT_FILES: ReadonlySet<string> = new Set([
  'AGENTS.md',
  'CHANGELOG.md',
  'CONTEXT.md',
  'CONTRIBUTING.md',
  'DEPENDENCIES.md',
  'MEMORY.md',
  'README.md',
])

export function isShippedPath(file: string) {
  if (UNSHIPPED_ROOT_FILES.has(file)) return false
  return !UNSHIPPED_DIRECTORIES.some((directory) => file.startsWith(directory))
}

/** Whether the timing job runs, and why, for the files `git diff --name-only --no-renames` lists. */
export function timingDecision(files: readonly string[]) {
  const shipped = files.filter(isShippedPath)
  return shipped.length > 0
    ? {
        run: true,
        reason: `${String(shipped.length)} shipped file(s) changed, e.g. ${shipped[0] ?? ''}`,
      }
    : { run: false, reason: 'no shipped code changed' }
}
