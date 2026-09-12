import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import sharp from 'sharp'
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
const CHANGE_REQUEST_TEST_TIMEOUT_MS = 300_000
const NATIVE_CHANGE_REQUEST_TIMEOUT_MS = 150_000

function message(id: string, role: 'user' | 'assistant', text: string, createdAt: number) {
  return { id, role, parts: [{ type: 'text', text }], createdAt }
}

function pngBytes(background: string) {
  return sharp({
    create: { width: 1_200, height: 900, channels: 4, background },
  })
    .png()
    .toBuffer()
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
merged_state="$(dirname "$0")/gh-merged"
if [ "$1" = "auth" ]; then
  case "$(pwd -P)" in
    *browser-fallback*) echo "authentication required" >&2; exit 1 ;;
  esac
  echo "Logged in to github.com account openwaggle-e2e"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/openwaggle/e2e/pull/42"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then printf '%s\n' "$*" > "$merged_state"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ] && [ "$3" != "main" ]; then
  if [ -f "$merged_state" ]; then
    echo '{"number":42,"title":"Session Summary GitHub change request","url":"https://github.com/openwaggle/e2e/pull/42","baseRefName":"main","headRefName":"codex/session-summary-github-change-request-2","headRefOid":"abcdef1234567890","state":"MERGED","isDraft":false,"author":{"login":"openwaggle-e2e"},"changedFiles":1,"additions":4,"deletions":1,"files":[{"path":"README.md","additions":4,"deletions":1}],"statusCheckRollup":[{"name":"Unit","status":"COMPLETED","conclusion":"SUCCESS"}],"latestReviews":[{"id":"review-1"}],"comments":[{"id":"comment-1"}],"reviewDecision":"APPROVED","mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN"}'
    exit 0
  fi
  echo '{"number":42,"title":"Session Summary GitHub change request","url":"https://github.com/openwaggle/e2e/pull/42","baseRefName":"main","headRefName":"codex/session-summary-github-change-request-2","headRefOid":"abcdef1234567890","state":"OPEN","isDraft":false,"author":{"login":"openwaggle-e2e"},"changedFiles":1,"additions":4,"deletions":1,"files":[{"path":"README.md","additions":4,"deletions":1}],"statusCheckRollup":[{"name":"Unit","status":"COMPLETED","conclusion":"SUCCESS"}],"latestReviews":[{"id":"review-1"}],"comments":[{"id":"comment-1"}],"reviewDecision":"APPROVED","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN"}'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo '[{"title":"Session Summary GitHub change request","url":"https://github.com/openwaggle/e2e/pull/42","baseRefName":"main","headRefName":"codex/session-summary-github-change-request-2","state":"OPEN","isDraft":false}]'; exit 0; fi
echo "no pull requests found" >&2
exit 1
`
  const glab = `#!/bin/sh
if [ "$1" = "auth" ]; then echo "Logged in to gitlab.com as openwaggle-e2e"; exit 0; fi
if [ "$1" = "mr" ] && [ "$2" = "create" ]; then echo "https://gitlab.com/openwaggle/e2e/-/merge_requests/42"; exit 0; fi
if [ "$1" = "mr" ] && [ "$2" = "view" ] && [ "$3" != "main" ]; then
  echo '{"iid":42,"title":"Session Summary GitLab change request","web_url":"https://gitlab.com/openwaggle/e2e/-/merge_requests/42","target_branch":"main","source_branch":"codex/session-summary-gitlab-change-request","sha":"abcdef1234567890","state":"opened","draft":true,"author":{"username":"openwaggle-e2e"},"changes_count":"1","diff_stats":[{"path":"README.md","additions":4,"deletions":1}],"head_pipeline":{"name":"Pipeline","status":"success"},"user_notes_count":1,"approvals_left":0,"merge_status":"can_be_merged"}'
  exit 0
fi
if [ "$1" = "mr" ] && [ "$2" = "list" ]; then echo '[{"title":"Session Summary GitLab change request","web_url":"https://gitlab.com/openwaggle/e2e/-/merge_requests/42","target_branch":"main","source_branch":"codex/session-summary-gitlab-change-request","state":"opened","draft":true}]'; exit 0; fi
echo "no merge request found" >&2
exit 1
`
  const git = `#!/bin/sh
if [ "$1" = "fetch" ]; then exit 0; fi
# Preserve production's invocation-only URL pin while mapping the hosted fixture to its bare repo.
case "$GIT_CONFIG_KEY_0" in
  url.https://github.com/openwaggle/e2e.git.insteadOf|url.https://gitlab.com/openwaggle/e2e.git.insteadOf)
    export GIT_CONFIG_KEY_0="url.$(pwd -P)-remote.git.insteadOf" ;;
esac
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
    var executableDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".";
    var mergedStatePath = Path.Combine(executableDirectory, "gh-merged");
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
    if (command == "gh" && args.Length > 1 && args[0] == "pr" && args[1] == "merge") {
      File.WriteAllText(mergedStatePath, String.Join(" ", args));
      return 0;
    }
    if (command == "gh" && args.Length > 2 && args[0] == "pr" && args[1] == "view" && args[2] != "main") {
      var details = "{\"number\":42,\"title\":\"Session Summary GitHub change request\",\"url\":\"https://github.com/openwaggle/e2e/pull/42\",\"baseRefName\":\"main\",\"headRefName\":\"codex/session-summary-github-change-request-2\",\"headRefOid\":\"abcdef1234567890\",\"state\":\"OPEN\",\"isDraft\":false,\"author\":{\"login\":\"openwaggle-e2e\"},\"changedFiles\":1,\"additions\":4,\"deletions\":1,\"files\":[{\"path\":\"README.md\",\"additions\":4,\"deletions\":1}],\"statusCheckRollup\":[{\"name\":\"Unit\",\"status\":\"COMPLETED\",\"conclusion\":\"SUCCESS\"}],\"latestReviews\":[{\"id\":\"review-1\"}],\"comments\":[{\"id\":\"comment-1\"}],\"reviewDecision\":\"APPROVED\",\"mergeable\":\"MERGEABLE\",\"mergeStateStatus\":\"CLEAN\"}";
      if (File.Exists(mergedStatePath)) {
        details = details.Replace("\"state\":\"OPEN\"", "\"state\":\"MERGED\"");
      }
      Console.WriteLine(details);
      return 0;
    }
    if (command == "glab" && args.Length > 1 && args[0] == "mr" && args[1] == "create") {
      Console.WriteLine("https://gitlab.com/openwaggle/e2e/-/merge_requests/42");
      return 0;
    }
    if (command == "glab" && args.Length > 2 && args[0] == "mr" && args[1] == "view" && args[2] != "main") {
      Console.WriteLine("{\"iid\":42,\"title\":\"Session Summary GitLab change request\",\"web_url\":\"https://gitlab.com/openwaggle/e2e/-/merge_requests/42\",\"target_branch\":\"main\",\"source_branch\":\"codex/session-summary-gitlab-change-request\",\"sha\":\"abcdef1234567890\",\"state\":\"opened\",\"draft\":true,\"author\":{\"username\":\"openwaggle-e2e\"},\"changes_count\":\"1\",\"diff_stats\":[{\"path\":\"README.md\",\"additions\":4,\"deletions\":1}],\"head_pipeline\":{\"name\":\"Pipeline\",\"status\":\"success\"},\"user_notes_count\":1,\"approvals_left\":0,\"merge_status\":\"can_be_merged\"}");
      return 0;
    }
    if (args.Length > 1 && (args[1] == "list")) {
      Console.WriteLine(command == "gh" ? "[{\"title\":\"Session Summary GitHub change request\",\"url\":\"https://github.com/openwaggle/e2e/pull/42\",\"baseRefName\":\"main\",\"headRefName\":\"codex/session-summary-github-change-request-2\",\"state\":\"OPEN\",\"isDraft\":false}]" : "[{\"title\":\"Session Summary GitLab change request\",\"web_url\":\"https://gitlab.com/openwaggle/e2e/-/merge_requests/42\",\"target_branch\":\"main\",\"source_branch\":\"codex/session-summary-gitlab-change-request\",\"state\":\"opened\",\"draft\":true}]");
      return 0;
    }
    Console.Error.WriteLine(command == "gh" ? "no pull requests found" : "no merge request found");
    return 1;
  }

  private static int RunGit(string[] args) {
    if (args.Length > 0 && args[0] == "fetch") return 0;
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
    var pinnedKey = Environment.GetEnvironmentVariable("GIT_CONFIG_KEY_0");
    if (pinnedKey == "url.https://github.com/openwaggle/e2e.git.insteadOf" || pinnedKey == "url.https://gitlab.com/openwaggle/e2e.git.insteadOf") {
      startInfo.EnvironmentVariables["GIT_CONFIG_KEY_0"] = "url." + Directory.GetCurrentDirectory() + "-remote.git.insteadOf";
    }
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

interface ChangeRequestFixtureInput {
  readonly prefix: string
  readonly projectName: string
  readonly title: string
  readonly provider: 'github' | 'gitlab'
  readonly messageId: string
  readonly messageText: string
}

async function launchChangeRequestFixture(input: ChangeRequestFixtureInput) {
  const cliBinPath = await createFakeSourceControlCliBin()
  const inheritedPath = buildSafeElectronEnvironment({}).PATH ?? ''
  const app = await OpenWaggleApp.launch(input.prefix, {
    PATH: `${cliBinPath}${path.delimiter}${inheritedPath}`,
  })
  const projectPath = path.join(app.userDataDir, input.projectName)

  try {
    const now = Date.now()
    await createGitProject(projectPath, input.provider)
    await seedSingleSession(app.userDataDir, {
      title: input.title,
      projectPath,
      updatedAt: now,
      messages: [message(input.messageId, 'user', input.messageText, now)],
    })
    await app.restart()
    await app.resizeMainWindow(1_800, 850)
    return { app, cliBinPath, projectPath }
  } catch (error) {
    await app.cleanup({ forceProcessTermination: true })
    await fs.rm(cliBinPath, { recursive: true, force: true })
    throw error
  }
}

async function cleanupChangeRequestFixture(
  fixture: Awaited<ReturnType<typeof launchChangeRequestFixture>>,
) {
  await fixture.app.cleanup({ forceProcessTermination: true })
  await fs.rm(fixture.cliBinPath, { recursive: true, force: true })
}

async function openSessionSummary(page: Page) {
  const summary = page.getByRole('complementary', { name: 'Session Summary' })
  if ((await summary.count()) === 0) {
    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
  }
  await expect(summary).toBeVisible()
  return summary
}

test('Session Summary follows first-message, dock, and sidebar behavior', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-session-summary-lifecycle-')
  const projectPath = path.join(app.userDataDir, 'github-project')
  try {
    await createGitProject(projectPath)
    const emptySessionId = await seedSingleSession(app.userDataDir, {
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
    await app.resizeMainWindow(1_800, 800)
    await app.installAgentSendProbe()

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    const setupDock = page.locator('fieldset[aria-label="Session setup"]')
    await mainWindow.openThread(EMPTY_TITLE)
    await expect(page.getByRole('complementary', { name: 'Session Summary' })).toHaveCount(0)
    await expect(
      page.locator('header').getByRole('button', { name: /Session Summary/ }),
    ).toHaveCount(0)
    await expect(setupDock).toHaveAttribute('aria-hidden', 'false')
    const emptySessionDetail = (await page.evaluate(() => window.api.listSessionDetails())).find(
      (session) => String(session.id) === emptySessionId,
    )
    if (!emptySessionDetail) throw new Error('Expected the empty Session detail')
    await app.installSessionDetailSnapshotProbe({
      sessionId: emptySessionId,
      detail: {
        ...emptySessionDetail,
        messages: [
          message(
            'summary-empty-user',
            'user',
            'Start the empty session live.',
            Date.now(),
          ),
        ],
      },
    })

    await mainWindow.pasteIntoComposer('Start the empty session live.')
    await mainWindow.submitComposer()
    await expect(mainWindow.lastUserMessage()).toContainText('Start the empty session live.')
    await expect
      .poll(() => app.readAgentSendProbe())
      .toMatchObject({ sessionId: emptySessionId })
    await expect
      .poll(async () => {
        const detail = await page.evaluate(
          (sessionId) => window.api.getSessionDetail(sessionId),
          emptySessionDetail.id,
        )
        return detail?.messages.length ?? 0
      })
      .toBe(1)
    const liveSummary = page.getByRole('complementary', { name: 'Session Summary' })
    await expect(liveSummary).toBeVisible({ timeout: 30_000 })
    await expect(
      page.locator('header').getByRole('button', { name: 'Hide Session Summary' }),
    ).toBeVisible()
    await expect(setupDock).toHaveAttribute('aria-hidden', 'true')

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
    await expect(environmentDetails).toContainText(path.basename(projectPath))
    await page.keyboard.press('Escape')

    await summary.getByRole('button', { name: 'Branch: main' }).click()
    await expect(page.getByRole('dialog', { name: 'Choose a session branch' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search branches' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Search branches' }).fill('summary-menu-hit-test')
    for (const name of ['Create summary-menu-hit-test', 'Copy branch name']) {
      await expect.poll(() => page.getByRole('button', { name, exact: true }).evaluate((button) => {
        const rect = button.getBoundingClientRect()
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })).toBe(true)
    }
    await app.captureEvidence('session-summary-branch-menu-unclipped')
    await page.keyboard.press('Escape')

    await summary.getByRole('button', { name: 'Environment actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Toggle terminal' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Open working folder' })).toBeVisible()
    await page.keyboard.press('Escape')

    await summary.getByRole('button', { name: 'Add a source' }).click()
    await expect(page.getByRole('menuitem', { name: /Attach files/ })).toBeVisible()
    await page.getByRole('menuitem', { name: /Reference project file/ }).click()
    await mainWindow.expectComposerValue('@')
    await mainWindow.messageInput().press('Backspace')
    await mainWindow.expectComposerValue('')

    const commitOrPush = summary.getByRole('button', { name: 'Commit or push' })
    await expect(commitOrPush).toBeEnabled({ timeout: 30_000 })
    await commitOrPush.click()
    await expect(page.getByRole('dialog', { name: 'Commit or push' })).toBeVisible()
    await page.getByRole('button', { name: 'Close commit or push' }).click()
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
      .getByRole('button', { name: 'Open Session Summary' })
    await expect(suppressedSummaryToggle).toBeDisabled()
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
    await page.getByRole('button', { name: 'Close diff sidebar' }).click()
    await expect(summary).toBeVisible()
    await page.locator('header').getByRole('button', { name: 'Hide Session Summary' }).click()
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

    await summary.getByRole('button', { name: 'Environment actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Open working folder' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'Open working folder' })).toHaveCount(0)
    await expect(summary).toBeVisible()

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
    const alphaSourceBytes = await pngBytes('#3b82f6')
    const alphaSourcePath = path.join(app.userDataDir, 'user-reference.png')
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
                name: 'user-reference.png',
                path: alphaSourcePath,
                mimeType: 'image/png',
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
                  data: (await pngBytes('#22c55e')).toString('base64'),
                  mimeType: 'image/png',
                  name: 'agent-output.png',
                },
                isError: false,
                duration: 1,
              },
            },
          ],
        },
      ],
    })
    const betaSourceBytes = await pngBytes('#a855f7')
    const betaSourcePath = path.join(app.userDataDir, 'beta-only.png')
    await fs.writeFile(betaSourcePath, betaSourceBytes)
    const betaSessionId = await seedSingleSession(app.userDataDir, {
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
                name: 'beta-only.png',
                path: betaSourcePath,
                mimeType: 'image/png',
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
    await app.resizeMainWindow(1_800, 800)

    const mainWindow = app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(ALPHA_TITLE)
    const summary = page.getByRole('complementary', { name: 'Session Summary' })
    const inlineUserImage = page.getByRole('button', { name: 'Open image user-reference.png' })
    await expect(inlineUserImage).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Open image agent-output.png' })).toBeVisible({
      timeout: 30_000,
    })

    await expect(summary).toBeVisible()
    await page.locator('header').getByRole('button', { name: 'Hide Session Summary' }).click()
    await expect(summary).toHaveCount(0)
    await inlineUserImage.click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toBeVisible()
    await page.keyboard.press('Escape')

    await app.resizeMainWindow(720, 700)
    await page.locator('header').getByRole('button', { name: 'Open Session Summary' }).click()
    await summary.getByRole('button', { name: /Sources/ }).click()
    await summary.getByRole('button', { name: 'user-reference.png' }).click()
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toBeVisible()
    await page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })
      .getByRole('button', { name: 'Zoom in', exact: true }).click()
    await app.captureEvidence('session-summary-narrow-image-overlay')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toHaveCount(0)
    await expect(summary).toBeVisible()
    await app.resizeMainWindow(1_800, 800)
    await expect(summary).toBeVisible()
    await summary.locator('#session-summary-section-sources').getByRole('button', { name: 'Show all' }).click()

    const resources = page.getByRole('region', { name: 'Session resources' })
    await expect(resources).toBeVisible()
    await expect(summary).toHaveCount(0)
    await expect(resources.getByText('user-reference.png')).toBeVisible()
    await expect(resources.getByText('Alpha documentation')).toBeVisible()
    await expect(resources.getByText('agent-output.png')).toHaveCount(0)
    await expect(resources.getByText('beta-only.png')).toHaveCount(0)

    await resources.getByRole('button', { name: 'Outputs', exact: true }).click()
    await expect(resources.getByText('agent-output.png')).toBeVisible()
    await expect(resources.getByText('user-reference.png')).toHaveCount(0)
    await resources.getByRole('button', { name: 'Sources', exact: true }).click()

    await resources.getByText('user-reference.png').click()
    const viewer = page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('1 of 2')
    await expect(viewer.getByLabel('Image provenance')).toContainText(
      'Source · Provided by you · Branch main',
    )
    const imageCanvas = viewer.getByLabel('Image canvas')
    // Exercise the production Electron listener, where React's passive wheel handler cannot
    // prevent the browser's default zoom. The canvas must consume only modifier-wheel gestures.
    const pinchCancelled = await imageCanvas.evaluate((element) => {
      const event = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100,
      })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(pinchCancelled).toBe(true)
    await expect(viewer.getByLabel('Image zoom', { exact: true })).toHaveValue('100')
    const ordinaryScrollCancelled = await imageCanvas.evaluate((element) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(ordinaryScrollCancelled).toBe(false)
    await viewer.getByLabel('Image zoom', { exact: true }).selectOption('200')
    await expect(viewer.getByLabel('Image zoom', { exact: true })).toHaveValue('200')
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
    const viewedImage = viewer.getByRole('img', { name: 'user-reference.png' })
    await expect(viewedImage).toBeVisible()
    const alphaContentUrl = await viewedImage.getAttribute('src')
    if (!alphaContentUrl?.startsWith('openwaggle-session-resource://')) {
      throw new Error('Expected the viewer to use an opaque Session resource URL')
    }
    const canvasBox = await imageCanvas.boundingBox()
    if (!canvasBox) throw new Error('Expected the image canvas to have a bounding box')
    const dragStart = {
      x: canvasBox.x + canvasBox.width / 2,
      y: canvasBox.y + canvasBox.height / 2,
    }
    await page.mouse.move(dragStart.x, dragStart.y)
    await page.mouse.down()
    await page.mouse.move(dragStart.x - 80, dragStart.y - 60, { steps: 4 })
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
    await expect(page.getByRole('dialog', { name: 'Image viewer: agent-output.png' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('dialog', { name: 'Image viewer: user-reference.png' })).toBeVisible()
    await expect(viewedImage).toHaveJSProperty('naturalWidth', 1_200)
    const activeAlphaContentUrl = await viewedImage.getAttribute('src')
    if (!activeAlphaContentUrl) throw new Error('The current gallery image has no capability.')

    await page.evaluate((sessionId) => {
      const query = window.location.hash.includes('?')
        ? window.location.hash.slice(window.location.hash.indexOf('?'))
        : ''
      window.location.hash = `/sessions/${sessionId}${query}`
    }, String(betaSessionId))
    await expect(
      page.locator('[data-qa="header-session-title"]').getByText(BETA_TITLE, { exact: true }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('dialog', { name: /Image viewer:/ })).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(async (url) => {
          return new Promise<boolean>((resolve) => {
            const image = new Image()
            image.onload = () => resolve(false)
            image.onerror = () => resolve(true)
            // Use the unread download URL to bypass Chromium's decoded-image memory cache.
            image.src = url.replace(/\/view$/u, '/download')
          })
        }, activeAlphaContentUrl),
      )
      .toBe(true)
    await expect(resources).toBeVisible()
    await expect(resources.getByText('beta-only.png')).toBeVisible()
    await expect(resources.getByText('user-reference.png')).toHaveCount(0)
    await resources.getByRole('button', { name: 'Close resources' }).click()
    const betaSummary = page.getByRole('complementary', { name: 'Session Summary' })
    await expect(betaSummary).toBeVisible()
    await betaSummary.getByRole('button', { name: /Sources/ }).click()
    await expect(betaSummary.getByText('beta-only.png')).toBeVisible()
    await expect(betaSummary.getByText('user-reference.png')).toHaveCount(0)
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

test('Session Summary creates a complete GitHub pull request', async () => {
  test.setTimeout(CHANGE_REQUEST_TEST_TIMEOUT_MS)
  const fixture = await launchChangeRequestFixture({
    prefix: 'openwaggle-session-summary-github-pr-',
    projectName: 'github-change-request-project',
    title: GITHUB_CHANGE_REQUEST_TITLE,
    provider: 'github',
    messageId: 'github-change-request-user',
    messageText: 'Prepare the PR.',
  })

  try {
    execFileSync(
      'git',
      ['branch', 'codex/session-summary-github-change-request'],
      { cwd: fixture.projectPath, stdio: 'ignore' },
    )
    const mainWindow = fixture.app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(GITHUB_CHANGE_REQUEST_TITLE)
    const summary = await openSessionSummary(page)
    await expect(summary.getByRole('button', { name: 'Commit or push' })).toBeEnabled({
      timeout: 30_000,
    })
    await expect(summary.getByRole('button', { name: /Changes/ })).toContainText('+2', {
      timeout: 30_000,
    })
    await summary.getByRole('button', { name: 'Create PR' }).click()

    const composer = page.getByRole('dialog', { name: 'Create pull request' })
    await expect(composer).toBeVisible()
    await expect(composer.getByText('New branch → main')).toBeVisible()
    await expect(composer.getByLabel('New branch name')).toHaveValue(
      'codex/session-summary-github-change-request-2',
      { timeout: 30_000 },
    )
    await expect(composer.getByLabel('Title')).toHaveValue(GITHUB_CHANGE_REQUEST_TITLE)
    await expect(composer.getByText('Description (leave empty to generate)')).toBeVisible()
    await expect(
      composer.getByRole('checkbox', { name: /Commit and push local changes/ }),
    ).toBeChecked()
    await expect(composer.getByRole('button', { name: 'Create draft PR' })).toBeEnabled({
      timeout: 30_000,
    })
    await expect(
      composer.getByRole('contentinfo').getByText('GitHub CLI ready as openwaggle-e2e.'),
    ).toBeVisible()
    await expect(composer.getByRole('button', { name: 'Create PR' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Enter Meta+Enter',
    )
    await expect(composer.getByRole('button', { name: 'Open PR in browser' })).toBeEnabled()
    await composer.getByRole('button', { name: 'Create PR' }).click()
    // A real push is hard-bounded at 120 seconds. Keep the E2E bound above that product contract
    // so a loaded runner cannot report a still-valid in-flight action as a failure.
    await expect(composer).toHaveCount(0, { timeout: NATIVE_CHANGE_REQUEST_TIMEOUT_MS })
    await expect
      .poll(() =>
        execFileSync('git', ['branch', '--show-current'], {
          cwd: fixture.projectPath,
          encoding: 'utf8',
        }).trim(),
      )
      .toBe('codex/session-summary-github-change-request-2')
    await openSessionSummary(page)
    const outputs = summary.getByRole('button', { name: /Outputs/ })
    if ((await outputs.getAttribute('aria-expanded')) !== 'true') await outputs.click()
    await expect(outputs).toContainText('2')
    await expect(
      summary
        .locator('#session-summary-section-outputs')
        .getByRole('button', { name: GITHUB_CHANGE_REQUEST_TITLE, exact: true }),
    ).toBeVisible()
    const viewRequest = summary.getByRole('button', { name: 'View PR' })
    await expect(viewRequest).toBeVisible({ timeout: 30_000 })
    await viewRequest.click()
    const requestPanel = page.getByRole('region', { name: 'Change request' })
    await expect(requestPanel).toBeVisible()
    await expect(
      requestPanel.getByRole('heading', { name: GITHUB_CHANGE_REQUEST_TITLE }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(requestPanel.getByText('README.md')).toBeVisible()
    await expect(requestPanel.getByText('Unit')).toBeVisible()
    await expect(requestPanel.getByText('passed')).toBeVisible()
    await requestPanel.getByRole('button', { name: 'Refresh change request' }).click()
    await expect(requestPanel.getByRole('button', { name: 'Merge' })).toBeEnabled()
    await requestPanel.getByLabel('Merge method').selectOption('squash')
    await fixture.app.confirmNativeDialogs(0)
    await requestPanel.getByRole('button', { name: 'Merge' }).click()
    await expect(requestPanel.getByText('Merge cancelled.')).toBeVisible()
    await expect(requestPanel.getByRole('button', { name: 'Merge' })).toBeEnabled()
    await fixture.app.confirmNativeDialogs(1)
    await requestPanel.getByRole('button', { name: 'Merge' }).click()
    await expect(requestPanel.getByText('Merge completed.')).toBeVisible({ timeout: 30_000 })
    await expect(requestPanel.getByText('merged', { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        try {
          return await fs.readFile(path.join(fixture.cliBinPath, 'gh-merged'), 'utf8')
        } catch {
          return ''
        }
      })
      .toContain('--squash')
    await requestPanel.getByRole('button', { name: 'Close change request' }).click()
    await expect(requestPanel).toBeHidden()
    await expect(summary).toBeVisible()
  } finally {
    await cleanupChangeRequestFixture(fixture)
  }
})

test('Session Summary creates a complete GitLab draft merge request', async () => {
  test.setTimeout(CHANGE_REQUEST_TEST_TIMEOUT_MS)
  const fixture = await launchChangeRequestFixture({
    prefix: 'openwaggle-session-summary-gitlab-mr-',
    projectName: 'gitlab-change-request-project',
    title: GITLAB_CHANGE_REQUEST_TITLE,
    provider: 'gitlab',
    messageId: 'gitlab-change-request-user',
    messageText: 'Prepare the MR.',
  })

  try {
    const mainWindow = fixture.app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(GITLAB_CHANGE_REQUEST_TITLE)
    const summary = await openSessionSummary(page)
    await expect(summary.getByRole('button', { name: 'Commit or push' })).toBeEnabled({
      timeout: 30_000,
    })
    await expect(summary.getByRole('button', { name: /Changes/ })).toContainText('+2', {
      timeout: 30_000,
    })
    await summary.getByRole('button', { name: 'Create MR' }).click()

    const composer = page.getByRole('dialog', { name: 'Create merge request' })
    await expect(composer).toBeVisible()
    await expect(composer.getByText('New branch → main')).toBeVisible()
    await expect(composer.getByLabel('New branch name')).toHaveValue(
      'codex/session-summary-gitlab-change-request',
    )
    await expect(composer.getByRole('button', { name: 'Create draft MR' })).toBeEnabled({
      timeout: 30_000,
    })
    await expect(composer.getByRole('button', { name: 'Create MR' })).toBeEnabled()
    await expect(
      composer.getByRole('contentinfo').getByText('GitLab CLI ready as openwaggle-e2e.'),
    ).toBeVisible()
    await expect(composer.getByRole('button', { name: 'Open MR in browser' })).toBeEnabled()
    await composer.getByRole('button', { name: 'Create draft MR' }).click()
    await expect(composer).toHaveCount(0, { timeout: NATIVE_CHANGE_REQUEST_TIMEOUT_MS })
    await expect
      .poll(() =>
        execFileSync('git', ['branch', '--show-current'], {
          cwd: fixture.projectPath,
          encoding: 'utf8',
        }).trim(),
      )
      .toBe('codex/session-summary-gitlab-change-request')
    await openSessionSummary(page)
    const outputs = summary.getByRole('button', { name: /Outputs/ })
    if ((await outputs.getAttribute('aria-expanded')) !== 'true') await outputs.click()
    await expect(outputs).toContainText('2')
    await expect(
      summary
        .locator('#session-summary-section-outputs')
        .getByRole('button', { name: GITLAB_CHANGE_REQUEST_TITLE, exact: true }),
    ).toBeVisible()
    const viewRequest = summary.getByRole('button', { name: 'View MR' })
    await expect(viewRequest).toBeVisible({ timeout: 30_000 })
    await viewRequest.click()
    const requestPanel = page.getByRole('region', { name: 'Change request' })
    await expect(requestPanel).toBeVisible()
    await expect(requestPanel.getByRole('heading', { name: 'Merge request' })).toBeVisible()
    await expect(
      requestPanel.getByRole('heading', { name: GITLAB_CHANGE_REQUEST_TITLE }),
    ).toBeVisible()
    await expect(requestPanel.getByText('Pipeline')).toBeVisible()
    await expect(requestPanel.getByText('Mark this merge request ready for review before merging.')).toBeVisible()
    await expect(requestPanel.getByRole('button', { name: 'Merge' })).toBeDisabled()
  } finally {
    await cleanupChangeRequestFixture(fixture)
  }
})

test('Session Summary offers browser fallback when GitHub CLI authentication is missing', async () => {
  test.setTimeout(CHANGE_REQUEST_TEST_TIMEOUT_MS)
  const fixture = await launchChangeRequestFixture({
    prefix: 'openwaggle-session-summary-github-fallback-',
    projectName: 'github-browser-fallback-project',
    title: GITHUB_FALLBACK_TITLE,
    provider: 'github',
    messageId: 'github-browser-fallback-user',
    messageText: 'Prepare the PR in the browser.',
  })

  try {
    const mainWindow = fixture.app.mainWindow()
    const page = mainWindow.page
    await mainWindow.openThread(GITHUB_FALLBACK_TITLE)
    const summary = await openSessionSummary(page)
    await expect(summary.getByRole('button', { name: 'Commit or push' })).toBeEnabled({
      timeout: 30_000,
    })
    await summary.getByRole('button', { name: 'Create PR' }).click()

    const composer = page.getByRole('dialog', { name: 'Create pull request' })
    await expect(composer).toBeVisible()
    await expect(composer.getByRole('alert')).toContainText('GitHub CLI is not authenticated for github.com.')
    await expect(composer.getByRole('button', { name: 'Create draft PR' })).toBeDisabled()
    await expect(composer.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    await expect(composer.getByRole('button', { name: 'Open PR in browser' })).toBeEnabled()
  } finally {
    await cleanupChangeRequestFixture(fixture)
  }
})
