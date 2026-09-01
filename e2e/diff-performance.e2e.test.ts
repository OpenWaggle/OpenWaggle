import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const SESSION_TITLE = 'Large diff performance fixture'
const FILE_COUNT = 80
const LINES_PER_FILE = 200
const FIRST_FRAME_BUDGET_MS = 100
const FIRST_DIFF_BUDGET_MS = 1_500
const LONG_TASK_BUDGET_MS = 50
const HOSTED_CI_LONG_TASK_BUDGET_MS = 125
const OVERSIZED_FILE_LINES = 2_000
const HIGHLIGHT_TIMEOUT_MS = process.platform === 'win32' ? 60_000 : 30_000

function longTaskBudget() {
  // PerformanceObserver durations include time when the hidden Electron process is descheduled.
  // Across exact-head retries, unchanged hosted builds moved 53–101 ms samples between the two
  // diff fixtures while every functional and worker-isolation assertion passed. Keep the 50 ms
  // product contract for local performance runs and bound hosted scheduler jitter separately.
  const isGitHubHostedRunner =
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
  return isGitHubHostedRunner ? HOSTED_CI_LONG_TASK_BUDGET_MS : LONG_TASK_BUDGET_MS
}

function initializeRepository(projectPath: string) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], {
    cwd: projectPath,
    stdio: 'ignore',
  })
}

function sourceFor(fileIndex: number, revision: number) {
  return Array.from(
    { length: LINES_PER_FILE },
    (_, lineIndex) =>
      `export const value_${String(fileIndex)}_${String(lineIndex)}: number = ${String(lineIndex + revision)}\n`,
  ).join('')
}

async function createLargeChangedRepository(projectPath: string) {
  const sourceDirectory = path.join(projectPath, 'src')
  await fs.mkdir(sourceDirectory, { recursive: true })
  initializeRepository(projectPath)
  await Promise.all(
    Array.from({ length: FILE_COUNT }, (_, fileIndex) =>
      fs.writeFile(path.join(sourceDirectory, `file-${String(fileIndex).padStart(3, '0')}.ts`), sourceFor(fileIndex, 0)),
    ),
  )
  execFileSync('git', ['add', '.'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=OpenWaggle E2E',
      '-c',
      'user.email=e2e@openwaggle.dev',
      'commit',
      '--no-gpg-sign',
      '-m',
      'Seed large diff fixture',
    ],
    { cwd: projectPath, stdio: 'ignore' },
  )
  await Promise.all(
    Array.from({ length: FILE_COUNT }, (_, fileIndex) =>
      fs.writeFile(path.join(sourceDirectory, `file-${String(fileIndex).padStart(3, '0')}.ts`), sourceFor(fileIndex, 1)),
    ),
  )
}

async function createOversizedSingleFileRepository(projectPath: string) {
  const sourceDirectory = path.join(projectPath, 'src')
  await fs.mkdir(sourceDirectory, { recursive: true })
  initializeRepository(projectPath)
  const sourcePath = path.join(sourceDirectory, 'oversized.ts')
  const source = (revision: number) =>
    Array.from(
      { length: OVERSIZED_FILE_LINES },
      (_, line) => `export const oversized_${String(line)}: number = ${String(line + revision)}\n`,
    ).join('')
  await fs.writeFile(sourcePath, source(0))
  execFileSync('git', ['add', '.'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=OpenWaggle E2E',
      '-c',
      'user.email=e2e@openwaggle.dev',
      'commit',
      '--no-gpg-sign',
      '-m',
      'Seed oversized diff fixture',
    ],
    { cwd: projectPath, stdio: 'ignore' },
  )
  await fs.writeFile(sourcePath, source(1))
}

test('a large diff gives immediate feedback and keeps rendering off the main thread', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-diff-performance-e2e-')
  const projectPath = path.join(app.userDataDir, 'large-diff-project')

  try {
    await createLargeChangedRepository(projectPath)
    await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [],
    })
    await app.restart()

    const { page } = app.mainWindow()
    const rendererErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    await app.mainWindow().openThread(SESSION_TITLE)
    await page.evaluate(() => {
      const longTasks: number[] = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      }).observe({ type: 'longtask' })
      const NativeWorker = window.Worker
      const workers: string[] = []
      Reflect.set(
        window,
        'Worker',
        new Proxy(NativeWorker, {
          construct(target, args) {
            workers.push(String(args[0]))
            return Reflect.construct(target, args)
          },
        }),
      )
      Reflect.set(window, '__openwaggleDiffLongTasks', longTasks)
      Reflect.set(window, '__openwaggleDiffWorkers', workers)
    })

    const toggle = page.getByRole('button', { name: 'Toggle diff panel' })
    await toggle.evaluate((button) => {
      button.addEventListener(
        'click',
        () => {
          const startedAt = performance.now()
          Reflect.set(window, '__openwaggleDiffStartedAt', startedAt)
          requestAnimationFrame(() => {
            Reflect.set(window, '__openwaggleDiffFirstFrameMs', performance.now() - startedAt)
          })
          const observer = new MutationObserver(() => {
            if (document.querySelector('.diff-scroll code') === null) return
            Reflect.set(window, '__openwaggleDiffReadyMs', performance.now() - startedAt)
            observer.disconnect()
          })
          observer.observe(document.body, { childList: true, subtree: true })
        },
        { once: true },
      )
    })
    await toggle.click()

    // The responsive sidebar is docked on wide viewports and a sheet on narrower/DPI-scaled
    // ones. Assert against their shared visible panel contract rather than one layout shell.
    const diffPanel = page.locator('[data-right-sidebar-panel="true"]')
    if (process.platform !== 'darwin') {
      await expect(
        diffPanel.getByLabel('Loading').or(diffPanel.locator('.diff-scroll code').first()).first(),
      ).toBeVisible({ timeout: FIRST_DIFF_BUDGET_MS })
    }
    await expect(diffPanel.locator('.diff-scroll code').first()).toBeVisible({
      timeout: HIGHLIGHT_TIMEOUT_MS,
    })
    const measurements = await page.evaluate(() => {
      const longTasks = Reflect.get(window, '__openwaggleDiffLongTasks')
      const workers = Reflect.get(window, '__openwaggleDiffWorkers')
      const startedAt = Number(Reflect.get(window, '__openwaggleDiffStartedAt'))
      const recordedReadyMs = Number(Reflect.get(window, '__openwaggleDiffReadyMs'))
      return {
        firstFrameMs: Number(Reflect.get(window, '__openwaggleDiffFirstFrameMs')),
        readyMs: Number.isFinite(recordedReadyMs) ? recordedReadyMs : performance.now() - startedAt,
        longTasks: Array.isArray(longTasks)
          ? longTasks.filter((duration): duration is number => typeof duration === 'number')
          : [],
        workers: Array.isArray(workers)
          ? workers.filter((url): url is string => typeof url === 'string')
          : [],
      }
    })

    // Hidden Chromium throttles requestAnimationFrame and worker startup under Xvfb and on
    // Windows. There the strict 1.5 s gate applies to visible loading feedback or an already
    // highlighted result, while the eventual result must remain free of long tasks. macOS owns
    // the highlighted gate.
    if (process.platform === 'darwin') {
      expect(measurements.firstFrameMs).toBeLessThan(FIRST_FRAME_BUDGET_MS)
    }
    if (process.platform === 'darwin') {
      expect(measurements.readyMs).toBeLessThan(FIRST_DIFF_BUDGET_MS)
    }
    expect(Math.max(0, ...measurements.longTasks)).toBeLessThanOrEqual(
      longTaskBudget(),
    )
    expect(measurements.workers).toHaveLength(1)
    expect(measurements.workers[0]).toContain('/assets/worker-')
    expect(rendererErrors).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('a single oversized patch is parsed off the renderer thread', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-oversized-diff-e2e-')
  const projectPath = path.join(app.userDataDir, 'oversized-diff-project')

  try {
    await createOversizedSingleFileRepository(projectPath)
    await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [],
    })
    await app.restart()

    const { page } = app.mainWindow()
    const rendererErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    await app.mainWindow().openThread(SESSION_TITLE)
    await page.evaluate(() => {
      const longTasks: number[] = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      }).observe({ type: 'longtask' })
      const NativeWorker = window.Worker
      const workers: string[] = []
      Reflect.set(
        window,
        'Worker',
        new Proxy(NativeWorker, {
          construct(target, args) {
            workers.push(String(args[0]))
            return Reflect.construct(target, args)
          },
        }),
      )
      Reflect.set(window, '__openwaggleDiffLongTasks', longTasks)
      Reflect.set(window, '__openwaggleDiffWorkers', workers)
    })

    await page.getByRole('button', { name: 'Toggle diff panel' }).click()
    const diffPanel = page.locator('[data-right-sidebar-panel="true"]')
    if (process.platform !== 'darwin') {
      await expect(
        diffPanel.getByLabel('Loading').or(diffPanel.locator('.diff-scroll code').first()).first(),
      ).toBeVisible({ timeout: FIRST_DIFF_BUDGET_MS })
    }
    await expect(diffPanel.locator('.diff-scroll code').first()).toBeVisible({
      timeout: HIGHLIGHT_TIMEOUT_MS,
    })
    const measurements = await page.evaluate(() => ({
      longTasks: Reflect.get(window, '__openwaggleDiffLongTasks'),
      workers: Reflect.get(window, '__openwaggleDiffWorkers'),
    }))
    const longTasks = Array.isArray(measurements.longTasks)
      ? measurements.longTasks.filter((duration): duration is number => typeof duration === 'number')
      : []
    const workers = Array.isArray(measurements.workers)
      ? measurements.workers.filter((url): url is string => typeof url === 'string')
      : []

    expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(longTaskBudget())
    expect(workers.some((url) => url.includes('/assets/diff-parser.worker-'))).toBe(true)
    expect(workers.some((url) => url.includes('/assets/worker-'))).toBe(true)
    expect(rendererErrors).toEqual([])
  } finally {
    await app.cleanup()
  }
})
