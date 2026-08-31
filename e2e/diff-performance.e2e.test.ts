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

    const diffPanel = page.locator('aside[data-right-sidebar-shell="true"]')
    await expect(diffPanel.locator('.diff-scroll code').first()).toBeVisible({
      timeout: 30_000,
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

    // Hidden Chromium throttles requestAnimationFrame under Xvfb and on Windows, so a frame
    // timestamp there describes the virtual display scheduler rather than renderer work. The
    // macOS job owns the absolute paint gate; every platform still enforces ready time, long
    // tasks, worker isolation, and renderer errors below.
    if (process.platform === 'darwin') {
      expect(measurements.firstFrameMs).toBeLessThan(FIRST_FRAME_BUDGET_MS)
    }
    expect(measurements.readyMs).toBeLessThan(FIRST_DIFF_BUDGET_MS)
    expect(Math.max(0, ...measurements.longTasks)).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS)
    expect(measurements.workers).toHaveLength(1)
    expect(measurements.workers[0]).toContain('/assets/worker-')
    expect(rendererErrors).toEqual([])
  } finally {
    await app.cleanup()
  }
})
