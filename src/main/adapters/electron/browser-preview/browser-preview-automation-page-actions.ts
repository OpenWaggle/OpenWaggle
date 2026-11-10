import { Buffer } from 'node:buffer'
import { matchBy } from '@diegogbrisa/ts-match'
import type {
  BrowserPreviewAutomationClickInput,
  BrowserPreviewAutomationEvaluateInput,
  BrowserPreviewAutomationPressInput,
  BrowserPreviewAutomationScrollInput,
  BrowserPreviewAutomationTypeInput,
  BrowserPreviewAutomationWaitInput,
} from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import { webContents } from 'electron'
import {
  type BrowserPreviewAutomationActionContext,
  type BrowserPreviewAutomationController,
  BrowserPreviewAutomationDocumentChangedError,
  type BrowserPreviewAutomationPage,
} from './browser-preview-automation-control'
import {
  browserPreviewAutomationDelay,
  throwIfBrowserPreviewAutomationAborted,
} from './browser-preview-automation-delay'
import {
  browserPreviewAutomationLocator,
  browserPreviewClickPointExpression,
  browserPreviewScrollExpression,
  browserPreviewTypeExpression,
  browserPreviewWaitExpression,
} from './browser-preview-automation-dom-expressions'
import { makeBrowserPreviewAutomationKeySequence } from './browser-preview-automation-keyboard'
import {
  assertBrowserPreviewActionOutcome,
  decodeBrowserPreviewActionOutcome,
  decodeBrowserPreviewClickPointOutcome,
  decodeBrowserPreviewViewport,
  decodeBrowserPreviewWaitMatch,
} from './browser-preview-automation-page-results'
import {
  validateBrowserPreviewAutomationClick,
  validateBrowserPreviewAutomationScroll,
  validateBrowserPreviewAutomationTimeout,
  validateBrowserPreviewAutomationType,
  validateBrowserPreviewAutomationWait,
} from './browser-preview-automation-validation'

const WAIT_POLL_INTERVAL_MS = 100
const MAX_KEY_LENGTH = 64

async function ensureLocatorRuntime(
  context: BrowserPreviewAutomationActionContext,
  input: { readonly selector?: string; readonly locator?: string },
) {
  if (browserPreviewAutomationLocator(input) !== null) await context.ensurePlaywright()
}

async function retryBrowserPreviewClickPoint(
  context: BrowserPreviewAutomationActionContext,
  locator: string,
) {
  while (true) {
    const outcome = decodeBrowserPreviewClickPointOutcome(
      await context.evaluate(browserPreviewClickPointExpression(locator)),
    )
    const point = matchBy(outcome, 'kind')
      .with('point', ({ x, y }) => ({ x, y }))
      .with('not-found', () => null)
      .with('invalid-selector', ({ message }) => {
        throw new Error(`Browser preview locator was invalid: ${message}`)
      })
      .exhaustive()
    if (point !== null) return point
    await browserPreviewAutomationDelay(
      Math.min(WAIT_POLL_INTERVAL_MS, context.remainingTimeMs()),
      context.signal,
    )
  }
}

async function retryBrowserPreviewType(
  context: BrowserPreviewAutomationActionContext,
  input: BrowserPreviewAutomationTypeInput,
) {
  while (true) {
    const outcome = decodeBrowserPreviewActionOutcome(
      await context.evaluate(browserPreviewTypeExpression(input)),
    )
    const completed = matchBy(outcome, 'kind')
      .with('ok', () => true)
      .with('not-found', () => false)
      .with('not-editable', () => false)
      .with('invalid-selector', ({ message }) => {
        throw new Error(`Browser preview locator was invalid: ${message}`)
      })
      .exhaustive()
    if (completed) return
    await browserPreviewAutomationDelay(
      Math.min(WAIT_POLL_INTERVAL_MS, context.remainingTimeMs()),
      context.signal,
    )
  }
}

export function clickBrowserPreviewPage(
  controller: BrowserPreviewAutomationController,
  page: BrowserPreviewAutomationPage,
  input: BrowserPreviewAutomationClickInput,
  signal?: AbortSignal,
) {
  validateBrowserPreviewAutomationClick(input)
  const timeoutMs = validateBrowserPreviewAutomationTimeout(input.timeoutMs)
  return controller.run(
    page,
    'click',
    async (context) => {
      await ensureLocatorRuntime(context, input)
      const locator = browserPreviewAutomationLocator(input)
      const point =
        locator === null
          ? { x: input.x ?? 0, y: input.y ?? 0 }
          : await retryBrowserPreviewClickPoint(context, locator)
      const viewport = decodeBrowserPreviewViewport(
        await context.evaluate('({ width: window.innerWidth, height: window.innerHeight })'),
      )
      if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) {
        throw new Error('Browser preview click coordinates are outside the page viewport.')
      }
      try {
        await context.dispatchInput('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...point,
          button: 'left',
          clickCount: 1,
        })
      } finally {
        await context
          .cleanupInput('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            ...point,
            button: 'left',
            clickCount: 1,
          })
          .catch(() => undefined)
      }
    },
    { signal, timeoutMs },
  )
}

export function typeIntoBrowserPreviewPage(
  controller: BrowserPreviewAutomationController,
  page: BrowserPreviewAutomationPage,
  input: BrowserPreviewAutomationTypeInput,
  signal?: AbortSignal,
) {
  validateBrowserPreviewAutomationType(input)
  const timeoutMs = validateBrowserPreviewAutomationTimeout(input.timeoutMs)
  return controller.run(
    page,
    'type',
    async (context) => {
      await ensureLocatorRuntime(context, input)
      await retryBrowserPreviewType(context, input)
    },
    { signal, timeoutMs },
  )
}

export function scrollBrowserPreviewPage(
  controller: BrowserPreviewAutomationController,
  page: BrowserPreviewAutomationPage,
  input: BrowserPreviewAutomationScrollInput,
  signal?: AbortSignal,
) {
  validateBrowserPreviewAutomationScroll(input)
  return controller.run(
    page,
    'scroll',
    async (context) => {
      await ensureLocatorRuntime(context, input)
      assertBrowserPreviewActionOutcome(
        await context.evaluate(browserPreviewScrollExpression(input)),
      )
    },
    { signal },
  )
}

export function evaluateBrowserPreviewPage(
  controller: BrowserPreviewAutomationController,
  page: BrowserPreviewAutomationPage,
  input: BrowserPreviewAutomationEvaluateInput,
  signal?: AbortSignal,
) {
  if (input.expression.trim().length === 0)
    throw new Error('Evaluation expression cannot be blank.')
  if (input.expression.length > BROWSER_PREVIEW_AUTOMATION_LIMITS.EXPRESSION_LENGTH) {
    throw new Error('Evaluation expression exceeded the 64 KB limit.')
  }
  return controller.run(
    page,
    'evaluate',
    async (context) => {
      const value = await context.evaluate(input.expression, input)
      const serialized = JSON.stringify(value)
      if (
        serialized !== undefined &&
        Buffer.byteLength(serialized) > BROWSER_PREVIEW_AUTOMATION_LIMITS.RESULT_BYTES
      ) {
        throw new Error('Browser preview evaluation result exceeded the 64 KB limit.')
      }
      return value
    },
    { signal },
  )
}

export function pressBrowserPreviewKey(
  controller: BrowserPreviewAutomationController,
  page: BrowserPreviewAutomationPage,
  input: BrowserPreviewAutomationPressInput,
  signal?: AbortSignal,
) {
  if (input.key.trim().length === 0 || input.key.length > MAX_KEY_LENGTH) {
    throw new Error('Browser preview key must be a non-empty supported key name.')
  }
  return controller.run(
    page,
    'press',
    async (context) => {
      const sequence = makeBrowserPreviewAutomationKeySequence(input, {
        isMac: process.platform === 'darwin',
      })
      const previous = webContents.getFocusedWebContents()
      let keyDownAttempted = false
      try {
        page.contents.focus()
        await context.send('Page.bringToFront')
        await context.send('Emulation.setFocusEmulationEnabled', { enabled: true })
        keyDownAttempted = true
        await context.dispatchInput('Input.dispatchKeyEvent', sequence.keyDown)
      } finally {
        if (keyDownAttempted) {
          await context
            .cleanupInput('Input.dispatchKeyEvent', sequence.keyUp)
            .catch(() => undefined)
        }
        await context
          .cleanupInput('Emulation.setFocusEmulationEnabled', { enabled: false })
          .catch(() => undefined)
        if (previous && previous.id !== page.contents.id && !previous.isDestroyed())
          previous.focus()
      }
    },
    { signal },
  )
}

export function waitForBrowserPreviewPage(
  controller: BrowserPreviewAutomationController,
  page: BrowserPreviewAutomationPage,
  input: BrowserPreviewAutomationWaitInput,
  signal?: AbortSignal,
) {
  validateBrowserPreviewAutomationWait(input)
  const timeoutMs = validateBrowserPreviewAutomationTimeout(input.timeoutMs)
  return controller.run(
    page,
    'wait-for',
    async (context) => {
      const locator = browserPreviewAutomationLocator(input)
      let locatorRuntimeGeneration: number | null = null
      const deadline = Date.now() + timeoutMs
      while (Date.now() <= deadline) {
        throwIfBrowserPreviewAutomationAborted(context.signal)
        try {
          if (locator !== null && locatorRuntimeGeneration !== context.documentGeneration()) {
            await context.ensurePlaywright()
            locatorRuntimeGeneration = context.documentGeneration()
          }
          if (
            decodeBrowserPreviewWaitMatch(
              await context.evaluate(browserPreviewWaitExpression(input)),
            )
          ) {
            return
          }
        } catch (error) {
          if (!(error instanceof BrowserPreviewAutomationDocumentChangedError)) throw error
          locatorRuntimeGeneration = null
          continue
        }
        await browserPreviewAutomationDelay(WAIT_POLL_INTERVAL_MS, context.signal)
      }
      throw new Error(`Browser preview condition was not met within ${String(timeoutMs)} ms.`)
    },
    { allowDocumentChanges: true, signal, timeoutMs },
  )
}
