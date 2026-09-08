import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const SESSION_TITLE = 'Session Summary staged-only commit'

function git(projectPath: string, args: readonly string[]) {
  return execFileSync('git', [...args], { cwd: projectPath, encoding: 'utf8' })
}

async function createPartiallyStagedProject(projectPath: string) {
  await fs.mkdir(projectPath, { recursive: true })
  const readmePath = path.join(projectPath, 'README.md')
  await fs.writeFile(readmePath, '# Base\n')
  git(projectPath, ['init', '-b', 'main'])
  git(projectPath, ['config', 'user.name', 'OpenWaggle E2E'])
  git(projectPath, ['config', 'user.email', 'e2e@openwaggle.dev'])
  git(projectPath, ['config', 'commit.gpgsign', 'false'])
  git(projectPath, ['add', 'README.md'])
  git(projectPath, ['commit', '-m', 'Seed project'])
  git(projectPath, ['checkout', '-b', 'feature/staged-only'])
  await fs.writeFile(readmePath, '# Base\nstaged line\n')
  git(projectPath, ['add', 'README.md'])
  await fs.writeFile(readmePath, '# Base\nstaged line\nunstaged line\n')
}

test('Session Summary commit command preserves unstaged hunks when they are excluded', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-commit-command-')
  const projectPath = path.join(app.userDataDir, 'partially-staged-project')
  try {
    await createPartiallyStagedProject(projectPath)
    const now = Date.now()
    await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: now,
      messages: [
        {
          id: 'commit-command-user',
          role: 'user',
          parts: [{ type: 'text', text: 'Commit only what I staged.' }],
          createdAt: now,
        },
      ],
    })
    await app.restart()
    await app.resizeMainWindow(1_400, 850)
    const page = app.window()
    await app.mainWindow().openThread(SESSION_TITLE)

    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    if ((await summary.count()) === 0) {
      await page.getByRole('button', { name: 'Open Session Summary' }).click()
    }
    await expect(summary).toBeVisible()
    const openCommand = summary.getByRole('button', { name: 'Commit or push' })
    await expect(openCommand).toBeEnabled({ timeout: 30_000 })
    await openCommand.click()
    const dialog = page.getByRole('dialog', { name: 'Commit or push' })
    await expect(dialog.getByText('1 staged file')).toBeVisible()
    await expect(dialog.getByText('1 unstaged file')).toBeVisible()
    await dialog.getByLabel('Commit target').selectOption('current')
    await dialog.getByLabel('Commit message').fill('Commit staged content')
    await dialog.getByRole('checkbox', { name: 'Include unstaged changes' }).uncheck()
    await app.captureEvidence('session-summary-commit-command-open')
    await dialog.getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 30_000 })

    expect(git(projectPath, ['show', 'HEAD:README.md'])).toBe('# Base\nstaged line\n')
    expect(await fs.readFile(path.join(projectPath, 'README.md'), 'utf8')).toBe(
      '# Base\nstaged line\nunstaged line\n',
    )
    expect(git(projectPath, ['diff', '--', 'README.md'])).toContain('+unstaged line')
    await app.captureEvidence('session-summary-commit-command-staged-only')
  } finally {
    await app.cleanup()
  }
})
