import type {
  SyntaxLanguageResource,
  SyntaxThemeRegistration,
} from '@shared/types/syntax-resources'
import { createRendererLogger } from '@/shared/lib/logger'
import {
  plainSyntaxResult,
  type SyntaxHighlightRequest,
  type SyntaxHighlightResult,
  type SyntaxWorkerResponse,
} from './protocol'
import {
  compareSyntaxQueuedRequests,
  resolveSyntaxQueuedRequest,
  type SyntaxQueuedRequest,
  SyntaxResultCache,
  syntaxRequestCacheKey,
  syntaxWorkerCount,
} from './syntax-cache'
import { SyntaxLanguageQuarantine } from './syntax-language-quarantine'
import { SyntaxSourceState } from './syntax-source-state'
import { dispatchSyntaxWorkerRequest } from './syntax-worker-dispatch'
import { createSyntaxWorkerSlot } from './syntax-worker-factory'
import {
  nextSyntaxQueueIndex,
  shouldCreateSyntaxWorkerSlot,
  takeSupersededSyntaxViewportRequests,
} from './syntax-worker-scheduler'
import {
  clearSyntaxWorkerSlotTimer,
  rememberSyntaxWorkerSource,
  retireSyntaxWorkerSlot,
  type SyntaxWorkerSlot,
} from './syntax-worker-slot'

const logger = createRendererLogger('syntax-service')

export class SyntaxService {
  private readonly cache = new SyntaxResultCache()
  private readonly sourceState = new SyntaxSourceState()
  private readonly queue: SyntaxQueuedRequest[] = []
  private readonly slots: SyntaxWorkerSlot[] = []
  private nextRequestId = 1
  private readonly importedThemes = new Map<string, SyntaxThemeRegistration>()
  private readonly importedLanguages = new Map<string, SyntaxLanguageResource>()
  private readonly languageQuarantine = new SyntaxLanguageQuarantine()

  highlight(input: SyntaxHighlightRequest): Promise<SyntaxHighlightResult> {
    const languageRevision =
      this.importedLanguages.get(input.language.toLowerCase())?.revision ?? 'bundled'
    const { sourceKey, admission } = this.sourceState.resolve(input, languageRevision)
    if (!admission.admitted) {
      return Promise.resolve(plainSyntaxResult({ ...input, diagnostic: admission.diagnostic }))
    }
    if (this.languageQuarantine.isQuarantined(input.language)) {
      return Promise.resolve(
        plainSyntaxResult({
          ...input,
          diagnostic: 'This imported grammar was disabled after repeated worker failures.',
        }),
      )
    }
    const cacheKey = syntaxRequestCacheKey(sourceKey, input.lineRange)
    const cached = this.cache.get(cacheKey, input.source)
    if (cached) return Promise.resolve(cached)
    if (input.signal?.aborted) {
      return Promise.resolve(
        plainSyntaxResult({ ...input, diagnostic: 'Syntax request was cancelled.' }),
      )
    }
    if (typeof Worker === 'undefined') {
      return Promise.resolve(
        plainSyntaxResult({ ...input, diagnostic: 'Syntax worker is unavailable.' }),
      )
    }

    return new Promise((resolve) => {
      const queued: SyntaxQueuedRequest = {
        requestId: this.nextRequestId,
        input,
        cacheKey,
        sourceKey,
        resolve,
        enqueuedAt: performance.now(),
        abortListener: null,
      }
      this.nextRequestId += 1
      for (const superseded of takeSupersededSyntaxViewportRequests(this.queue, queued)) {
        resolveSyntaxQueuedRequest(
          superseded,
          plainSyntaxResult({
            ...superseded.input,
            diagnostic: 'Syntax request was superseded.',
          }),
        )
      }
      this.queue.push(queued)
      this.queue.sort(compareSyntaxQueuedRequests)
      if (input.signal) {
        queued.abortListener = () => this.cancel(queued)
        input.signal.addEventListener('abort', queued.abortListener, { once: true })
      }
      this.dispatch()
    })
  }
  clearCache() {
    this.cache.clear()
    this.sourceState.clear()
  }
  registerThemes(themes: readonly SyntaxThemeRegistration[]) {
    this.importedThemes.clear()
    for (const theme of themes) {
      this.importedThemes.set(theme.name, theme)
    }
    this.cache.clear()
    this.sourceState.clear()
    for (const slot of this.slots) {
      slot.knownSourceKeys.clear()
      slot.worker.postMessage({ type: 'register-themes', themes })
    }
  }
  registerLanguages(languages: readonly SyntaxLanguageResource[]) {
    this.languageQuarantine.register(languages)
    this.importedLanguages.clear()
    for (const language of languages) {
      for (const identity of [language.languageId, ...language.registration.aliases]) {
        const key = identity.toLowerCase()
        this.importedLanguages.set(key, language)
      }
    }
    this.cache.clear()
    this.sourceState.clear()
    for (const slot of this.slots) {
      slot.knownSourceKeys.clear()
      slot.worker.postMessage({ type: 'register-languages', languages })
    }
  }
  dispose() {
    for (const slot of this.slots) {
      if (slot.timeout !== null) window.clearTimeout(slot.timeout)
      slot.worker.terminate()
      if (slot.current) {
        resolveSyntaxQueuedRequest(
          slot.current,
          plainSyntaxResult({ ...slot.current.input, diagnostic: 'Syntax service disposed.' }),
        )
      }
    }
    this.slots.length = 0
    for (const queued of this.queue.splice(0)) {
      resolveSyntaxQueuedRequest(
        queued,
        plainSyntaxResult({ ...queued.input, diagnostic: 'Syntax service disposed.' }),
      )
    }
  }

  private makeSlot(): SyntaxWorkerSlot {
    const themes = [...this.importedThemes.values()]
    const languages = [
      ...new Map(
        [...this.importedLanguages.values()].map((language) => [language.id, language]),
      ).values(),
    ]
    return createSyntaxWorkerSlot({
      themes,
      languages,
      onResponse: (slot, response) => this.complete(slot, response),
      onFailure: (slot, message) => this.failSlot(slot, message),
    })
  }

  private dispatch() {
    while (shouldCreateSyntaxWorkerSlot(this.slots, this.queue, syntaxWorkerCount())) {
      try {
        this.slots.push(this.makeSlot())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Could not start syntax worker', { message })
        for (const queued of this.queue.splice(0)) {
          resolveSyntaxQueuedRequest(
            queued,
            plainSyntaxResult({
              ...queued.input,
              diagnostic: 'Syntax worker could not be started.',
            }),
          )
        }
        return
      }
    }
    for (const slot of this.slots) {
      if (slot.current) continue
      while (!slot.current && this.queue.length > 0) {
        const availableIndex = nextSyntaxQueueIndex(this.slots, slot, this.queue)
        if (availableIndex < 0) break
        const [next] = this.queue.splice(availableIndex, 1)
        if (!next) continue
        if (next.input.signal?.aborted) {
          resolveSyntaxQueuedRequest(
            next,
            plainSyntaxResult({ ...next.input, diagnostic: 'Syntax request was cancelled.' }),
          )
          continue
        }
        slot.current = next
        dispatchSyntaxWorkerRequest(slot, false, (message) => this.failSlot(slot, message))
      }
    }
  }

  private cancel(request: SyntaxQueuedRequest) {
    const queueIndex = this.queue.indexOf(request)
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1)
      resolveSyntaxQueuedRequest(
        request,
        plainSyntaxResult({ ...request.input, diagnostic: 'Syntax request was cancelled.' }),
      )
      return
    }
    const slot = this.slots.find((candidate) => candidate.current === request)
    if (slot) this.cancelSlot(slot)
  }

  private cancelSlot(slot: SyntaxWorkerSlot) {
    const current = retireSyntaxWorkerSlot(this.slots, slot)
    if (current) {
      resolveSyntaxQueuedRequest(
        current,
        plainSyntaxResult({ ...current.input, diagnostic: 'Syntax request was cancelled.' }),
      )
    }
    this.dispatch()
  }

  private complete(slot: SyntaxWorkerSlot, response: SyntaxWorkerResponse) {
    const current = slot.current
    if (!current || current.requestId !== response.requestId) return
    if (response.type === 'language-validated') {
      this.failSlot(slot, 'Syntax worker returned an unexpected response.')
      return
    }
    if (response.type === 'source-required') {
      if (slot.currentSourceSent) {
        this.failSlot(slot, 'Syntax worker rejected the supplied source.')
        return
      }
      slot.knownSourceKeys.delete(current.sourceKey)
      dispatchSyntaxWorkerRequest(slot, true, (message) => this.failSlot(slot, message))
      return
    }
    clearSyntaxWorkerSlotTimer(slot)
    slot.current = null
    if (response.type === 'highlighted') {
      if (response.retainedSourceKeys) {
        slot.knownSourceKeys.clear()
        for (const sourceKey of response.retainedSourceKeys) slot.knownSourceKeys.add(sourceKey)
      } else {
        rememberSyntaxWorkerSource(slot, current.sourceKey)
      }
      this.languageQuarantine.recordSuccess(current.input.language)
      this.cache.set(current.cacheKey, current.input.source, response.result)
      resolveSyntaxQueuedRequest(current, response.result)
      this.dispatch()
      return
    }
    if (response.type !== 'failed') {
      this.failSlot(slot, 'Syntax worker returned an unexpected response.')
      return
    }
    this.languageQuarantine.recordFailure(current.input.language)
    resolveSyntaxQueuedRequest(
      current,
      plainSyntaxResult({ ...current.input, diagnostic: response.message }),
    )
    this.dispatch()
  }

  private failSlot(slot: SyntaxWorkerSlot, message: string) {
    const current = retireSyntaxWorkerSlot(this.slots, slot)
    if (current) {
      this.languageQuarantine.recordFailure(current.input.language)
      logger.warn('Syntax worker request failed', {
        language: current.input.language,
        message,
      })
      resolveSyntaxQueuedRequest(
        current,
        plainSyntaxResult({ ...current.input, diagnostic: message }),
      )
    }
    this.dispatch()
  }
}

export const syntaxService = new SyntaxService()
