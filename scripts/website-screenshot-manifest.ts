import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Every image under `website/public/screenshots/`, each produced by one capture of
 * `capture-website-screenshots.ts`. A screenshot the script cannot regenerate drifts from the
 * app; one the website does not use is dead weight (`screenshot-references.unit.test.ts`).
 */
export const WEBSITE_SCREENSHOTS = [
  'hive-sessions.png',
  'hive-next-actor.png',
  'session-summary.png',
  'session-summary-add-source.png',
  'session-resources-browser.png',
  'scheduled-tasks.png',
  'settings-worktrees.png',
  // Usage & Cost reads every Pi session file, so it runs before any capture starts a real Run.
  'usage-cost-page.png',
  'usage-cost-sidebar-button.png',
  'feature-coding-agent.png',
  'feature-git-workflow.png',
  'session-tree-panel.png',
  'feature-browser-preview.png',
  'right-panel-all-panels.png',
  'codemode-script-card.png',
  'context-compacted.png',
  'missing-worktree.png',
  'settings-skills.png',
  'settings-agents.png',
  'settings-permissions.png',
  'settings-shortcuts.png',
  'settings-waggle-mode.png',
  'waggle-conversation.png',
  'feature-waggle.png',
  'context-meter.png',
  'terminal-split-panes.png',
  'terminal-add-to-chat.png',
  'terminal-context-chip.png',
  'mcp-servers.png',
  'mcp-server-detail.png',
  'mcp-server-error.png',
  'browser-preview-device-toolbar.png',
  'browser-preview-annotation.png',
  'browser-preview-annotation-chip.png',
  'extensions-review.png',
  'extensions-settings-section.png',
  'extensions-surfaces.png',
  // First-session essentials (website-screenshot-essentials-captures.ts), captured last.
  'composer-new-session.png',
  'composer-plus-menu.png',
  'composer-thinking-menu.png',
  'composer-agent-access-menu.png',
  'settings-connections.png',
  'settings-api-key-providers.png',
  'settings-oauth-providers.png',
  'slash-command-menu.png',
  'command-palette.png',
  'approval-request.png',
  'queued-follow-ups.png',
  'sidebar-states.png',
  'tool-rows.png',
  'diff-review-comment.png',
  'commit-dialog.png',
  'worktree-first-send.png',
  'project-actions-panel.png',
  'project-action-add.png',
  'action-output-terminal.png',
  // A new jotter session, seeded after every other jotter capture so no earlier sidebar changes.
  'visualization-inline.png',
  'visualization-expanded.png',
  // Two more new jotter sessions, seeded after the first visualization's captures.
  'visualization-prototype.png',
  'visualization-choice.png',
  // A pi CLI session in jotter, written last: its sidebar row and its Pi file (which the Usage &
  // Cost page would read) change no earlier image.
  'pi-session-continue-prompt.png',
] as const

export type WebsiteScreenshot = (typeof WEBSITE_SCREENSHOTS)[number]

/** The captures `--only` names, without the extension: `--only hive-sessions,session-summary`. */
export function selectedScreenshots(argv: readonly string[]) {
  const flagIndex = argv.indexOf('--only')
  if (flagIndex < 0) return WEBSITE_SCREENSHOTS
  const names = (argv[flagIndex + 1] ?? '').split(',').filter((name) => name.length > 0)
  const selected = WEBSITE_SCREENSHOTS.filter((file) => names.includes(file.replace(/\.png$/, '')))
  const unknown = names.filter(
    (name) => !WEBSITE_SCREENSHOTS.some((file) => file === `${name}.png`),
  )
  if (unknown.length > 0 || selected.length === 0) {
    throw new Error(
      `Unknown screenshot for --only: ${unknown.join(', ') || '(none)'}. Known: ${WEBSITE_SCREENSHOTS.join(', ')}`,
    )
  }
  return selected
}

/**
 * Copies the captured images over the website's only after every selected capture produced its
 * file, so a run that fails partway leaves `website/public/screenshots/` as it was.
 */
export async function publishScreenshots(input: {
  readonly stagingDir: string
  readonly outputDir: string
  readonly screenshots: readonly WebsiteScreenshot[]
}) {
  const missing: string[] = []
  for (const file of input.screenshots) {
    await fs.access(path.join(input.stagingDir, file)).catch(() => missing.push(file))
  }
  if (missing.length > 0) {
    throw new Error(`Not publishing: no capture for ${missing.join(', ')}.`)
  }
  await fs.mkdir(input.outputDir, { recursive: true })
  for (const file of input.screenshots) {
    await fs.copyFile(path.join(input.stagingDir, file), path.join(input.outputDir, file))
  }
}
