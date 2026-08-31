import type { SyntaxThemeRegistration } from '@shared/types/syntax-resources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyntaxWorkerSuccessMessage } from '../protocol'
import { SyntaxService } from '../syntax-service'
import { highlightMessages, IMPORTED_LANGUAGE, MockWorker } from './syntax-service-test-helpers'

const TEST_THEME = {
  name: 'test-theme',
  displayName: 'Test Theme',
  type: 'dark',
  colors: { 'editor.background': 'var(--color-background-primary)' },
  settings: [],
} satisfies SyntaxThemeRegistration

function highlightedTokens(
  requestId: number,
  content: string,
  language: string,
  theme: string,
): SyntaxWorkerSuccessMessage {
  return {
    type: 'highlighted',
    requestId,
    result: {
      status: 'highlighted',
      language,
      theme,
      lines: [[{ content, color: 'var(--color-text-primary)' }]],
      elapsedMs: 1,
    },
  }
}

describe('SyntaxService registration invalidation', () => {
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

  it('retires pending theme work and prevents its stale result from entering the cache', async () => {
    const service = new SyntaxService()
    service.registerThemes([TEST_THEME])
    const input = { source: 'themed source', language: 'typescript', theme: TEST_THEME.name }
    const staleResult = service.highlight(input)
    const staleWorker = MockWorker.instances[0]
    const staleRequest = staleWorker ? highlightMessages(staleWorker)[0] : undefined
    if (!staleWorker || staleRequest?.type !== 'highlight') throw new Error('Expected work.')

    service.registerThemes([{ ...TEST_THEME, displayName: 'Updated Theme' }])
    expect(staleWorker.terminated).toBe(true)
    staleWorker.emitMessage(
      highlightedTokens(staleRequest.requestId, 'stale-theme-token', 'typescript', TEST_THEME.name),
    )
    await expect(staleResult).resolves.toMatchObject({
      status: 'plain-text',
      diagnostic: expect.stringContaining('cancelled'),
    })

    const currentResult = service.highlight(input)
    const currentWorker = MockWorker.instances[1]
    const currentRequest = currentWorker ? highlightMessages(currentWorker)[0] : undefined
    if (!currentWorker || currentRequest?.type !== 'highlight') {
      throw new Error('Expected current theme work.')
    }
    currentWorker.emitMessage(
      highlightedTokens(
        currentRequest.requestId,
        'current-theme-token',
        'typescript',
        TEST_THEME.name,
      ),
    )
    await expect(currentResult).resolves.toMatchObject({
      lines: [[{ content: 'current-theme-token' }]],
    })
    const messageCount = currentWorker.messages.length
    await expect(service.highlight(input)).resolves.toMatchObject({
      lines: [[{ content: 'current-theme-token' }]],
    })
    expect(currentWorker.messages).toHaveLength(messageCount)
    service.dispose()
  })

  it('retires pending grammar work and rebuilds it with the new language revision', async () => {
    const service = new SyntaxService()
    service.registerLanguages([IMPORTED_LANGUAGE])
    const input = { source: 'grammar source', language: 'test-language', theme: 'dark-plus' }
    const staleResult = service.highlight(input)
    const staleWorker = MockWorker.instances[0]
    const staleRequest = staleWorker ? highlightMessages(staleWorker)[0] : undefined
    if (!staleWorker || staleRequest?.type !== 'highlight') throw new Error('Expected work.')

    service.registerLanguages([{ ...IMPORTED_LANGUAGE, revision: 'revision-2' }])
    expect(staleWorker.terminated).toBe(true)
    staleWorker.emitMessage(
      highlightedTokens(
        staleRequest.requestId,
        'stale-grammar-token',
        'test-language',
        'dark-plus',
      ),
    )
    await expect(staleResult).resolves.toMatchObject({ status: 'plain-text' })

    const currentResult = service.highlight(input)
    const currentWorker = MockWorker.instances[1]
    const currentRequest = currentWorker ? highlightMessages(currentWorker)[0] : undefined
    if (!currentWorker || currentRequest?.type !== 'highlight') {
      throw new Error('Expected current grammar work.')
    }
    expect(currentRequest.sourceKey).not.toBe(staleRequest.sourceKey)
    currentWorker.emitMessage(
      highlightedTokens(
        currentRequest.requestId,
        'current-grammar-token',
        'test-language',
        'dark-plus',
      ),
    )
    await expect(currentResult).resolves.toMatchObject({
      lines: [[{ content: 'current-grammar-token' }]],
    })
    service.dispose()
  })
})
