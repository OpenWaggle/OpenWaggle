import type { HighlighterCore } from 'shiki'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyntaxWorkerRequest, SyntaxWorkerResponse } from '../protocol'
import { SyntaxSourceTokenization } from '../syntax-source-tokenization'
import { syntaxTokens } from '../syntax-worker-tokens'

const highlighterMocks = vi.hoisted(() => {
  const sources: string[] = []
  return { sources }
})

vi.mock('shiki', async (importOriginal) => {
  const shiki = await importOriginal<typeof import('shiki')>()
  return {
    ...shiki,
    createHighlighterCore: async (...args: Parameters<typeof shiki.createHighlighterCore>) => {
      const instance = await shiki.createHighlighterCore(...args)
      const tokenize = instance.codeToTokens.bind(instance)
      instance.codeToTokens = (source, options) => {
        highlighterMocks.sources.push(source)
        return tokenize(source, options)
      }
      return instance
    },
  }
})

async function workerHarness() {
  let receive: ((event: MessageEvent<unknown>) => void) | undefined
  const messages: SyntaxWorkerResponse[] = []
  vi.stubGlobal('self', {
    addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => {
      receive = listener
    },
    postMessage: (response: SyntaxWorkerResponse) => messages.push(response),
  })
  await import('../syntax.worker')
  return async (request: SyntaxWorkerRequest) => {
    receive?.(new MessageEvent('message', { data: request }))
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    const response = messages.shift()
    if (!response) throw new Error('Expected a syntax worker response.')
    return response
  }
}

describe('syntax worker source viewport tokenization', () => {
  let reference: HighlighterCore

  beforeEach(async () => {
    vi.resetModules()
    highlighterMocks.sources.length = 0
    const shiki = await vi.importActual<typeof import('shiki')>('shiki')
    reference = await shiki.createHighlighterCore({
      langs: [await shiki.bundledLanguages.typescript()],
      themes: [await shiki.bundledThemes['dark-plus']()],
      engine: shiki.createJavaScriptRegexEngine(),
    })
  })

  afterEach(() => {
    reference.dispose()
    vi.unstubAllGlobals()
  })

  it('tokenizes only the requested prefix and extends the cached grammar state without resending source', async () => {
    const send = await workerHarness()
    const line = 'export const value: number = 42\n'
    const source = line.repeat(Math.ceil(1_048_576 / line.length)).slice(0, 1_048_576)
    const input = {
      type: 'highlight',
      language: 'typescript',
      theme: 'dark-plus',
      sourceKey: 'large',
    } as const
    const first = await send({ ...input, requestId: 1, source, lineRange: { start: 0, end: 60 } })
    expect(first).toMatchObject({ type: 'highlighted', retainedSourceKeys: ['large'] })
    expect(highlighterMocks.sources).toHaveLength(1)
    expect(highlighterMocks.sources[0]?.split('\n')).toHaveLength(60)

    const second = await send({ ...input, requestId: 2, lineRange: { start: 50, end: 100 } })
    expect(second).toMatchObject({ type: 'highlighted', result: { lineOffset: 50 } })
    expect(highlighterMocks.sources).toHaveLength(2)
    expect(highlighterMocks.sources[1]?.split('\n')).toHaveLength(40)

    await send({ ...input, requestId: 3, lineRange: { start: 0, end: 20 } })
    expect(highlighterMocks.sources).toHaveLength(2)
  })

  it.each(['\n', '\r\n'])(
    'matches whole-file tokens across multiline constructs and %j boundaries',
    async (newline) => {
      const send = await workerHarness()
      const source = [
        '/* comment starts',
        'still a comment',
        '*/ const value = `template',
        `\${42 + 1}`,
        'template end`',
        '',
        'export { value }',
        '',
      ].join(newline)
      const expected = syntaxTokens(
        reference.codeToTokens(source, { lang: 'typescript', theme: 'dark-plus' }).tokens,
      )
      const input = {
        type: 'highlight',
        language: 'typescript',
        theme: 'dark-plus',
        sourceKey: 'multiline',
      } as const
      for (let end = 1; end <= expected.length; end += 1) {
        const response = await send({
          ...input,
          requestId: end,
          ...(end === 1 ? { source } : {}),
          lineRange: { start: 0, end },
        })
        expect(response).toMatchObject({
          type: 'highlighted',
          result: { lines: expected.slice(0, end) },
        })
      }
      const complete = await send({ ...input, requestId: expected.length + 1 })
      expect(complete).toMatchObject({ type: 'highlighted', result: { lines: expected } })
      expect(highlighterMocks.sources).toHaveLength(expected.length)
    },
  )

  it.each([
    '',
    '\n\n',
    '// carriage\rreturn\nconst value = "💡"',
    `// first\nconst value = '${'💡'.repeat(10_000)}'`,
  ])(
    'preserves empty lines, bare carriage returns, Unicode, and an unterminated long EOF',
    async (source) => {
      const send = await workerHarness()
      const expected = syntaxTokens(
        reference.codeToTokens(source, { lang: 'typescript', theme: 'dark-plus' }).tokens,
      )
      const input = {
        type: 'highlight',
        language: 'typescript',
        theme: 'dark-plus',
        sourceKey: 'edge',
      } as const
      await send({ ...input, source, requestId: 1, lineRange: { start: 0, end: 1 } })
      const response = await send({ ...input, requestId: 2, lineRange: { start: 0, end: 100 } })
      expect(response).toMatchObject({ type: 'highlighted', result: { lines: expected } })
      const pastEnd = await send({ ...input, requestId: 3, lineRange: { start: 100, end: 200 } })
      expect(pastEnd).toMatchObject({
        type: 'highlighted',
        result: { lines: [], lineOffset: expected.length },
      })
    },
  )

  it('reapplies the byte cap as retained source prefixes grow', async () => {
    const send = await workerHarness()
    const line = 'export const value: number = 42\n'
    const source = line.repeat(Math.ceil(1_048_576 / line.length)).slice(0, 1_048_576)
    const input = { type: 'highlight', language: 'typescript', theme: 'dark-plus' } as const
    await send({
      ...input,
      source,
      sourceKey: 'first',
      requestId: 1,
      lineRange: { start: 0, end: 60 },
    })
    await send({
      ...input,
      source,
      sourceKey: 'second',
      requestId: 2,
      lineRange: { start: 0, end: 60 },
    })
    const first = await send({ ...input, sourceKey: 'first', requestId: 3 })
    expect(first).toMatchObject({ type: 'highlighted', retainedSourceKeys: ['second', 'first'] })
    const second = await send({ ...input, sourceKey: 'second', requestId: 4 })
    expect(second).toMatchObject({ type: 'highlighted', retainedSourceKeys: ['second'] })
    expect(await send({ ...input, sourceKey: 'first', requestId: 5 })).toEqual({
      type: 'source-required',
      requestId: 5,
    })
  })

  it('keeps an empty viewport resumable and does not advance after a failed extension', () => {
    const source = '/* comment\nstill comment\n*/ const value = 42'
    const tokenization = new SyntaxSourceTokenization(source)
    const tokenize = vi.spyOn(reference, 'codeToTokens')
    tokenization.highlightThrough(reference, 'typescript', 'dark-plus', 0)
    expect(tokenize).not.toHaveBeenCalled()
    expect(tokenization.estimatedBytes).toBe(source.length * 2)

    tokenization.highlightThrough(reference, 'typescript', 'dark-plus', 1)
    const estimatedBytes = tokenization.estimatedBytes
    tokenize.mockImplementationOnce(() => {
      throw new Error('Grammar failed')
    })
    expect(() => tokenization.highlightThrough(reference, 'typescript', 'dark-plus')).toThrow(
      'Grammar failed',
    )
    expect(tokenization.tokens).toHaveLength(1)
    expect(tokenization.estimatedBytes).toBe(estimatedBytes)

    tokenization.highlightThrough(reference, 'typescript', 'dark-plus')
    expect(syntaxTokens(tokenization.tokens)).toEqual(
      syntaxTokens(
        reference.codeToTokens(source, { lang: 'typescript', theme: 'dark-plus' }).tokens,
      ),
    )
  })
})
