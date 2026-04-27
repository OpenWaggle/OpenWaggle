import { describe, expect, it } from 'vitest'
import { hasConcreteToolOutput, normalizeToolResultPayload } from '../tool-result-state'

describe('tool-result-state', () => {
  it('normalizes structured JSON tool payloads', () => {
    expect(
      normalizeToolResultPayload(
        '{"kind":"json","data":{"message":"File written","path":"out.ts"}}',
      ),
    ).toEqual({
      message: 'File written',
      path: 'out.ts',
    })
  })

  it('treats undefined as the only missing tool output state', () => {
    expect(hasConcreteToolOutput(undefined)).toBe(false)
    expect(hasConcreteToolOutput('')).toBe(true)
    expect(hasConcreteToolOutput({ kind: 'json', data: null })).toBe(true)
  })

  it('treats arbitrary strings as concrete tool output', () => {
    expect(hasConcreteToolOutput('not-json')).toBe(true)
  })
})
