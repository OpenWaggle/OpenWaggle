import type {
  Event,
  RenderProcessGoneDetails,
  WebContentsDidStartNavigationEventParams,
  WebContentsWillRedirectEventParams,
} from 'electron'
import type {
  BrowserPreviewAutomationNavigationOperation,
  BrowserPreviewNavigationWaitInput,
  BrowserPreviewNavigationWebContents,
} from './browser-preview-automation-navigation'

const ABORTED_NAVIGATION_ERROR_CODE = -3

interface ActiveNavigationWait {
  readonly supersede: () => void
}

const activeNavigationWaits = new WeakMap<
  BrowserPreviewNavigationWebContents,
  ActiveNavigationWait
>()

function navigationCancelled() {
  return new Error('Browser preview navigation was cancelled.')
}

function navigationSuperseded() {
  return new Error('Browser preview navigation was superseded by another navigation.')
}

function normalizedUrl(value: string) {
  try {
    return new URL(value).href
  } catch {
    return value
  }
}

function isAbortedNavigationError(cause: unknown) {
  if (typeof cause === 'object' && cause !== null) {
    const code: unknown = Reflect.get(cause, 'code')
    const errno: unknown = Reflect.get(cause, 'errno')
    if (code === 'ERR_ABORTED' || errno === ABORTED_NAVIGATION_ERROR_CODE) return true
  }
  return cause instanceof Error && cause.message.includes('ERR_ABORTED')
}

function navigationDetails(
  details: Event<WebContentsDidStartNavigationEventParams | WebContentsWillRedirectEventParams>,
  legacyUrl: string,
  legacyIsInPlace: boolean,
  legacyIsMainFrame: boolean,
) {
  return {
    url: typeof details.url === 'string' ? details.url : legacyUrl,
    isSameDocument:
      typeof details.isSameDocument === 'boolean' ? details.isSameDocument : legacyIsInPlace,
    isMainFrame: typeof details.isMainFrame === 'boolean' ? details.isMainFrame : legacyIsMainFrame,
  }
}

class BrowserPreviewNavigationWait {
  private settled = false
  private started = false
  private redirected = false
  private readinessReached = false
  private completionReached = false
  private sameDocumentCompleted = false
  private operation: BrowserPreviewAutomationNavigationOperation | undefined
  private readonly acceptedUrls: Set<string>
  private timeout: ReturnType<typeof setTimeout> | undefined
  private resolve: () => void = () => undefined
  private reject: (error: Error) => void = () => undefined
  private readonly activeWait: ActiveNavigationWait = {
    supersede: () => this.finish(navigationSuperseded()),
  }

  constructor(private readonly input: BrowserPreviewNavigationWaitInput) {
    this.acceptedUrls = new Set([normalizedUrl(input.url)])
  }

  run() {
    return new Promise<void>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
      this.timeout = setTimeout(
        () =>
          this.stopAndFinish(
            new Error(
              `Browser preview navigation timed out after ${String(this.input.timeoutMs)} ms.`,
            ),
          ),
        this.input.timeoutMs,
      )
      this.timeout.unref()
      activeNavigationWaits.get(this.input.contents)?.supersede()
      activeNavigationWaits.set(this.input.contents, this.activeWait)
      this.addListeners()
      this.startNavigation()
    })
  }

  private startNavigation() {
    try {
      this.operation = this.input.navigate()
    } catch (cause) {
      this.finish(cause instanceof Error ? cause : new Error(String(cause)))
      return
    }
    if (!this.operation.isCurrent()) {
      this.finish(navigationSuperseded())
      return
    }
    if (this.input.readiness === 'none') this.finish()
    else this.finishIfReady()
    void this.operation.completion.then(
      () => {
        this.completionReached = true
        this.finishIfReady()
      },
      (cause: unknown) => this.handleLoadError(cause),
    )
  }

  private addListeners() {
    const { contents, readiness, signal } = this.input
    contents.on('did-start-navigation', this.onStarted)
    contents.on('did-navigate-in-page', this.onInPage)
    contents.on('will-redirect', this.onRedirect)
    if (readiness === 'load') contents.on('did-finish-load', this.onReady)
    else contents.on('dom-ready', this.onReady)
    contents.on('did-fail-load', this.onFailed)
    contents.on('render-process-gone', this.onGone)
    contents.on('destroyed', this.onDestroyed)
    signal?.addEventListener('abort', this.onAbort, { once: true })
  }

  private cleanup() {
    const { contents, readiness, signal } = this.input
    if (this.timeout) clearTimeout(this.timeout)
    contents.removeListener('did-start-navigation', this.onStarted)
    contents.removeListener('did-navigate-in-page', this.onInPage)
    contents.removeListener('will-redirect', this.onRedirect)
    if (readiness === 'load') contents.removeListener('did-finish-load', this.onReady)
    else contents.removeListener('dom-ready', this.onReady)
    contents.removeListener('did-fail-load', this.onFailed)
    contents.removeListener('render-process-gone', this.onGone)
    contents.removeListener('destroyed', this.onDestroyed)
    signal?.removeEventListener('abort', this.onAbort)
    if (activeNavigationWaits.get(contents) === this.activeWait) {
      activeNavigationWaits.delete(contents)
    }
  }

  private finish(error?: Error) {
    if (this.settled) return
    this.settled = true
    this.cleanup()
    if (error) this.reject(error)
    else this.resolve()
  }

  private stopAndFinish(error: Error) {
    const activeOperation = this.operation
    const shouldStop = activeOperation?.isCurrent() === true
    this.finish(error)
    if (!shouldStop) return
    try {
      activeOperation.stop()
    } catch {
      // The requested failure is authoritative even when teardown races tab destruction.
    }
  }

  private finishIfReady() {
    if (!this.operation || !this.started) return
    if (!this.operation.isCurrent()) {
      this.finish(navigationSuperseded())
      return
    }
    const ready =
      this.input.readiness === 'none' ||
      (this.input.readiness === 'load'
        ? this.completionReached || this.readinessReached
        : this.readinessReached)
    if (!ready) return
    if (this.sameDocumentCompleted) {
      this.finish()
      return
    }
    if (!this.currentUrlIsAccepted()) {
      this.finish(navigationSuperseded())
      return
    }
    this.finish()
  }

  private currentUrlIsAccepted() {
    return this.acceptedUrls.has(normalizedUrl(this.input.contents.getURL()))
  }

  private sameDocumentNavigation(url: string) {
    if (!this.acceptedUrls.has(url)) {
      this.finish(navigationSuperseded())
      return
    }
    this.started = true
    this.completionReached = true
    this.readinessReached = true
    this.sameDocumentCompleted = true
    this.finishIfReady()
  }

  private handleLoadError(cause: unknown) {
    if (this.settled) return
    if (this.operation && !this.operation.isCurrent()) {
      this.finish(navigationSuperseded())
      return
    }
    if (this.input.signal?.aborted) {
      this.stopAndFinish(navigationCancelled())
      return
    }
    if (isAbortedNavigationError(cause)) {
      if (!this.redirected) this.finish(navigationSuperseded())
      return
    }
    this.finish(cause instanceof Error ? cause : new Error(String(cause)))
  }

  private readonly onStarted = (
    details: Event<WebContentsDidStartNavigationEventParams>,
    legacyUrl: string,
    legacyIsInPlace: boolean,
    legacyIsMainFrame: boolean,
  ) => {
    const navigation = navigationDetails(details, legacyUrl, legacyIsInPlace, legacyIsMainFrame)
    if (!navigation.isMainFrame) return
    const url = normalizedUrl(navigation.url)
    if (navigation.isSameDocument) {
      this.sameDocumentNavigation(url)
      return
    }
    if (!this.started && this.acceptedUrls.has(url)) {
      this.started = true
      this.finishIfReady()
      return
    }
    if (!this.acceptedUrls.has(url)) this.finish(navigationSuperseded())
  }

  private readonly onInPage = (_event: Event, url: string, isMainFrame: boolean) => {
    if (isMainFrame) this.sameDocumentNavigation(normalizedUrl(url))
  }

  private readonly onRedirect = (
    details: Event<WebContentsWillRedirectEventParams>,
    legacyUrl: string,
    legacyIsInPlace: boolean,
    legacyIsMainFrame: boolean,
  ) => {
    const navigation = navigationDetails(details, legacyUrl, legacyIsInPlace, legacyIsMainFrame)
    if (!this.started || !navigation.isMainFrame || navigation.isSameDocument) return
    this.redirected = true
    this.acceptedUrls.add(normalizedUrl(navigation.url))
  }

  private readonly onReady = () => {
    if (!this.started) return
    this.readinessReached = true
    this.finishIfReady()
  }

  private readonly onFailed = (
    _event: Event,
    errorCode: number,
    errorDescription: string,
    validatedUrl: string,
    isMainFrame: boolean,
  ) => {
    if (!isMainFrame || !this.acceptedUrls.has(normalizedUrl(validatedUrl))) return
    this.handleLoadError(
      errorCode === ABORTED_NAVIGATION_ERROR_CODE
        ? Object.assign(new Error(errorDescription), {
            code: 'ERR_ABORTED',
            errno: errorCode,
          })
        : new Error(
            `Browser preview navigation failed (${String(errorCode)}): ${errorDescription}`,
          ),
    )
  }

  private readonly onGone = (_event: Event, details: RenderProcessGoneDetails) =>
    this.finish(new Error(`Browser preview process exited during navigation: ${details.reason}.`))

  private readonly onDestroyed = () =>
    this.finish(new Error('Browser preview closed during navigation.'))

  private readonly onAbort = () => this.stopAndFinish(navigationCancelled())
}

export function navigateBrowserPreviewAndWait(input: BrowserPreviewNavigationWaitInput) {
  if (input.signal?.aborted) return Promise.reject(navigationCancelled())
  if (input.contents.isDestroyed()) {
    return Promise.reject(new Error('Browser preview content has been destroyed.'))
  }
  return new BrowserPreviewNavigationWait(input).run()
}
