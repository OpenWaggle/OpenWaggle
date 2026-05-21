import { describe, expect, it } from 'vitest'
import { parseToolArgs } from '../tool-args'

describe('parseToolArgs', () => {
  it('parses a valid JSON object string', () => {
    expect(parseToolArgs('{"path":"/tmp","recursive":true}')).toEqual({
      path: '/tmp',
      recursive: true,
    })
  })

  it('returns empty object for invalid JSON', () => {
    expect(parseToolArgs('not json')).toEqual({})
  })

  it('returns empty object for JSON array (not an object)', () => {
    expect(parseToolArgs('[1,2,3]')).toEqual({})
  })

  it('returns empty object for JSON primitive string', () => {
    expect(parseToolArgs('"hello"')).toEqual({})
  })

  it('returns empty object for JSON null', () => {
    expect(parseToolArgs('null')).toEqual({})
  })

  it('preserves nested object values', () => {
    const input = '{"config":{"timeout":30},"tags":["a","b"]}'
    const result = parseToolArgs(input)
    expect(result).toEqual({ config: { timeout: 30 }, tags: ['a', 'b'] })
  })

  it('returns empty object for empty string', () => {
    expect(parseToolArgs('')).toEqual({})
  })
})
