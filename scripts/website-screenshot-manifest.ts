/**
 * Every image under `website/public/screenshots/`, each produced by one capture of
 * `capture-website-screenshots.ts`. A screenshot the script cannot regenerate drifts from the
 * app; one the website does not use is dead weight (`screenshot-references.test.ts`).
 */
export const WEBSITE_SCREENSHOTS = [
  'hive-sessions.png',
  'hive-next-actor.png',
  'session-summary.png',
  'session-resources.png',
  'scheduled-tasks.png',
  'settings-worktrees.png',
  'feature-coding-agent.png',
  'feature-git-workflow.png',
  'session-tree-panel.png',
  'feature-browser-preview.png',
] as const

export type WebsiteScreenshot = (typeof WEBSITE_SCREENSHOTS)[number]

/** The captures `--only` names, without the extension: `--only hive-sessions,session-summary`. */
export function selectedScreenshots(argv: readonly string[]): readonly WebsiteScreenshot[] {
  const flagIndex = argv.indexOf('--only')
  if (flagIndex < 0) return WEBSITE_SCREENSHOTS
  const names = (argv[flagIndex + 1] ?? '').split(',').filter((name) => name.length > 0)
  const selected = WEBSITE_SCREENSHOTS.filter((file) => names.includes(file.replace(/\.png$/, '')))
  const unknown = names.filter((name) => !WEBSITE_SCREENSHOTS.some((file) => file === `${name}.png`))
  if (unknown.length > 0 || selected.length === 0) {
    throw new Error(
      `Unknown screenshot for --only: ${unknown.join(', ') || '(none)'}. Known: ${WEBSITE_SCREENSHOTS.join(', ')}`,
    )
  }
  return selected
}
