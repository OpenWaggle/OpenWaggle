import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyntaxService } from '../syntax-service'
import { highlightedResponse, highlightMessages, MockWorker } from './syntax-service-test-helpers'

describe('SyntaxService viewport scheduling', () => {
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

  it('keeps viewport windows separate while sharing one worker source identity', async () => {
    const service = new SyntaxService()
    const first = service.highlight({
      source: 'first\nsecond\nthird',
      language: 'typescript',
      theme: 'dark-plus',
      lineRange: { start: 0, end: 2 },
    })
    const worker = MockWorker.instances[0]
    const firstRequest = worker ? highlightMessages(worker)[0] : undefined
    if (!worker || firstRequest?.type !== 'highlight') throw new Error('Expected ranged work.')
    expect(firstRequest.lineRange).toEqual({ start: 0, end: 2 })
    worker.emitMessage(highlightedResponse(firstRequest.requestId))
    await first

    const second = service.highlight({
      source: 'first\nsecond\nthird',
      language: 'typescript',
      theme: 'dark-plus',
      lineRange: { start: 1, end: 3 },
    })
    const secondRequest = highlightMessages(worker)[1]
    if (secondRequest?.type !== 'highlight') throw new Error('Expected second ranged work.')
    expect(secondRequest.sourceKey).toBe(firstRequest.sourceKey)
    expect(firstRequest.source).toBe('first\nsecond\nthird')
    expect(secondRequest.source).toBeUndefined()
    expect(secondRequest.lineRange).toEqual({ start: 1, end: 3 })
    worker.emitMessage(highlightedResponse(secondRequest.requestId))
    await second
    service.dispose()
  })

  it('keeps concurrent viewport requests for one source on the same worker', async () => {
    const service = new SyntaxService()
    const input = {
      source: 'first\nsecond\nthird',
      language: 'typescript',
      theme: 'dark-plus',
    }
    const first = service.highlight({ ...input, lineRange: { start: 0, end: 2 } })
    const second = service.highlight({ ...input, lineRange: { start: 1, end: 3 } })
    const worker = MockWorker.instances[0]
    const firstRequest = worker ? highlightMessages(worker)[0] : undefined
    if (!worker || firstRequest?.type !== 'highlight') throw new Error('Expected ranged work.')

    expect(MockWorker.instances).toHaveLength(1)
    expect(highlightMessages(worker)).toHaveLength(1)
    worker.emitMessage(highlightedResponse(firstRequest.requestId))
    await first

    const secondRequest = highlightMessages(worker)[1]
    if (secondRequest?.type !== 'highlight') throw new Error('Expected queued ranged work.')
    expect(secondRequest.sourceKey).toBe(firstRequest.sourceKey)
    expect(secondRequest.source).toBeUndefined()
    worker.emitMessage(highlightedResponse(secondRequest.requestId))
    await second
    service.dispose()
  })

  it('resends source once when the worker has evicted its token cache', async () => {
    const service = new SyntaxService()
    const input = {
      source: 'first\nsecond\nthird',
      sourceFingerprint: 'stable-document-fingerprint',
      language: 'typescript',
      theme: 'dark-plus',
    }
    const first = service.highlight({ ...input, lineRange: { start: 0, end: 1 } })
    const worker = MockWorker.instances[0]
    const firstRequest = worker ? highlightMessages(worker)[0] : undefined
    if (!worker || firstRequest?.type !== 'highlight') throw new Error('Expected ranged work.')
    worker.emitMessage(highlightedResponse(firstRequest.requestId))
    await first

    const second = service.highlight({ ...input, lineRange: { start: 1, end: 2 } })
    const cachedRequest = highlightMessages(worker)[1]
    if (cachedRequest?.type !== 'highlight') throw new Error('Expected cached ranged work.')
    expect(cachedRequest.source).toBeUndefined()

    worker.emitMessage({ type: 'source-required', requestId: cachedRequest.requestId })
    const retryRequest = highlightMessages(worker)[2]
    if (retryRequest?.type !== 'highlight') throw new Error('Expected source retry.')
    expect(retryRequest.source).toBe(input.source)
    expect(retryRequest.sourceKey).toBe(cachedRequest.sourceKey)
    worker.emitMessage(highlightedResponse(retryRequest.requestId))

    await expect(second).resolves.toMatchObject({ status: 'highlighted' })
    service.dispose()
  })
})
