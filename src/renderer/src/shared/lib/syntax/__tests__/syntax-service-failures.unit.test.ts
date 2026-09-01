import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyntaxService } from '../syntax-service'
import { highlightMessages, IMPORTED_LANGUAGE, MockWorker } from './syntax-service-test-helpers'

describe('SyntaxService failure containment', () => {
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

  it('quarantines an imported grammar after three failed requests', async () => {
    const service = new SyntaxService()
    service.registerLanguages([IMPORTED_LANGUAGE])
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const resultPromise = service.highlight({
        source: `attempt ${String(attempt)}`,
        language: 'test-language',
        theme: 'dark-plus',
      })
      const worker = MockWorker.instances[0]
      const request = worker ? highlightMessages(worker).at(-1) : undefined
      if (!worker || !request || request.type !== 'highlight') throw new Error('Expected work.')
      worker.emitMessage({ type: 'failed', requestId: request.requestId, message: 'bad grammar' })
      await expect(resultPromise).resolves.toMatchObject({ status: 'plain-text' })
    }
    const worker = MockWorker.instances[0]
    if (!worker) throw new Error('Expected a syntax worker.')
    const requestCount = highlightMessages(worker).length

    await expect(
      service.highlight({
        source: 'quarantined',
        language: 'test-language',
        theme: 'dark-plus',
      }),
    ).resolves.toMatchObject({
      status: 'plain-text',
      diagnostic: expect.stringContaining('disabled'),
    })
    expect(highlightMessages(worker)).toHaveLength(requestCount)
    service.dispose()
  })

  it('terminates a worker that returns a malformed response', async () => {
    const service = new SyntaxService()
    const result = service.highlight({
      source: 'invalid response',
      language: 'typescript',
      theme: 'dark-plus',
    })
    const worker = MockWorker.instances[0]
    if (!worker) throw new Error('Expected a syntax worker.')
    worker.emitMessage({ type: 'highlighted', requestId: 1, result: { lines: 'invalid' } })

    await expect(result).resolves.toMatchObject({
      status: 'plain-text',
      diagnostic: expect.stringContaining('invalid response'),
    })
    expect(worker.terminated).toBe(true)
    service.dispose()
  })
})
