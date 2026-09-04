import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { buildSafeElectronEnvironment } from '../scripts/safe-electron-environment'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const EMPTY_TITLE = 'Session Summary empty session'
const ALPHA_TITLE = 'Session Summary alpha'
const BETA_TITLE = 'Session Summary beta'
const ALPHA_USER_MESSAGE_ID = 'summary-alpha-user'
const ALPHA_AGENT_MESSAGE_ID = 'summary-alpha-agent'
const BETA_USER_MESSAGE_ID = 'summary-beta-user'
const GITHUB_CHANGE_REQUEST_TITLE = 'Session Summary GitHub change request'
const GITLAB_CHANGE_REQUEST_TITLE = 'Session Summary GitLab change request'
const GITHUB_FALLBACK_TITLE = 'Session Summary GitHub browser fallback'

function message(id: string, role: 'user' | 'assistant', text: string, createdAt: number) {
  return { id, role, parts: [{ type: 'text', text }], createdAt }
}

function svgData(color: string) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="${color}"/></svg>`,
  ).toString('base64')
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
  const realGitPath = resolveRealGitExecutable()
  if (process.platform === 'win32') {
    await createWindowsSourceControlCliFixtures(binPath, realGitPath)
    return binPath
  }

  const gh = `#!/bin/sh
if [ "$1" = "auth" ]; then
  case "$(pwd -P)" in
    *browser-fallback*) echo "authentication required" >&2; exit 1 ;;
  esac
  echo "Logged in to github.com account openwaggle-e2e"
  exit 0
fi
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
  const git = `#!/bin/sh
if [ "$1" = "remote" ] && [ "$2" = "get-url" ] && [ "$3" = "--push" ] && [ "$4" = "--all" ]; then
  exec ${JSON.stringify(realGitPath)} config --get "remote.$5.url"
fi
exec ${JSON.stringify(realGitPath)} "$@"
`
  await Promise.all([
    fs.writeFile(path.join(binPath, 'gh'), gh, { mode: 0o755 }),
    fs.writeFile(path.join(binPath, 'glab'), glab, { mode: 0o755 }),
    fs.writeFile(path.join(binPath, 'git'), git, { mode: 0o755 }),
  ])
  return binPath
}

function resolveRealGitExecutable() {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  const candidate = execFileSync(finder, ['git'], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .find((value) => value.trim().length > 0)
    ?.trim()
  if (!candidate) throw new Error('The Session Summary E2E fixture requires git.')
  return candidate
}

function csharpString(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

async function createWindowsSourceControlCliFixtures(binPath: string, realGitPath: string) {
  const sourcePath = path.join(binPath, 'source-control-fixture.cs')
  const executablePath = path.join(binPath, 'source-control-fixture.exe')
  const source = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

public static class Program {
  public static int Main(string[] args) {
    var command = Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location);
    if (command == "git") return RunGit(args);
    if (args.Length > 0 && args[0] == "auth") {
      if (command == "gh" && Directory.GetCurrentDirectory().Contains("browser-fallback")) {
        Console.Error.WriteLine("authentication required");
        return 1;
      }
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

  private static int RunGit(string[] args) {
    var actualArgs = args;
    if (args.Length >= 5 && args[0] == "remote" && args[1] == "get-url" && args[2] == "--push" && args[3] == "--all") {
      actualArgs = new[] { "config", "--get", "remote." + args[4] + ".url" };
    }
    var startInfo = new ProcessStartInfo {
      FileName = ${csharpString(realGitPath)},
      Arguments = String.Join(" ", Array.ConvertAll(actualArgs, QuoteArgument)),
      UseShellExecute = false,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
    };
    using (var process = Process.Start(startInfo)) {
      var stdout = process.StandardOutput.ReadToEnd();
      var stderr = process.StandardError.ReadToEnd();
      process.WaitForExit();
      Console.Out.Write(stdout);
      Console.Error.Write(stderr);
      return process.ExitCode;
    }
  }

  private static string QuoteArgument(string value) {
    var needsQuotes = value.Length == 0;
    foreach (var character in value) {
      if (Char.IsWhiteSpace(character) || character == '"') needsQuotes = true;
    }
    if (!needsQuotes) return value;
    var builder = new StringBuilder();
    builder.Append((char)34);
    var backslashes = 0;
    foreach (var character in value) {
      if (character == '\\') {
        backslashes += 1;
        continue;
      }
      if (character == '"') {
        builder.Append('\\', backslashes * 2 + 1);
        builder.Append((char)34);
        backslashes = 0;
        continue;
      }
      builder.Append('\\', backslashes);
      backslashes = 0;
      builder.Append(character);
    }
    builder.Append('\\', backslashes * 2);
    builder.Append((char)34);
    return builder.ToString();
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
    fs.copyFile(executablePath, path.join(binPath, 'git.exe')),
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
      page.locator('header').getByRole('button', { name: 'Hide Session Summary' }),
    ).toBeVisible()
    await expect(setupDock).toHaveAttribute('aria-hidden', 'true')
    await expect(summary.getByText('main')).toBeVisible({ timeout: 30_000 })
    await expect(summary.getByRole('button', { name: /Changes/ })).toContainText('+2')
    await summary.getByRole('button', { name: 'Environment: Local' }).click()
    const environmentDetails = page.getByRole('dialog', { name: 'Session environment details' })
    await expect(environmentDetails).toContainText('fixed after the first message')
    await expect(environmentDetails).toContainText(projectPath)
    await page.keyboard.press('Escape')

    await summary.getByRole('button', { name: 'Branch: main' }).click()
    await expect(page.getByRole('dialog', { name: 'Choose a session branch' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search branches' })).toBeVisible()
    await page.keyboard.press('Escape')

    await summary.getByRole('button', { name: 'Environment actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Toggle terminal' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Open working folder' })).toBeVisible()
    await page.keyboard.press('Escape')

    const commitOrPush = summary.getByRole('button', { name: 'Commit or push' })
    await expect(commitOrPush).toBeEnabled()
    await commitOrPush.click()
    await expect(page.getByRole('heading', { name: 'Commit message' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(summary.getByRole('button', { name: 'Create PR' })).toHaveCount(0)
    const transcript = page.getByRole('log', { name: 'Chat messages' })
    const expandedTranscriptWidth = await transcript.evaluate(
      (element) => element.getBoundingClientRect().width,
    )

    await page.locator('header').getByRole('button', { name: 'Hide Session Summary' }).click()
    await expect(summary).toHaveCount(0)
    const collapsedTranscriptWidth = await transcript.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    expect(Math.abs(expandedTranscriptWidth - collapsedTranscriptWidth)).toBeLessThan(1)
    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
    await expect(summary).toBeVisible()

    await page.locator('header').getByRole('button', { name: 'Hide Session Summary' }).click()
    const focusedSummaryToggle = page
      .locator('header')
      .getByRole('button', { name: 'Open Session Summary' })
    await expect(focusedSummaryToggle).toBeFocused()
    await focusedSummaryToggle.click()
    await expect(summary).toBeVisible()

    const changesAction = summary.getByRole('button', { name: /Changes/ })
    await changesAction.focus()
    await changesAction.press('Enter')
    await expect(summary).toHaveCount(0)
    const suppressedSummaryToggle = page
      .locator('header')
      .getByRole('button', { name: 'Hide Session Summary' })
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
    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
    await expect(summary).toBeVisible()

    await summary.getByRole('button', { name: /Changes/ }).focus()
    await app.resizeMainWindow(720, 700)
    await expect(summary).toHaveCount(0)
    await expect(
      page.locator('header').getByRole('button', { name: 'Open Session Summary' }),
    ).toBeFocused()
    const narrowTranscriptWidth = await transcript.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
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
    const alphaSourceBytes = Buffer.from(svgData('#3b82f6'), 'base64')
    const alphaSourcePath = path.join(app.userDataDir, 'user-reference.svg')
    await fs.writeFile(alphaSourcePath, alphaSourceBytes)
    await seedSingleSession(app.userDataDir, {
      title: ALPHA_TITLE,
      updatedAt: now,
      messages: [
        {
          id: ALPHA_USER_MESSAGE_ID,
          role: 'user',
          createdAt: now - 2,
          parts: [
            { type: 'text', text: 'Here is the source image.' },
            {
              type: 'attachment',
              attachment: {
                id: 'alpha-user-attachment',
                kind: 'image',
                origin: 'user-file',
                name: 'user-reference.svg',
                path: alphaSourcePath,
                mimeType: 'image/svg+xml',
                sizeBytes: alphaSourceBytes.byteLength,
                contentSha256: crypto.createHash('sha256').update(alphaSourceBytes).digest('hex'),
                extractedText: '',
              },
            },
          ],
        },
        {
          id: ALPHA_AGENT_MESSAGE_ID,
          role: 'assistant',
          createdAt: now - 1,
          parts: [
            {
              type: 'text',
              text: 'Here is the generated image and [Alpha documentation](https://example.com/alpha).',
            },
            {
              type: 'tool-result',
              toolResult: {
                id: 'alpha-image-tool-result',
                name: 'imagegen',
                args: {},
                result: {
                  type: 'image',
                  data: svgData('#22c55e'),
                  mimeType: 'image/svg+xml',
                  name: 'agent-output.svg',
                },
                isError: false,
                duration: 1,
              },
            },
          ],
        },
      ],
    })
    const betaSourceBytes = Buffer.from(svgData('#a855f7'), 'base64')
    const betaSourcePath = path.join(app.userDataDir, 'beta-only.svg')
    await fs.writeFile(betaSourcePath, betaSourceBytes)
    await seedSingleSession(app.userDataDir, {
      title: BETA_TITLE,
      updatedAt: now - 10,
      messages: [
        {
          id: BETA_USER_MESSAGE_ID,
          role: 'user',
          createdAt: now - 10,
          parts: [
            { type: 'text', text: 'Beta image only.' },
            {
              type: 'attachment',
              attachment: {
                id: 'beta-user-attachment',
                kind: 'image',
                origin: 'user-file',
                name: 'beta-only.svg',
                path: betaSourcePath,
                mimeType: 'image/svg+xml',
                sizeBytes: betaSourceBytes.byteLength,
                contentSha256: crypto.createHash('sha256').update(betaSourceBytes).digest('hex'),
                extractedText: '',
              },
            },
          ],
        },
      ],
    })
    await app.restart()
    await app.resizeMainWindow(1_400, 800)

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(ALPHA_TITLE)
    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    const inlineUserImage = page.getByRole('button', { name: 'Open image user-reference.svg' })
    await expect(inlineUserImage).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open image agent-output.svg' })).toBeVisible()

    await expect(summary).toBeVisible()
    await page.locator('header').getByRole('button', { name: 'Hide Session Summary' }).click()
    await expect(summary).toHaveCount(0)
    await inlineUserImage.click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.svg' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
    await summary.getByRole('button', { name: /Sources/ }).click()
    await summary.getByRole('button', { name: 'user-reference.svg' }).click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.svg' })).toBeVisible()
    await page.keyboard.press('Escape')
    await summary.getByRole('button', { name: 'Show all' }).click()

    const resources = page.getByRole('region', { name: 'Session resources' })
    await expect(resources).toBeVisible()
    await expect(summary).toHaveCount(0)
    await expect(resources.getByText('user-reference.svg')).toBeVisible()
    await expect(resources.getByText('Alpha documentation')).toBeVisible()
    await expect(resources.getByText('agent-output.svg')).toHaveCount(0)
    await expect(resources.getByText('beta-only.svg')).toHaveCount(0)

    await resources.getByRole('button', { name: 'Outputs' }).click()
    await expect(resources.getByText('agent-output.svg')).toBeVisible()
    await expect(resources.getByText('user-reference.svg')).toHaveCount(0)
    await resources.getByRole('button', { name: 'Sources' }).click()

    await resources.getByText('user-reference.svg').click()
    const viewer = page.getByRole('dialog', { name: 'Image viewer: user-reference.svg' })
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('1 of 2')
    await expect(viewer.getByLabel('Image provenance')).toContainText(
      'Source · Provided by you · Branch main',
    )
    await viewer.getByLabel('Image zoom').selectOption('200')
    await expect(viewer.getByLabel('Image zoom')).toHaveValue('200')
    const imageCanvas = viewer.getByLabel('Image canvas')
    await expect
      .poll(() =>
        imageCanvas.evaluate(
          (element) =>
            element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true)
    const initialPan = await imageCanvas.evaluate((element) => {
      element.scrollLeft = 100
      element.scrollTop = 100
      return { left: element.scrollLeft, top: element.scrollTop }
    })
    const viewedImage = viewer.getByRole('img', { name: 'user-reference.svg' })
    const imageBox = await viewedImage.boundingBox()
    if (!imageBox) throw new Error('Expected the full-size image to have a bounding box')
    await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(imageBox.x + imageBox.width / 2 - 80, imageBox.y + imageBox.height / 2 - 60)
    await page.mouse.up()
    await expect
      .poll(() =>
        imageCanvas.evaluate(
          (element, initial) =>
            element.scrollLeft > initial.left && element.scrollTop > initial.top,
          initialPan,
        ),
      )
      .toBe(true)
    await viewer.getByRole('button', { name: 'Next image' }).click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: agent-output.svg' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.svg' })).toBeVisible()
    await page.getByRole('button', { name: 'Close image viewer' }).click()

    await mainWindow.openThread(BETA_TITLE)
    await expect(resources).toBeVisible()
    await expect(resources.getByText('beta-only.svg')).toBeVisible()
    await expect(resources.getByText('user-reference.svg')).toHaveCount(0)
    await resources.getByRole('button', { name: 'Close resources' }).click()
    const betaSummary = page.getByRole('complementary', { name: 'Session Summary' })
    await expect(betaSummary).toBeVisible()
    await betaSummary.getByRole('button', { name: /Sources/ }).click()
    await expect(betaSummary.getByText('beta-only.svg')).toBeVisible()
    await expect(betaSummary.getByText('user-reference.svg')).toHaveCount(0)
    await page.locator('header').getByRole('button', { name: 'Hide Session Summary' }).click()

    await mainWindow.openThread(ALPHA_TITLE)
    await expect(page.getByRole('complementary', { name: 'Session Summary' })).toBeVisible()
    await mainWindow.openThread(BETA_TITLE)
    await expect(
      page.locator('header').getByRole('button', { name: 'Open Session Summary' }),
    ).toBeVisible()
  } finally {
    await app.cleanup()
  }
})

test('Session Summary exposes complete GitHub PR and GitLab MR composition', async () => {
  test.setTimeout(180_000)
  const cliBinPath = await createFakeSourceControlCliBin()
  const inheritedPath = buildSafeElectronEnvironment({}).PATH ?? ''
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-change-requests-', {
    PATH: `${cliBinPath}${path.delimiter}${inheritedPath}`,
  })
  const githubProjectPath = path.join(app.userDataDir, 'github-change-request-project')
  const gitlabProjectPath = path.join(app.userDataDir, 'gitlab-change-request-project')
  const githubFallbackProjectPath = path.join(
    app.userDataDir,
    'github-browser-fallback-project',
  )
  try {
    const now = Date.now()
    await createGitProject(githubProjectPath, 'github')
    await createGitProject(gitlabProjectPath, 'gitlab')
    await createGitProject(githubFallbackProjectPath, 'github')
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
    await seedSingleSession(app.userDataDir, {
      title: GITHUB_FALLBACK_TITLE,
      projectPath: githubFallbackProjectPath,
      updatedAt: now - 2,
      messages: [
        message(
          'github-browser-fallback-user',
          'user',
          'Prepare the PR in the browser.',
          now - 2,
        ),
      ],
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
    await expect(pullRequestComposer.getByText('GitHub CLI ready as openwaggle-e2e.')).toBeVisible()
    await expect(pullRequestComposer.getByRole('button', { name: 'Create PR' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Enter Meta+Enter',
    )
    await expect(
      pullRequestComposer.getByRole('button', { name: 'Open PR in browser' }),
    ).toBeEnabled()
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
    await expect(mergeRequestComposer.getByText('GitLab CLI ready as openwaggle-e2e.')).toBeVisible()
    await expect(
      mergeRequestComposer.getByRole('button', { name: 'Open MR in browser' }),
    ).toBeEnabled()
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

    await mainWindow.openThread(GITHUB_FALLBACK_TITLE)
    const fallbackSummary = page.getByRole('complementary', { name: 'Session Summary' })
    await fallbackSummary.getByRole('button', { name: 'Create PR' }).click()
    const fallbackComposer = page.getByRole('dialog', { name: 'Create pull request' })
    await expect(fallbackComposer).toBeVisible()
    await expect(
      fallbackComposer.getByText('GitHub CLI is not authenticated for github.com.'),
    ).toBeVisible()
    await expect(fallbackComposer.getByRole('button', { name: 'Create draft PR' })).toBeDisabled()
    await expect(fallbackComposer.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    await expect(
      fallbackComposer.getByRole('button', { name: 'Open PR in browser' }),
    ).toBeEnabled()
  } finally {
    await app.cleanup({ forceProcessTermination: true })
    await fs.rm(cliBinPath, { recursive: true, force: true })
  }
})
