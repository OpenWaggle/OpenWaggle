import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { rendererLongTaskBudget } from './support/performance-budgets'
import { seedSingleSession } from './support/session-fixtures'

const SESSION_TITLE = 'Large diff performance fixture'
const FILE_COUNT = 80
const LINES_PER_FILE = 200
const FIRST_FEEDBACK_BUDGET_MS = 100
const FIRST_DIFF_BUDGET_MS = 1_500
const OVERSIZED_FILE_LINES = 2_000
const LONG_TASK_CALIBRATION_MS = 75
const HIGHLIGHT_TIMEOUT_MS =
  process.platform === 'win32' || process.env.CI !== 'true' ? 60_000 : 30_000
const ENFORCE_HIGHLIGHT_READY_BUDGET = process.platform === 'darwin' && process.env.CI === 'true'

interface LongTaskMeasurement {
  readonly startTime: number
  readonly duration: number
}

function overlappingLongTaskDurations(
  entries: readonly LongTaskMeasurement[],
  startedAt: number,
  endedAt: number,
) {
  return entries.flatMap((entry) =>
    entry.startTime < endedAt && entry.startTime + entry.duration > startedAt
      ? [entry.duration]
      : [],
  )
}

async function installDiffPerformanceObserver(page: Page) {
  await page.evaluate(() => {
    const longTasks: Array<{ startTime: number; duration: number }> = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ startTime: entry.startTime, duration: entry.duration })
      }
    })
    observer.observe({ type: 'longtask' })

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
    Reflect.set(window, '__openwaggleDiffPerformanceObserver', observer)
    Reflect.set(window, '__openwaggleDiffWorkers', workers)
  })
}

async function verifyClickTaskAttribution(page: Page) {
  const calibration = await page.evaluate(async (blockDurationMs) => {
    const button = document.createElement('button')
    document.body.append(button)
    let startedAt = 0
    let endedAt = 0
    button.addEventListener(
      'click',
      () => {
        startedAt = performance.now()
        const blockUntil = startedAt + blockDurationMs
        while (performance.now() < blockUntil) {
          // Deliberately keep this browser task busy so the observer contract is tested end to end.
        }
        endedAt = performance.now()
      },
      { capture: true, once: true },
    )
    button.click()
    button.remove()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))

    const rawLongTasks = Reflect.get(window, '__openwaggleDiffLongTasks')
    const performanceObserver = Reflect.get(window, '__openwaggleDiffPerformanceObserver')
    if (!Array.isArray(rawLongTasks) || !(performanceObserver instanceof PerformanceObserver)) {
      throw new Error('Diff long-task observer was not installed.')
    }
    for (const entry of performanceObserver.takeRecords()) {
      rawLongTasks.push({ startTime: entry.startTime, duration: entry.duration })
    }
    const entries = rawLongTasks.flatMap((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('startTime' in entry) ||
        !('duration' in entry)
      ) {
        return []
      }
      const startTime = Number(entry.startTime)
      const duration = Number(entry.duration)
      return Number.isFinite(startTime) && Number.isFinite(duration)
        ? [{ startTime, duration }]
        : []
    })
    rawLongTasks.length = 0
    return { entries, startedAt, endedAt }
  }, LONG_TASK_CALIBRATION_MS)

  expect(
    overlappingLongTaskDurations(calibration.entries, calibration.startedAt, calibration.endedAt),
  ).not.toEqual([])
}

/** Start when the renderer receives the click so Playwright dispatch latency stays outside it. */
async function armDiffRenderMeasurement(toggle: Locator) {
  await toggle.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        const startedAt = performance.now()
        Reflect.set(window, '__openwaggleDiffStartedAt', startedAt)
        Reflect.deleteProperty(window, '__openwaggleDiffReadyAt')
        Reflect.deleteProperty(window, '__openwaggleDiffPreparationCompleteAt')
        Reflect.deleteProperty(window, '__openwaggleDiffFirstFeedbackAt')
        const observer = new MutationObserver(() => {
          if (
            Reflect.get(window, '__openwaggleDiffFirstFeedbackAt') === undefined &&
            document.querySelector('[data-right-sidebar-panel="true"]') !== null
          ) {
            Reflect.set(window, '__openwaggleDiffFirstFeedbackAt', performance.now())
          }
          if (
            Reflect.get(window, '__openwaggleDiffReadyAt') === undefined &&
            document.querySelector('[data-diff-code-ready="true"]') !== null
          ) {
            Reflect.set(window, '__openwaggleDiffReadyAt', performance.now())
          }
          if (
            Reflect.get(window, '__openwaggleDiffPreparationCompleteAt') === undefined &&
            document.querySelector('[data-diff-preparation-complete="true"]') !== null
          ) {
            Reflect.set(window, '__openwaggleDiffPreparationCompleteAt', performance.now())
          }
          if (
            Reflect.get(window, '__openwaggleDiffReadyAt') !== undefined &&
            Reflect.get(window, '__openwaggleDiffPreparationCompleteAt') !== undefined
          ) {
            observer.disconnect()
          }
        })
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-diff-code-ready', 'data-diff-preparation-complete'],
          childList: true,
          subtree: true,
        })
      },
      { capture: true, once: true },
    )
  })
}

async function readDiffRenderMeasurements(page: Page) {
  // PerformanceObserver callbacks run asynchronously. Give the callback one renderer turn after
  // the highlighted surface and progressive parser finish, then drain pending entries.
  await page.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
  const measurements = await page.evaluate(() => {
    const rawLongTasks = Reflect.get(window, '__openwaggleDiffLongTasks')
    const performanceObserver = Reflect.get(window, '__openwaggleDiffPerformanceObserver')
    const rawWorkers = Reflect.get(window, '__openwaggleDiffWorkers')
    const startedAt = Number(Reflect.get(window, '__openwaggleDiffStartedAt'))
    const firstFeedbackAt = Number(Reflect.get(window, '__openwaggleDiffFirstFeedbackAt'))
    const recordedReadyAt = Number(Reflect.get(window, '__openwaggleDiffReadyAt'))
    const preparationCompleteAt = Number(
      Reflect.get(window, '__openwaggleDiffPreparationCompleteAt'),
    )
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(firstFeedbackAt) ||
      !Number.isFinite(recordedReadyAt) ||
      !Number.isFinite(preparationCompleteAt)
    ) {
      throw new Error('Diff performance measurement window was not recorded.')
    }
    if (!Array.isArray(rawLongTasks) || !(performanceObserver instanceof PerformanceObserver)) {
      throw new Error('Diff long-task observer was not installed.')
    }
    for (const entry of performanceObserver.takeRecords()) {
      rawLongTasks.push({ startTime: entry.startTime, duration: entry.duration })
    }
    performanceObserver.disconnect()
    const longTaskEntries = rawLongTasks.flatMap((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('startTime' in entry) ||
        !('duration' in entry)
      ) {
        return []
      }
      const startTime = Number(entry.startTime)
      const duration = Number(entry.duration)
      return Number.isFinite(startTime) && Number.isFinite(duration)
        ? [{ startTime, duration }]
        : []
    })
    const workers = Array.isArray(rawWorkers)
      ? rawWorkers.filter((url): url is string => typeof url === 'string')
      : []
    return {
      firstFeedbackMs: firstFeedbackAt - startedAt,
      readyMs: recordedReadyAt - startedAt,
      preparationMs: preparationCompleteAt - startedAt,
      measurementEndedAt: Math.max(recordedReadyAt, preparationCompleteAt),
      startedAt,
      longTaskEntries,
      workers,
    }
  })
  return {
    ...measurements,
    longTasks: overlappingLongTaskDurations(
      measurements.longTaskEntries,
      measurements.startedAt,
      measurements.measurementEndedAt,
    ),
  }
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
    await installDiffPerformanceObserver(page)
    await verifyClickTaskAttribution(page)

    const toggle = page.getByRole('button', { name: 'Toggle diff panel' })
    await armDiffRenderMeasurement(toggle)
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
    await expect(diffPanel.locator('[data-diff-preparation-complete="true"]')).toBeAttached({
      timeout: HIGHLIGHT_TIMEOUT_MS,
    })
    const measurements = await readDiffRenderMeasurements(page)

    // Hidden Chromium throttles requestAnimationFrame and worker startup under Xvfb and on
    // Windows. A loaded developer machine can deschedule the worker too, so calibrated Darwin CI
    // owns the 1.5 s highlighted-result gate. Local Darwin still enforces the panel's immediate
    // loading feedback and the stricter 50 ms main-thread budget. Measure the DOM commit rather
    // than requestAnimationFrame scheduling, which can itself be delayed by another Electron
    // process when this stress test runs with multiple workers.
    if (process.platform === 'darwin') {
      expect(measurements.firstFeedbackMs).toBeLessThan(FIRST_FEEDBACK_BUDGET_MS)
    }
    if (ENFORCE_HIGHLIGHT_READY_BUDGET) {
      expect(measurements.readyMs).toBeLessThan(FIRST_DIFF_BUDGET_MS)
    }
    expect(Math.max(0, ...measurements.longTasks)).toBeLessThanOrEqual(rendererLongTaskBudget())
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
    await installDiffPerformanceObserver(page)

    const toggle = page.getByRole('button', { name: 'Toggle diff panel' })
    await armDiffRenderMeasurement(toggle)
    await toggle.click()
    const diffPanel = page.locator('[data-right-sidebar-panel="true"]')
    if (process.platform !== 'darwin') {
      await expect(
        diffPanel.getByLabel('Loading').or(diffPanel.locator('.diff-scroll code').first()).first(),
      ).toBeVisible({ timeout: FIRST_DIFF_BUDGET_MS })
    }
    await expect(diffPanel.locator('.diff-scroll code').first()).toBeVisible({
      timeout: HIGHLIGHT_TIMEOUT_MS,
    })
    await expect(diffPanel.locator('[data-diff-preparation-complete="true"]')).toBeAttached({
      timeout: HIGHLIGHT_TIMEOUT_MS,
    })
    const measurements = await readDiffRenderMeasurements(page)

    expect(Math.max(0, ...measurements.longTasks)).toBeLessThanOrEqual(rendererLongTaskBudget())
    expect(measurements.workers.some((url) => url.includes('/assets/diff-parser.worker-'))).toBe(
      true,
    )
    expect(measurements.workers.some((url) => url.includes('/assets/worker-'))).toBe(true)
    expect(rendererErrors).toEqual([])
  } finally {
    await app.cleanup()
  }
})
