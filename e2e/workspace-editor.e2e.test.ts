import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { rendererLongTaskBudget, syntaxCompletionTimeout } from './support/performance-budgets'
import { seedSingleSession } from './support/session-fixtures'

const SESSION_TITLE = 'Workspace review and focused edit fixture'
const RENDERER_HEARTBEAT_BUDGET_MS = 250
const RENDERER_HEARTBEAT_SAMPLE_COUNT = 5
const STRESS_EDIT_COUNT = 200
const CI_SOURCE_SURFACE_BUDGET_MS = 2_500

function observeRendererErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function sourceSurfaceBudget(localBudgetMs: number) {
  // Hosted runners can deschedule the Electron process for over a second while
  // parallel jobs compete for CPU. Keep local budgets strict; the separately
  // calibrated long-task assertion below remains the responsiveness contract.
  return process.env.CI ? CI_SOURCE_SURFACE_BUDGET_MS : localBudgetMs
}

function platformModifier() {
  return process.platform === 'darwin' ? ('Meta' as const) : ('Control' as const)
}

async function openWorkspaceFile(
  page: Page,
  relativePath: string,
  beforeOpen?: () => Promise<void>,
) {
  await page.keyboard.press(`${platformModifier()}+p`)
  const search = page.getByRole('textbox', { name: 'Search project files' })
  await expect(search).toBeVisible()
  await search.fill(relativePath)
  const result = page.getByRole('button').filter({ hasText: relativePath })
  await expect(result).toBeVisible()
  await beforeOpen?.()
  await result.click()
  await expect(page.getByRole('region', { name: `Source for ${relativePath}` })).toBeVisible()
}

async function moveCursorToDocumentEnd(page: Page) {
  if (process.platform === 'darwin') await page.keyboard.press('Meta+ArrowDown')
  else await page.keyboard.press('Control+End')
}

function loadedLegacyEditorResources(page: Page) {
  return page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((resource) => /monaco|ts\.worker/iu.test(resource)),
  )
}

async function installWorkerCounter(page: Page) {
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    const createdWorkers: string[] = []
    const syntaxSourceTransfers: number[] = []
    const syntaxSourceKeys: string[] = []
    const trackingWorker = new Proxy(NativeWorker, {
      construct(target, args) {
        createdWorkers.push(String(args[0]))
        const worker = Reflect.construct(target, args)
        return new Proxy(worker, {
          get(workerTarget, property) {
            if (property === 'postMessage') {
              return (message: unknown, transferOrOptions?: StructuredSerializeOptions) => {
                if (
                  typeof message === 'object' &&
                  message !== null &&
                  Reflect.get(message, 'type') === 'highlight'
                ) {
                  const source = Reflect.get(message, 'source')
                  syntaxSourceTransfers.push(typeof source === 'string' ? source.length : 0)
                  syntaxSourceKeys.push(String(Reflect.get(message, 'sourceKey')))
                }
                workerTarget.postMessage(message, transferOrOptions)
              }
            }
            const value: unknown = Reflect.get(workerTarget, property, workerTarget)
            return typeof value === 'function' ? value.bind(workerTarget) : value
          },
        })
      },
    })
    Reflect.set(window, '__openwaggleE2eCreatedWorkers', createdWorkers)
    Reflect.set(window, '__openwaggleE2eSyntaxSourceTransfers', syntaxSourceTransfers)
    Reflect.set(window, '__openwaggleE2eSyntaxSourceKeys', syntaxSourceKeys)
    Reflect.set(window, 'Worker', trackingWorker)
  })
}

function createdWorkerCount(page: Page) {
  return page.evaluate(() => {
    const value = Reflect.get(window, '__openwaggleE2eCreatedWorkers')
    return Array.isArray(value) ? value.length : 0
  })
}

function syntaxSourceTransfers(page: Page) {
  return page.evaluate(() => {
    const value = Reflect.get(window, '__openwaggleE2eSyntaxSourceTransfers')
    return Array.isArray(value)
      ? value.filter((entry): entry is number => typeof entry === 'number')
      : []
  })
}

function syntaxSourceKeys(page: Page) {
  return page.evaluate(() => {
    const value = Reflect.get(window, '__openwaggleE2eSyntaxSourceKeys')
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : []
  })
}

async function beginSourceSurfaceMeasurement(page: Page, label: string) {
  await page.evaluate(
    (targetLabel) => {
      const startedAt = performance.now()
      const recordIfMounted = () => {
        const target = [...document.querySelectorAll('[aria-label]')].find(
          (element) => element.getAttribute('aria-label') === targetLabel,
        )
        if (!target?.hasAttribute('data-syntax-status')) return false
        Reflect.set(window, '__openwaggleE2eSourceSurfaceMs', performance.now() - startedAt)
        Reflect.set(
          window,
          '__openwaggleE2eFirstSyntaxStatus',
          target.getAttribute('data-syntax-status'),
        )
        Reflect.set(
          window,
          '__openwaggleE2eFirstSyntaxSkeleton',
          target.querySelector('[data-syntax-skeleton]') !== null,
        )
        return true
      }
      const observer = new MutationObserver(() => {
        if (recordIfMounted()) observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      recordIfMounted()
    },
    label,
  )
}

async function installLongTaskObserver(page: Page) {
  await page.evaluate(() => {
    const durations: number[] = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration)
    })
    // Measure only the file-open and viewport work below. Buffered entries can
    // include Electron startup and command-palette work that happened before
    // this observer existed, which does not describe single-file performance.
    observer.observe({ type: 'longtask' })
    Reflect.set(window, '__openwaggleE2eLongTasks', durations)
  })
}

async function rendererHeartbeatSamples(page: Page) {
  return page.evaluate(
    (sampleCount) =>
      new Promise<number[]>((resolve) => {
        const channel = new MessageChannel()
        const samples: number[] = []
        let previous = performance.now()
        channel.port1.onmessage = () => {
          const timestamp = performance.now()
          samples.push(timestamp - previous)
          previous = timestamp
          if (samples.length >= sampleCount) {
            channel.port1.close()
            channel.port2.close()
            resolve(samples)
            return
          }
          channel.port2.postMessage(null)
        }
        channel.port2.postMessage(null)
      }),
    RENDERER_HEARTBEAT_SAMPLE_COUNT,
  )
}

async function observedLongTasks(page: Page) {
  return page.evaluate(() => {
    const value = Reflect.get(window, '__openwaggleE2eLongTasks')
    return Array.isArray(value)
      ? value.filter((duration): duration is number => typeof duration === 'number')
      : []
  })
}

test('workspace files stay review-first, edit reliably on demand, and remain responsive', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-workspace-editor-e2e-')
  const projectPath = path.join(app.userDataDir, 'workspace-editor-project')
  const mainPath = path.join(projectPath, 'src', 'main.ts')

  try {
    await fs.mkdir(path.dirname(mainPath), { recursive: true })
    await Promise.all([
      fs.writeFile(
        path.join(projectPath, 'src', 'math.ts'),
        'export function double(value: number) {\n  return value * 2\n}\n',
      ),
      fs.writeFile(
        mainPath,
        "import { double } from './math'\nexport const result = double(21)\n",
      ),
    ])
    await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [],
    })
    await app.restart()

    const { page } = app.mainWindow()
    const rendererErrors = observeRendererErrors(page)
    await app.mainWindow().openThread(SESSION_TITLE)
    await installWorkerCounter(page)
    await openWorkspaceFile(page, 'src/main.ts', () =>
      beginSourceSurfaceMeasurement(page, 'Source for src/main.ts'),
    )

    const source = page.getByRole('region', { name: 'Source for src/main.ts' })
    expect(
      await page.evaluate(() => Number(Reflect.get(window, '__openwaggleE2eSourceSurfaceMs'))),
    ).toBeLessThan(sourceSurfaceBudget(100))
    await expect(source).toHaveAttribute('data-syntax-language', 'typescript')
    await expect(source).toHaveAttribute('data-syntax-status', 'highlighted')
    const reviewTheme = await source.getAttribute('data-syntax-theme')
    expect(reviewTheme).not.toBeNull()
    await expect(page.locator('[aria-label="Edit src/main.ts"]')).toHaveCount(0)
    const workspaceNavigator = page.getByRole('complementary', { name: 'Workspace navigator' })
    await expect(workspaceNavigator).toBeVisible()
    const [sourceBounds, navigatorBounds] = await Promise.all([
      source.boundingBox(),
      workspaceNavigator.boundingBox(),
    ])
    expect(sourceBounds).not.toBeNull()
    expect(navigatorBounds).not.toBeNull()
    expect(navigatorBounds?.x).toBeGreaterThan(sourceBounds?.x ?? Number.POSITIVE_INFINITY)

    const navigatorToggle = page.getByRole('button', { name: 'Toggle workspace navigator' })
    await navigatorToggle.click()
    await expect(workspaceNavigator).toHaveCount(0)
    await expect(source).toBeVisible()
    await navigatorToggle.click()
    await expect(workspaceNavigator).toBeVisible()
    const reviewWorkerCount = await createdWorkerCount(page)

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const editorSurface = page.locator('[aria-label="Edit src/main.ts"]')
    const editor = editorSurface.locator('[contenteditable="true"]')
    await expect(editorSurface).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(editorSurface).toHaveAttribute('data-syntax-theme', reviewTheme ?? '')
    await expect.poll(() => createdWorkerCount(page)).toBeGreaterThan(reviewWorkerCount)

    await editor.focus()
    await moveCursorToDocumentEnd(page)
    await page.keyboard.insertText('export const firstSave = result\n')
    await page.keyboard.press(`${platformModifier()}+s`)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await expect.poll(() => fs.readFile(mainPath, 'utf8')).toContain('export const firstSave = result')

    await page.waitForTimeout(750)
    await editor.focus()
    await moveCursorToDocumentEnd(page)
    await page.keyboard.insertText('export const afterWatcherRefresh = firstSave\n')
    await page.keyboard.press(`${platformModifier()}+s`)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await expect
      .poll(() => fs.readFile(mainPath, 'utf8'))
      .toContain('export const afterWatcherRefresh = firstSave')

    await editor.focus()
    await moveCursorToDocumentEnd(page)
    await installLongTaskObserver(page)
    const stressEdit = Array.from(
      { length: STRESS_EDIT_COUNT },
      (_, index) => `// edit ${String(index)}\n`,
    ).join('')
    await page.keyboard.insertText(stressEdit)
    await page.keyboard.press(`${platformModifier()}+s`)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await expect.poll(() => fs.readFile(mainPath, 'utf8')).toContain('// edit 199')

    // Hidden Electron throttles animation frames on Linux and Windows, so use MessageChannel turns
    // to measure the event loop itself. The median tolerates one runner descheduling spike, while
    // the long-task observer below still fails actual main-thread blocks caused by editing/saving.
    const heartbeatSamples = await rendererHeartbeatSamples(page)
    const medianHeartbeatMs = [...heartbeatSamples].sort((left, right) => left - right)[
      Math.floor(heartbeatSamples.length / 2)
    ]
    expect(medianHeartbeatMs).toBeLessThan(RENDERER_HEARTBEAT_BUDGET_MS)
    expect(Math.max(0, ...(await observedLongTasks(page)))).toBeLessThanOrEqual(
      rendererLongTaskBudget(),
    )

    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(source).toBeVisible()
    await expect(source).toContainText('afterWatcherRefresh = firstSave')

    await page.keyboard.press(`${platformModifier()}+g`)
    await page.getByRole('textbox', { name: 'Line number' }).fill('2')
    await page.keyboard.press('Enter')
    await expect(source.locator('[data-line-number="2"]')).toHaveClass(/bg-accent\/10/u)

    await page.reload()
    const reloadedSource = page.getByRole('region', { name: 'Source for src/main.ts' })
    await expect(reloadedSource).toBeVisible()
    await expect(reloadedSource).toContainText('afterWatcherRefresh = firstSave')
    await expect(page.locator('[aria-label="Edit src/main.ts"]')).toHaveCount(0)
    expect(await loadedLegacyEditorResources(page)).toEqual([])
    expect(rendererErrors).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('a 1 MiB source file paints a skeleton before tokenization and keeps bounded work', async () => {
  test.setTimeout(90_000 + syntaxCompletionTimeout())
  const app = await OpenWaggleApp.launch('openwaggle-workspace-large-file-e2e-')
  const projectPath = path.join(app.userDataDir, 'workspace-large-file-project')
  const relativePath = 'src/large.ts'
  const line = 'export const value: number = 42\n'
  const source = line.repeat(Math.ceil((1024 * 1024) / line.length)).slice(0, 1024 * 1024)

  try {
    await fs.mkdir(path.join(projectPath, 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, relativePath), source)
    await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [],
    })
    await app.restart()

    const { page } = app.mainWindow()
    const rendererErrors = observeRendererErrors(page)
    await app.mainWindow().openThread(SESSION_TITLE)
    await installWorkerCounter(page)
    await page.keyboard.press(`${platformModifier()}+p`)
    const search = page.getByRole('textbox', { name: 'Search project files' })
    await search.fill(relativePath)
    const result = page.getByRole('button').filter({ hasText: relativePath })
    await expect(result).toBeVisible()
    await installLongTaskObserver(page)
    await beginSourceSurfaceMeasurement(page, `Source for ${relativePath}`)
    await result.click()

    const sourceView = page.getByRole('region', { name: `Source for ${relativePath}` })
    await expect(sourceView).toBeVisible()
    const sourceSurfaceMs = await page.evaluate(() =>
      Number(Reflect.get(window, '__openwaggleE2eSourceSurfaceMs')),
    )
    expect(sourceSurfaceMs).toBeLessThan(sourceSurfaceBudget(200))
    expect(await sourceView.locator('[data-line-number]').count()).toBeLessThanOrEqual(130)
    const firstSyntaxPaint = await page.evaluate(() => ({
      status: Reflect.get(window, '__openwaggleE2eFirstSyntaxStatus'),
      hasSkeleton: Reflect.get(window, '__openwaggleE2eFirstSyntaxSkeleton'),
    }))
    expect(firstSyntaxPaint).toEqual({ status: 'loading', hasSkeleton: true })
    await expect(sourceView).toHaveAttribute('data-syntax-status', 'highlighted', {
      timeout: syntaxCompletionTimeout(),
    })
    await expect(sourceView).toContainText('export const value')

    const scrollSurface = sourceView.locator('.syntax-typography')
    for (const position of [0.2, 0.4, 0.6, 0.8]) {
      const transferCountBeforeScroll = (await syntaxSourceTransfers(page)).length
      const previousLineOffset = Number(
        await sourceView.getAttribute('data-syntax-line-offset'),
      )
      await scrollSurface.evaluate((element, ratio) => {
        element.scrollTop = element.scrollHeight * ratio
        element.dispatchEvent(new Event('scroll'))
      }, position)
      await expect
        .poll(async () => (await syntaxSourceTransfers(page)).length)
        .toBeGreaterThan(transferCountBeforeScroll)
      await expect(sourceView).toHaveAttribute('data-syntax-status', 'highlighted', {
        timeout: syntaxCompletionTimeout(),
      })
      await expect
        .poll(async () => Number(await sourceView.getAttribute('data-syntax-line-offset')))
        .toBeGreaterThan(previousLineOffset)
    }
    const sourceTransfers = await syntaxSourceTransfers(page)
    const sourceKeys = await syntaxSourceKeys(page)
    expect(await createdWorkerCount(page)).toBeLessThanOrEqual(2)
    expect(new Set(sourceKeys).size).toBe(1)
    expect(sourceTransfers.filter((size) => size === source.length)).toHaveLength(1)
    expect(sourceTransfers.filter((size) => size === 0).length).toBeGreaterThanOrEqual(4)

    const longTasks = await observedLongTasks(page)
    expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(rendererLongTaskBudget())
    await expect(page.locator(`[aria-label="Edit ${relativePath}"]`)).toHaveCount(0)
    expect(rendererErrors).toEqual([])
  } finally {
    await app.cleanup()
  }
})
