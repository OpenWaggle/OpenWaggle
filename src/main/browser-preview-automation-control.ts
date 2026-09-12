import { randomUUID } from 'node:crypto'
import type { BrowserPreviewControllerState } from '@shared/types/browser-preview'
import type {
  BrowserPreviewAutomationActionEvent,
  BrowserPreviewAutomationConsoleEntry,
  BrowserPreviewAutomationNetworkEntry,
} from '@shared/types/browser-preview-automation'
import type { WebContents } from 'electron'
import {
  appendBrowserPreviewAutomationAction,
  browserPreviewAutomationActionError,
  replaceBrowserPreviewAutomationAction,
} from './browser-preview-automation-action-timeline'
import { browserPreviewCdpEvaluationValue } from './browser-preview-automation-cdp-result'
import {
  BrowserPreviewAutomationDeadline,
  type BrowserPreviewAutomationRunOptions,
} from './browser-preview-automation-deadline'
import { ensureBrowserPreviewAutomationDebugger } from './browser-preview-automation-debugger'
import {
  sendBrowserPreviewAutomationInputCleanup,
  withExpectedBrowserPreviewAutomationInput,
} from './browser-preview-automation-input-dispatch'
import {
  type BrowserPreviewAutomationControlSession as ControlSession,
  createBrowserPreviewAutomationControlSession,
  disposeBrowserPreviewAutomationControlSession,
  interruptBrowserPreviewAutomationControlSession,
  setBrowserPreviewAutomationController,
  updateBrowserPreviewAutomationPointer,
} from './browser-preview-automation-session'
import { playwrightInjectedRuntimeInstallExpression } from './browser-preview-playwright-runtime'

export interface BrowserPreviewAutomationPage {
  readonly tabId: string
  readonly contents: WebContents
  readonly onControllerChange?: (state: BrowserPreviewControllerState) => void
}

export interface BrowserPreviewAutomationActionContext {
  readonly signal: AbortSignal
  readonly remainingTimeMs: () => number
  readonly send: (method: string, params?: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly dispatchInput: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>
  /** Cleanup after a partially dispatched input, even when human input invalidated the action. */
  readonly cleanupInput: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>
  readonly evaluate: (
    expression: string,
    options?: { readonly awaitPromise?: boolean; readonly returnByValue?: boolean },
  ) => Promise<unknown>
  readonly ensurePlaywright: () => Promise<void>
  readonly documentGeneration: () => number
  readonly assertCurrentDocument: () => void
  readonly consoleEntries: () => readonly BrowserPreviewAutomationConsoleEntry[]
  readonly networkEntries: () => readonly BrowserPreviewAutomationNetworkEntry[]
  readonly actionTimeline: () => readonly BrowserPreviewAutomationActionEvent[]
}

export class BrowserPreviewAutomationDocumentChangedError extends Error {
  constructor() {
    super('Browser preview action was interrupted by page navigation.')
    this.name = 'BrowserPreviewAutomationDocumentChangedError'
  }
}

export interface BrowserPreviewAutomationControlRunOptions
  extends BrowserPreviewAutomationRunOptions {
  readonly allowDocumentChanges?: boolean
}

export class BrowserPreviewAutomationController {
  private readonly sessions = new Map<string, ControlSession>()

  run<A>(
    page: BrowserPreviewAutomationPage,
    actionName: string,
    use: (context: BrowserPreviewAutomationActionContext) => Promise<A>,
    options: BrowserPreviewAutomationControlRunOptions = {},
  ): Promise<A> {
    const deadline = new BrowserPreviewAutomationDeadline(options)
    let session: ControlSession
    try {
      session = this.getOrCreateSession(page)
    } catch (cause) {
      deadline.dispose()
      return Promise.reject(cause)
    }
    const boundedOperation = session.tail.then(() =>
      this.runExclusive(session, actionName, use, deadline, options.allowDocumentChanges ?? false),
    )
    session.tail = boundedOperation.then(
      () => undefined,
      () => undefined,
    )
    return deadline.race(boundedOperation).finally(() => deadline.dispose())
  }

  dispose(tabId: string) {
    const session = this.sessions.get(tabId)
    if (!session) return
    this.sessions.delete(tabId)
    disposeBrowserPreviewAutomationControlSession(session)
  }

  sendControl(
    page: BrowserPreviewAutomationPage,
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) {
    return this.run(page, `control:${method}`, (context) => context.send(method, params))
  }

  releaseForDevTools(tabId: string) {
    this.dispose(tabId)
  }

  private getOrCreateSession(page: BrowserPreviewAutomationPage) {
    const existing = this.sessions.get(page.tabId)
    if (existing?.contents === page.contents && !existing.disposed) return existing
    if (existing) this.dispose(existing.tabId)
    const session = createBrowserPreviewAutomationControlSession(page, (tabId) =>
      this.dispose(tabId),
    )
    this.sessions.set(page.tabId, session)
    return session
  }

  private async send(
    session: ControlSession,
    epoch: number,
    documentGeneration: number,
    deadline: BrowserPreviewAutomationDeadline,
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) {
    deadline.throwIfAborted()
    if (session.disposed || session.epoch !== epoch) {
      throw new Error('Browser preview action was interrupted by human input or tab disposal.')
    }
    if (session.documentGeneration !== documentGeneration) {
      throw new BrowserPreviewAutomationDocumentChangedError()
    }
    await deadline.race(ensureBrowserPreviewAutomationDebugger(session))
    deadline.throwIfAborted()
    if (session.disposed || session.epoch !== epoch) {
      throw new Error('Browser preview action was interrupted by human input or tab disposal.')
    }
    if (session.documentGeneration !== documentGeneration) {
      throw new BrowserPreviewAutomationDocumentChangedError()
    }
    const response: unknown = await deadline.race(session.debugger.sendCommand(method, params))
    if (session.disposed || session.epoch !== epoch) {
      throw new Error('Browser preview action was interrupted by human input or tab disposal.')
    }
    if (session.documentGeneration !== documentGeneration) {
      throw new BrowserPreviewAutomationDocumentChangedError()
    }
    return response
  }

  private actionContext(
    session: ControlSession,
    epoch: number,
    documentGeneration: number,
    deadline: BrowserPreviewAutomationDeadline,
    allowDocumentChanges: boolean,
  ): BrowserPreviewAutomationActionContext {
    const send = (method: string, params?: Readonly<Record<string, unknown>>) => {
      const commandDocumentGeneration = allowDocumentChanges
        ? session.documentGeneration
        : documentGeneration
      return this.send(session, epoch, commandDocumentGeneration, deadline, method, params)
    }
    return {
      signal: deadline.signal,
      remainingTimeMs: () => deadline.remainingMs(),
      send,
      dispatchInput: (method, params) => {
        updateBrowserPreviewAutomationPointer(session, params)
        return withExpectedBrowserPreviewAutomationInput(session, method, params, () =>
          send(method, params),
        )
      },
      cleanupInput: (method, params) =>
        withExpectedBrowserPreviewAutomationInput(session, method, params, () =>
          sendBrowserPreviewAutomationInputCleanup(session, method, params),
        ),
      evaluate: async (expression, options) =>
        browserPreviewCdpEvaluationValue(
          await send('Runtime.evaluate', {
            expression,
            awaitPromise: options?.awaitPromise ?? true,
            returnByValue: options?.returnByValue ?? true,
            userGesture: true,
            timeout: deadline.remainingMs(),
          }),
        ),
      ensurePlaywright: async () => {
        const installed = await send('Runtime.evaluate', {
          expression: 'Boolean(globalThis.__openWagglePlaywrightInjected)',
          returnByValue: true,
        })
        if (browserPreviewCdpEvaluationValue(installed) === true) return
        browserPreviewCdpEvaluationValue(
          await send('Runtime.evaluate', {
            expression: await deadline.race(playwrightInjectedRuntimeInstallExpression()),
            returnByValue: true,
            timeout: deadline.remainingMs(),
          }),
        )
      },
      documentGeneration: () => session.documentGeneration,
      assertCurrentDocument: () => {
        if (session.documentGeneration !== documentGeneration) {
          throw new BrowserPreviewAutomationDocumentChangedError()
        }
      },
      consoleEntries: () => [...session.diagnostics.consoleEntries],
      networkEntries: () => [...session.diagnostics.networkEntries],
      actionTimeline: () => [...session.timeline],
    }
  }

  private async runExclusive<A>(
    session: ControlSession,
    actionName: string,
    use: (context: BrowserPreviewAutomationActionContext) => Promise<A>,
    deadline: BrowserPreviewAutomationDeadline,
    allowDocumentChanges: boolean,
  ) {
    deadline.throwIfAborted()
    const action: BrowserPreviewAutomationActionEvent = {
      id: `browser-action-${randomUUID()}`,
      action: actionName,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    appendBrowserPreviewAutomationAction(session.timeline, action)
    const epoch = session.epoch
    const documentGeneration = session.documentGeneration
    const agentControlled = !actionName.startsWith('control:')
    if (agentControlled) {
      setBrowserPreviewAutomationController(session, {
        kind: 'agent',
        action: actionName,
        pointer: null,
      })
    }
    const interrupt = () => interruptBrowserPreviewAutomationControlSession(session)
    deadline.signal.addEventListener('abort', interrupt, { once: true })
    let previousBackgroundThrottling: boolean | undefined
    let backgroundThrottlingChanged = false
    try {
      previousBackgroundThrottling = session.contents.getBackgroundThrottling()
      session.contents.setBackgroundThrottling(false)
      backgroundThrottlingChanged = true
      const result = await deadline.race(
        Promise.resolve().then(() => {
          deadline.throwIfAborted()
          return use(
            this.actionContext(session, epoch, documentGeneration, deadline, allowDocumentChanges),
          )
        }),
      )
      deadline.throwIfAborted()
      if (session.disposed || session.epoch !== epoch) {
        throw new Error('Browser preview action was interrupted by human input or tab disposal.')
      }
      if (!allowDocumentChanges && session.documentGeneration !== documentGeneration) {
        throw new BrowserPreviewAutomationDocumentChangedError()
      }
      replaceBrowserPreviewAutomationAction(session.timeline, {
        ...action,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
      })
      return result
    } catch (error) {
      replaceBrowserPreviewAutomationAction(session.timeline, {
        ...action,
        status:
          session.epoch === epoch &&
          (allowDocumentChanges || session.documentGeneration === documentGeneration)
            ? 'failed'
            : 'interrupted',
        completedAt: new Date().toISOString(),
        error: browserPreviewAutomationActionError(error),
      })
      throw error
    } finally {
      deadline.signal.removeEventListener('abort', interrupt)
      if (agentControlled) setBrowserPreviewAutomationController(session, { kind: 'human' })
      if (
        backgroundThrottlingChanged &&
        previousBackgroundThrottling !== undefined &&
        !session.contents.isDestroyed()
      ) {
        try {
          session.contents.setBackgroundThrottling(previousBackgroundThrottling)
        } catch {
          // Teardown must not replace the action's authoritative result.
        }
      }
    }
  }
}

export const browserPreviewAutomationController = new BrowserPreviewAutomationController()
