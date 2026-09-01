import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSessionResources, seedSingleSession } from './support/session-fixtures'

const EMPTY_TITLE = 'Session Summary empty session'
const ALPHA_TITLE = 'Session Summary alpha'
const BETA_TITLE = 'Session Summary beta'
const ALPHA_USER_MESSAGE_ID = 'summary-alpha-user'
const ALPHA_AGENT_MESSAGE_ID = 'summary-alpha-agent'
const BETA_USER_MESSAGE_ID = 'summary-beta-user'
const GITHUB_CHANGE_REQUEST_TITLE = 'Session Summary GitHub change request'
const GITLAB_CHANGE_REQUEST_TITLE = 'Session Summary GitLab change request'

function message(id: string, role: 'user' | 'assistant', text: string, createdAt: number) {
  return { id, role, parts: [{ type: 'text', text }], createdAt }
}

async function pngData() {
  const fixture = await fs.readFile(
    path.join(process.cwd(), 'e2e/visual-regression.e2e.test.ts-snapshots/composer-darwin.png'),
  )
  return fixture.toString('base64')
}

async function createGitProject(projectPath: string, provider?: 'github' | 'gitlab') {
  await fs.mkdir(projectPath, { recursive: true })
  await fs.writeFile(path.join(projectPath, 'README.md'), '# Session Summary E2E\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'OpenWaggle E2E'], {
    cwd: projectPath,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.email', 'e2e@openwaggle.dev'], {
    cwd: projectPath,
    stdio: 'ignore',
  })
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['commit', '--no-gpg-sign', '-m', 'Seed Session Summary fixture'], {
    cwd: projectPath,
    stdio: 'ignore',
  })
  if (provider) {
    const remotePath = `${projectPath}-remote.git`
    await fs.mkdir(remotePath, { recursive: true })
    execFileSync('git', ['init', '--bare'], { cwd: remotePath, stdio: 'ignore' })
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], {
      cwd: remotePath,
      stdio: 'ignore',
    })
    execFileSync('git', ['remote', 'add', 'origin', remotePath], {
      cwd: projectPath,
      stdio: 'ignore',
    })
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: projectPath, stdio: 'ignore' })
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
      cwd: projectPath,
      stdio: 'ignore',
    })
    execFileSync(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
      { cwd: projectPath, stdio: 'ignore' },
    )
    execFileSync(
      'git',
      ['remote', 'set-url', 'origin', `https://${provider}.com/openwaggle/e2e.git`],
      { cwd: projectPath, stdio: 'ignore' },
    )
    // Provider detection sees the canonical hosted URL; pushes stay entirely local.
    execFileSync('git', ['remote', 'set-url', '--push', 'origin', remotePath], {
      cwd: projectPath,
      stdio: 'ignore',
    })
  }
  await fs.appendFile(path.join(projectPath, 'README.md'), '\nUncommitted change\n')
}

async function createFakeSourceControlCliBin() {
  const binPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-source-control-cli-'))
  if (process.platform === 'win32') {
    await createWindowsSourceControlCliFixtures(binPath)
    return binPath
  }

  const gh = `#!/bin/sh
if [ "$1" = "auth" ]; then echo "Logged in to github.com account openwaggle-e2e"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/openwaggle/e2e/pull/42"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi
echo "no pull requests found" >&2
exit 1
`
  const glab = `#!/bin/sh
if [ "$1" = "auth" ]; then echo "Logged in to gitlab.com as openwaggle-e2e"; exit 0; fi
if [ "$1" = "mr" ] && [ "$2" = "create" ]; then echo "https://gitlab.com/openwaggle/e2e/-/merge_requests/42"; exit 0; fi
if [ "$1" = "mr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi
echo "no merge request found" >&2
exit 1
`
  await Promise.all([
    fs.writeFile(path.join(binPath, 'gh'), gh, { mode: 0o755 }),
    fs.writeFile(path.join(binPath, 'glab'), glab, { mode: 0o755 }),
  ])
  return binPath
}

async function createWindowsSourceControlCliFixtures(binPath: string) {
  const sourcePath = path.join(binPath, 'source-control-fixture.cs')
  const executablePath = path.join(binPath, 'source-control-fixture.exe')
  const source = `
using System;
using System.IO;
using System.Reflection;

public static class Program {
  public static int Main(string[] args) {
    var command = Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location);
    if (args.Length > 0 && args[0] == "auth") {
      Console.WriteLine(command == "gh" ? "Logged in to github.com account openwaggle-e2e" : "Logged in to gitlab.com as openwaggle-e2e");
      return 0;
    }
    if (command == "gh" && args.Length > 1 && args[0] == "pr" && args[1] == "create") {
      Console.WriteLine("https://github.com/openwaggle/e2e/pull/42");
      return 0;
    }
    if (command == "glab" && args.Length > 1 && args[0] == "mr" && args[1] == "create") {
      Console.WriteLine("https://gitlab.com/openwaggle/e2e/-/merge_requests/42");
      return 0;
    }
    if (args.Length > 1 && (args[1] == "list")) {
      Console.WriteLine("[]");
      return 0;
    }
    Console.Error.WriteLine(command == "gh" ? "no pull requests found" : "no merge request found");
    return 1;
  }
}
`
  await fs.writeFile(sourcePath, source)
  const quotePowerShellPath = (value: string) => `'${value.replaceAll("'", "''")}'`
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -Path ${quotePowerShellPath(sourcePath)} -OutputAssembly ${quotePowerShellPath(executablePath)} -OutputType ConsoleApplication`,
    ],
    { stdio: 'ignore' },
  )
  await Promise.all([
    fs.copyFile(executablePath, path.join(binPath, 'gh.exe')),
    fs.copyFile(executablePath, path.join(binPath, 'glab.exe')),
  ])
}

test('Session Summary follows first-message, dock, and sidebar behavior', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-lifecycle-')
  const projectPath = path.join(app.userDataDir, 'github-project')
  try {
    await createGitProject(projectPath)
    await seedSingleSession(app.userDataDir, {
      title: EMPTY_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [],
    })
    await seedSingleSession(app.userDataDir, {
      title: ALPHA_TITLE,
      projectPath,
      updatedAt: Date.now() - 1,
      messages: [message(ALPHA_USER_MESSAGE_ID, 'user', 'Start the populated session.', Date.now())],
    })
    await app.restart()
    await app.resizeMainWindow(1_400, 800)

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    const setupDock = page.locator('fieldset[aria-label="Session setup"]')
    await mainWindow.openThread(EMPTY_TITLE)
    await expect(page.getByRole('complementary', { name: 'Session Summary' })).toHaveCount(0)
    await expect(setupDock).toHaveAttribute('aria-hidden', 'false')

    await mainWindow.openThread(ALPHA_TITLE)
    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    await expect(summary).toBeVisible()
    await expect(
      page.locator('header').getByRole('button', { name: 'Session Summary', exact: true }),
    ).toBeVisible()
    await expect(setupDock).toHaveAttribute('aria-hidden', 'true')
    await expect(summary.getByText('main')).toBeVisible({ timeout: 30_000 })
    await expect(summary.getByRole('button', { name: /Changes/ })).toContainText('+2')
    const transcript = page.getByRole('log', { name: 'Chat messages' })
    const expandedTranscriptWidth = await transcript.evaluate(
      (element) => element.getBoundingClientRect().width,
    )

    await page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
      .click()
    await expect(summary).toHaveCount(0)
    const collapsedTranscriptWidth = await transcript.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    expect(Math.abs(expandedTranscriptWidth - collapsedTranscriptWidth)).toBeLessThan(1)
    await page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
      .click()
    await expect(summary).toBeVisible()

    await summary.getByRole('button', { name: 'Collapse Session Summary' }).click()
    const focusedSummaryToggle = page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
    await expect(focusedSummaryToggle).toBeFocused()
    await focusedSummaryToggle.click()
    await expect(summary).toBeVisible()

    const changesAction = summary.getByRole('button', { name: /Changes/ })
    await changesAction.focus()
    await changesAction.press('Enter')
    await expect(summary).toHaveCount(0)
    const suppressedSummaryToggle = page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
    await expect
      .poll(() =>
        page.evaluate(() => {
          const activeElement = document.activeElement
          const summaryToggle = document.querySelector(
            '[data-qa="header-actions"] button[aria-label$="Session Summary"]',
          )
          const rightSidebar = document.querySelector(
            '[data-right-sidebar-shell="true"]',
          )

          return Boolean(
            activeElement &&
              activeElement !== document.body &&
              (activeElement === summaryToggle ||
                rightSidebar?.contains(activeElement)),
          )
        }),
      )
      .toBe(true)
    await suppressedSummaryToggle.click()
    await page.getByRole('button', { name: 'Close diff sidebar' }).click()
    await expect(summary).toHaveCount(0)
    await expect
      .poll(() =>
        page
          .locator('[data-chat-panel-main="true"]')
          .evaluate((element) => element.clientWidth),
      )
      .toBeGreaterThanOrEqual(840)
    await page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
      .click()
    await expect(summary).toBeVisible()

    await summary.getByRole('button', { name: 'Collapse Session Summary' }).focus()
    await app.resizeMainWindow(720, 700)
    await expect(summary).toHaveCount(0)
    await expect(
      page.locator('header').getByRole('button', { name: 'Session Summary', exact: true }),
    ).toBeFocused()
    const narrowTranscriptWidth = await transcript.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    await page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
      .click()
    await expect(summary).toBeVisible()
    const narrowOverlayTranscriptWidth = await transcript.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    expect(Math.abs(narrowTranscriptWidth - narrowOverlayTranscriptWidth)).toBeLessThan(1)

    await summary.getByRole('button', { name: /Changes/ }).click()
    await expect(summary).toHaveCount(0)
    await page.getByRole('button', { name: 'Close diff sidebar' }).click()
    await expect(summary).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('session resources stay scoped while inline images and the gallery navigate', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-resources-')
  try {
    const now = Date.now()
    const rasterData = await pngData()
    const alphaId = await seedSingleSession(app.userDataDir, {
      title: ALPHA_TITLE,
      updatedAt: now,
      messages: [
        message(ALPHA_USER_MESSAGE_ID, 'user', 'Here is the source image.', now - 2),
        message(ALPHA_AGENT_MESSAGE_ID, 'assistant', 'Here is the generated image.', now - 1),
      ],
    })
    const betaId = await seedSingleSession(app.userDataDir, {
      title: BETA_TITLE,
      updatedAt: now - 10,
      messages: [message(BETA_USER_MESSAGE_ID, 'user', 'Beta image only.', now - 10)],
    })
    await seedSessionResources(app.userDataDir, alphaId, [
      {
        id: 'alpha-user-image',
        kind: 'image',
        title: 'user-reference.png',
        mimeType: 'image/png',
        dataBase64: rasterData,
        nodeId: ALPHA_USER_MESSAGE_ID,
        actor: 'user',
        activity: 'provided',
        updatedAt: now - 2,
      },
      {
        id: 'alpha-agent-image',
        kind: 'image',
        title: 'agent-output.png',
        mimeType: 'image/png',
        dataBase64: rasterData,
        nodeId: ALPHA_AGENT_MESSAGE_ID,
        actor: 'agent',
        activity: 'created',
        updatedAt: now - 1,
      },
      {
        id: 'alpha-docs',
        kind: 'link',
        title: 'Alpha documentation',
        url: 'https://example.com/alpha',
        nodeId: ALPHA_AGENT_MESSAGE_ID,
        actor: 'agent',
        activity: 'read',
        updatedAt: now - 2,
      },
    ])
    await seedSessionResources(app.userDataDir, betaId, [
      {
        id: 'beta-user-image',
        kind: 'image',
        title: 'beta-only.png',
        mimeType: 'image/png',
        dataBase64: rasterData,
        nodeId: BETA_USER_MESSAGE_ID,
        actor: 'user',
        activity: 'provided',
        updatedAt: now - 10,
      },
    ])
    await app.restart()
    await app.resizeMainWindow(1_400, 800)

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(ALPHA_TITLE)
    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    const inlineUserImage = page.getByRole('button', { name: 'Open image user-reference.png' })
    await expect(inlineUserImage).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open image agent-output.png' })).toBeVisible()

    await expect(summary).toBeVisible()
    await page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
      .click()
    await expect(summary).toHaveCount(0)
    await inlineUserImage.click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page
      .locator('header')
      .getByRole('button', { name: 'Session Summary', exact: true })
      .click()
    await summary.getByRole('button', { name: /Sources/ }).click()
    await summary.getByText('user-reference.png').click()

    const viewer = page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('1 of 2')
    await viewer.getByLabel('Image zoom').selectOption('150')
    await expect(viewer.getByLabel('Image zoom')).toHaveValue('150')
    const imageCanvas = viewer.getByLabel('Image canvas')
    const scrollReachability = await imageCanvas.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
      element.scrollTop = element.scrollHeight
      return {
        reachesRightEdge:
          Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth)) <= 1,
        reachesBottomEdge:
          Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight)) <= 1,
      }
    })
    expect(scrollReachability).toEqual({
      reachesRightEdge: true,
      reachesBottomEdge: true,
    })
    await viewer.getByRole('button', { name: 'Next image' }).click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: agent-output.png' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toBeVisible()
    await page.getByRole('button', { name: 'Close image viewer' }).click()
    await summary.getByText('Show all').click()

    const resources = page.getByRole('region', { name: 'Session resources' })
    await expect(resources).toBeVisible()
    await expect(summary).toHaveCount(0)
    await expect(resources.getByText('user-reference.png')).toBeVisible()
    await expect(resources.getByText('agent-output.png')).toHaveCount(0)
    await expect(resources.getByText('beta-only.png')).toHaveCount(0)

    await app.resizeMainWindow(900, 800)
    await resources.getByText('user-reference.png').click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toHaveCount(
      0,
    )
    await expect(resources).toBeVisible()
    await app.resizeMainWindow(1_400, 800)

    await resources.getByRole('button', { name: 'Close resources' }).click()
    await expect(summary).toBeVisible()

    await mainWindow.openThread(BETA_TITLE)
    const betaSummary = page.getByRole('complementary', { name: 'Session Summary' })
    await betaSummary.getByRole('button', { name: /Sources/ }).click()
    await expect(betaSummary.getByText('beta-only.png')).toBeVisible()
    await expect(betaSummary.getByText('user-reference.png')).toHaveCount(0)
    await betaSummary.getByRole('button', { name: 'Collapse Session Summary' }).click()

    await mainWindow.openThread(ALPHA_TITLE)
    await expect(page.getByRole('complementary', { name: 'Session Summary' })).toBeVisible()
    await mainWindow.openThread(BETA_TITLE)
    await expect(
      page.locator('header').getByRole('button', { name: 'Session Summary', exact: true }),
    ).toBeVisible()
    await mainWindow.openThread(ALPHA_TITLE)
    const alphaSummary = page.getByRole('complementary', { name: 'Session Summary' })
    const alphaSources = alphaSummary.getByRole('button', { name: /Sources/ })
    if ((await alphaSources.getAttribute('aria-expanded')) !== 'true') await alphaSources.click()
    await alphaSummary.getByText('Show all').click()
    await expect(page.getByRole('region', { name: 'Session resources' })).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('Session Summary exposes complete GitHub PR and GitLab MR composition', async () => {
  test.setTimeout(180_000)
  const cliBinPath = await createFakeSourceControlCliBin()
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-change-requests-', {
    PATH: `${cliBinPath}${path.delimiter}${process.env.PATH ?? ''}`,
  })
  const githubProjectPath = path.join(app.userDataDir, 'github-change-request-project')
  const gitlabProjectPath = path.join(app.userDataDir, 'gitlab-change-request-project')
  try {
    const now = Date.now()
    await createGitProject(githubProjectPath, 'github')
    await createGitProject(gitlabProjectPath, 'gitlab')
    await seedSingleSession(app.userDataDir, {
      title: GITHUB_CHANGE_REQUEST_TITLE,
      projectPath: githubProjectPath,
      updatedAt: now,
      messages: [message('github-change-request-user', 'user', 'Prepare the PR.', now)],
    })
    await seedSingleSession(app.userDataDir, {
      title: GITLAB_CHANGE_REQUEST_TITLE,
      projectPath: gitlabProjectPath,
      updatedAt: now - 1,
      messages: [message('gitlab-change-request-user', 'user', 'Prepare the MR.', now - 1)],
    })
    await app.restart()
    await app.resizeMainWindow(1_400, 850)

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(GITHUB_CHANGE_REQUEST_TITLE)
    const githubSummary = page.getByRole('complementary', { name: 'Session Summary' })
    const createPr = githubSummary.getByRole('button', { name: 'Create PR' })
    await expect(createPr).toBeVisible({ timeout: 30_000 })
    await expect(githubSummary.getByRole('button', { name: /Changes/ })).toContainText('+2', {
      timeout: 30_000,
    })
    await createPr.click()

    const pullRequestComposer = page.getByRole('dialog', { name: 'Create pull request' })
    await expect(pullRequestComposer).toBeVisible()
    await expect(pullRequestComposer.getByText('New branch → main')).toBeVisible()
    await expect(pullRequestComposer.getByLabel('New branch name')).toHaveValue(
      'codex/session-summary-github-change-request',
    )
    await expect(pullRequestComposer.getByLabel('Title')).toHaveValue(GITHUB_CHANGE_REQUEST_TITLE)
    await expect(
      pullRequestComposer.getByText('Description (leave empty to generate)'),
    ).toBeVisible()
    await expect(
      pullRequestComposer.getByRole('checkbox', { name: /Commit and push local changes/ }),
    ).toBeChecked()
    await expect(pullRequestComposer.getByRole('button', { name: 'Create draft PR' })).toBeEnabled()
    await expect(pullRequestComposer.getByRole('button', { name: 'Create PR' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Enter Meta+Enter',
    )
    await expect(
      pullRequestComposer.getByRole('button', { name: 'Open PR in browser' }),
    ).toBeDisabled()
    await pullRequestComposer.getByRole('button', { name: 'Create PR' }).click()
    await expect(pullRequestComposer).toHaveCount(0, { timeout: 60_000 })
    await expect
      .poll(() =>
        execFileSync('git', ['branch', '--show-current'], {
          cwd: githubProjectPath,
          encoding: 'utf8',
        }).trim(),
      )
      .toBe('codex/session-summary-github-change-request')
    const githubOutputs = page
      .getByRole('complementary', { name: 'Session Summary' })
      .getByRole('button', { name: /Outputs/ })
    if ((await githubOutputs.getAttribute('aria-expanded')) !== 'true') await githubOutputs.click()
    await expect(githubOutputs).toContainText('2')
    await expect(
      page
        .getByRole('complementary', { name: 'Session Summary' })
        .getByRole('button', { name: GITHUB_CHANGE_REQUEST_TITLE, exact: true }),
    ).toBeVisible()

    await mainWindow.openThread(GITLAB_CHANGE_REQUEST_TITLE)
    const gitlabSummary = page.getByRole('complementary', { name: 'Session Summary' })
    const createMr = gitlabSummary.getByRole('button', { name: 'Create MR' })
    await expect(createMr).toBeVisible({ timeout: 30_000 })
    await expect(gitlabSummary.getByRole('button', { name: /Changes/ })).toContainText('+2', {
      timeout: 30_000,
    })
    await createMr.click()

    const mergeRequestComposer = page.getByRole('dialog', { name: 'Create merge request' })
    await expect(mergeRequestComposer).toBeVisible()
    await expect(mergeRequestComposer.getByText('New branch → main')).toBeVisible()
    await expect(mergeRequestComposer.getByLabel('New branch name')).toHaveValue(
      'codex/session-summary-gitlab-change-request',
    )
    await expect(
      mergeRequestComposer.getByRole('button', { name: 'Create draft MR' }),
    ).toBeEnabled()
    await expect(mergeRequestComposer.getByRole('button', { name: 'Create MR' })).toBeEnabled()
    await expect(
      mergeRequestComposer.getByRole('button', { name: 'Open MR in browser' }),
    ).toBeDisabled()
    await mergeRequestComposer.getByRole('button', { name: 'Create draft MR' }).click()
    await expect(mergeRequestComposer).toHaveCount(0, { timeout: 60_000 })
    await expect
      .poll(() =>
        execFileSync('git', ['branch', '--show-current'], {
          cwd: gitlabProjectPath,
          encoding: 'utf8',
        }).trim(),
      )
      .toBe('codex/session-summary-gitlab-change-request')
    const gitlabOutputs = page
      .getByRole('complementary', { name: 'Session Summary' })
      .getByRole('button', { name: /Outputs/ })
    if ((await gitlabOutputs.getAttribute('aria-expanded')) !== 'true') await gitlabOutputs.click()
    await expect(gitlabOutputs).toContainText('2')
    await expect(
      page
        .getByRole('complementary', { name: 'Session Summary' })
        .getByRole('button', { name: GITLAB_CHANGE_REQUEST_TITLE, exact: true }),
    ).toBeVisible()
  } finally {
    await app.cleanup({ forceProcessTermination: process.platform === 'win32' })
    await fs.rm(cliBinPath, { recursive: true, force: true })
  }
})
