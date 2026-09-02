import { describe, expect, it } from 'vitest'
import { isSyntaxWorkerRequest, isSyntaxWorkerResponse } from '../protocol'
import { highlightedResponse } from './syntax-service-test-helpers'

describe('syntax worker protocol validation', () => {
  it('accepts complete requests and responses', () => {
    expect(
      isSyntaxWorkerRequest({
        type: 'highlight',
        requestId: 1,
        source: 'const value = 1',
        sourceKey: 'typescript:dark-plus:value-1',
        language: 'typescript',
        theme: 'dark-plus',
        lineRange: { start: 0, end: 1 },
      }),
    ).toBe(true)
    expect(isSyntaxWorkerResponse(highlightedResponse(1))).toBe(true)
    expect(isSyntaxWorkerResponse({ type: 'source-required', requestId: 1 })).toBe(true)
    expect(
      isSyntaxWorkerResponse({
        ...highlightedResponse(1),
        result: { ...highlightedResponse(1).result, lineOffset: 10 },
      }),
    ).toBe(true)
  })

  it('rejects malformed token and registration payloads', () => {
    expect(
      isSyntaxWorkerResponse({ ...highlightedResponse(1), result: { lines: 'invalid' } }),
    ).toBe(false)
    expect(
      isSyntaxWorkerRequest({ type: 'register-languages', languages: [{ id: 'partial' }] }),
    ).toBe(false)
  })
})
