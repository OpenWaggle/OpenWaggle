import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SYNTAX_SOURCE_CODE_UNITS } from '../syntax-admission'
import { SyntaxService } from '../syntax-service'
import {
  highlightedResponse,
  highlightMessages,
  IMPORTED_LANGUAGE,
  MockWorker,
} from './syntax-service-test-helpers'

describe('SyntaxService scheduling and recovery', () => {
  beforeEach(() => {
    MockWorker.instances = []
    vi.stubGlobal('Worker', MockWorker)
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('dispatches visible queued work before background work', async () => {
    const service = new SyntaxService()
    const first = service.highlight({
      source: 'first',
      language: 'typescript',
      theme: 'dark-plus',
      priority: 'background',
    })
    const background = service.highlight({
      source: 'background',
      language: 'typescript',
      theme: 'dark-plus',
      priority: 'background',
    })
    const queuedBackground = service.highlight({
      source: 'queued background',
      language: 'typescript',
      theme: 'dark-plus',
      priority: 'background',
    })
    const visible = service.highlight({
      source: 'visible',
      language: 'typescript',
      theme: 'dark-plus',
      priority: 'visible',
    })
    const worker = MockWorker.instances[0]
    const secondWorker = MockWorker.instances[1]
    if (!worker || !secondWorker) throw new Error('Expected two syntax workers.')
    const firstRequest = highlightMessages(worker)[0]
    if (firstRequest?.type !== 'highlight') throw new Error('Expected a request.')
    worker.emitMessage(highlightedResponse(firstRequest.requestId))
    await first

    expect(highlightMessages(worker).map((message) => message.source)).toEqual(['first', 'visible'])
    const visibleRequest = highlightMessages(worker)[1]
    if (visibleRequest?.type !== 'highlight') throw new Error('Expected visible work.')
    worker.emitMessage(highlightedResponse(visibleRequest.requestId))
    await visible
    const queuedBackgroundRequest = highlightMessages(worker)[2]
    if (queuedBackgroundRequest?.type !== 'highlight') throw new Error('Expected queued work.')
    worker.emitMessage(highlightedResponse(queuedBackgroundRequest.requestId))
    await queuedBackground
    const backgroundRequest = highlightMessages(secondWorker)[0]
    if (backgroundRequest?.type !== 'highlight') throw new Error('Expected background work.')
    secondWorker.emitMessage(highlightedResponse(backgroundRequest.requestId))
    await background
    service.dispose()
  })

  it('does not construct a worker for source outside the central admission budget', async () => {
    const service = new SyntaxService()
    await expect(
      service.highlight({
        source: 'x'.repeat(MAX_SYNTAX_SOURCE_CODE_UNITS + 1),
        language: 'typescript',
        theme: 'dark-plus',
      }),
    ).resolves.toMatchObject({ status: 'plain-text', diagnostic: expect.stringContaining('1 MiB') })
    expect(MockWorker.instances).toHaveLength(0)
    service.dispose()
  })

  it('bounds concurrent syntax work to the configured two-worker pool', async () => {
    const service = new SyntaxService()
    const first = service.highlight({
      source: 'first stream',
      language: 'typescript',
      theme: 'dark-plus',
    })
    const second = service.highlight({
      source: 'second stream',
      language: 'typescript',
      theme: 'dark-plus',
    })
    const worker = MockWorker.instances[0]
    const secondWorker = MockWorker.instances[1]
    const firstRequest = worker ? highlightMessages(worker)[0] : undefined
    const secondRequest = secondWorker ? highlightMessages(secondWorker)[0] : undefined
    if (
      !worker ||
      !secondWorker ||
      firstRequest?.type !== 'highlight' ||
      secondRequest?.type !== 'highlight'
    ) {
      throw new Error('Expected bounded concurrent work.')
    }
    expect(MockWorker.instances).toHaveLength(2)
    worker.emitMessage(highlightedResponse(firstRequest.requestId))
    secondWorker.emitMessage(highlightedResponse(secondRequest.requestId))
    await first
    await second
    expect(MockWorker.instances).toHaveLength(2)
    service.dispose()
  })

  it('terminates active syntax work when its request is cancelled', async () => {
    const service = new SyntaxService()
    const controller = new AbortController()
    const result = service.highlight({
      source: 'const value = 1',
      language: 'typescript',
      theme: 'dark-plus',
      signal: controller.signal,
    })
    const worker = MockWorker.instances[0]
    if (!worker) throw new Error('Expected a syntax worker.')
    controller.abort()
    await expect(result).resolves.toMatchObject({
      status: 'plain-text',
      diagnostic: expect.stringContaining('cancelled'),
    })
    expect(worker.terminated).toBe(true)
    service.dispose()
  })

  it('treats ordinary request cancellation as silent control flow', async () => {
    const service = new SyntaxService()
    service.registerLanguages([IMPORTED_LANGUAGE])
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController()
      const result = service.highlight({
        source: `cancel ${String(attempt)}`,
        language: 'test-language',
        theme: 'dark-plus',
        signal: controller.signal,
      })
      const worker = MockWorker.instances.at(-1)
      if (!worker) throw new Error('Expected a syntax worker.')
      controller.abort()
      await expect(result).resolves.toMatchObject({
        status: 'plain-text',
        diagnostic: expect.stringContaining('cancelled'),
      })
      expect(worker.terminated).toBe(true)
    }
    expect(console.warn).not.toHaveBeenCalled()

    const recovered = service.highlight({
      source: 'still available',
      language: 'test-language',
      theme: 'dark-plus',
    })
    const worker = MockWorker.instances.at(-1)
    const request = worker ? highlightMessages(worker).at(-1) : undefined
    if (!worker || request?.type !== 'highlight') throw new Error('Expected recovered work.')
    worker.emitMessage(highlightedResponse(request.requestId))
    await expect(recovered).resolves.toMatchObject({ status: 'highlighted' })
    service.dispose()
  })

  it('serves warm results from the bounded result cache', async () => {
    const service = new SyntaxService()
    const input = { source: 'cached', language: 'typescript', theme: 'dark-plus' }
    const first = service.highlight(input)
    const worker = MockWorker.instances[0]
    const request = worker ? highlightMessages(worker)[0] : undefined
    if (!worker || !request || request.type !== 'highlight') throw new Error('Expected work.')
    worker.emitMessage(highlightedResponse(request.requestId))
    await first
    const messageCount = worker.messages.length

    await expect(service.highlight(input)).resolves.toMatchObject({ status: 'highlighted' })
    expect(worker.messages).toHaveLength(messageCount)
    service.dispose()
  })

  it('never reuses tokens for exact sources that share a fingerprint', async () => {
    const service = new SyntaxService()
    const firstSource = '0537sct0ahpmv61uuq4vu'
    const secondSource = '13qjvss0v8q2d810n1d6f'
    const first = service.highlight({
      source: firstSource,
      sourceFingerprint: 'xtvf5p',
      language: 'typescript',
      theme: 'dark-plus',
    })
    const second = service.highlight({
      source: secondSource,
      sourceFingerprint: 'xtvf5p',
      language: 'typescript',
      theme: 'dark-plus',
    })
    const firstWorker = MockWorker.instances[0]
    const secondWorker = MockWorker.instances[1]
    const firstRequest = firstWorker ? highlightMessages(firstWorker)[0] : undefined
    const secondRequest = secondWorker ? highlightMessages(secondWorker)[0] : undefined
    if (
      !firstWorker ||
      !secondWorker ||
      firstRequest?.type !== 'highlight' ||
      secondRequest?.type !== 'highlight'
    ) {
      throw new Error('Expected independent collision requests.')
    }
    expect(firstRequest.sourceKey).not.toBe(secondRequest.sourceKey)
    expect(firstRequest.source).toBe(firstSource)
    expect(secondRequest.source).toBe(secondSource)
    firstWorker.emitMessage(highlightedResponse(firstRequest.requestId))
    secondWorker.emitMessage(highlightedResponse(secondRequest.requestId))
    await Promise.all([first, second])
    service.dispose()
  })

  it('removes abort listeners after a request settles', async () => {
    const service = new SyntaxService()
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const result = service.highlight({
      source: 'listener cleanup',
      language: 'typescript',
      theme: 'dark-plus',
      signal: controller.signal,
    })
    const worker = MockWorker.instances[0]
    const request = worker ? highlightMessages(worker)[0] : undefined
    if (!worker || request?.type !== 'highlight') throw new Error('Expected work.')
    worker.emitMessage(highlightedResponse(request.requestId))
    await result

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    service.dispose()
  })

  it('falls back to plain text when worker construction fails', async () => {
    class FailingWorker {
      constructor() {
        throw new Error('worker unavailable')
      }
    }
    vi.stubGlobal('Worker', FailingWorker)
    const service = new SyntaxService()

    await expect(
      service.highlight({
        source: 'fallback',
        language: 'typescript',
        theme: 'dark-plus',
      }),
    ).resolves.toMatchObject({
      status: 'plain-text',
      diagnostic: expect.stringContaining('could not be started'),
    })
    service.dispose()
  })
})
