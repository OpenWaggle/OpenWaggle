import { Schema } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import { parseJson, parseJsonSafe } from '../parse-json'

const schema = Schema.Struct({ name: Schema.String, age: Schema.Number })

describe('parseJson', () => {
  it('returns validated data for valid JSON matching the schema', () => {
    const result = parseJson('{"name":"Alice","age":30}', schema)
    expect(result).toEqual({ name: 'Alice', age: 30 })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseJson('not json', schema)).toThrow()
  })

  it('throws when valid JSON does not match the schema shape', () => {
    expect(() => parseJson('{"name":"Alice","age":"thirty"}', schema)).toThrow()
  })

  it('throws when required fields are missing', () => {
    expect(() => parseJson('{"name":"Alice"}', schema)).toThrow()
  })
})

describe('parseJsonSafe', () => {
  it('returns { success: true, data } for valid JSON matching the schema', () => {
    const result = parseJsonSafe('{"name":"Bob","age":25}', schema)
    expect(result).toEqual({ success: true, data: { name: 'Bob', age: 25 } })
  })

  it('returns { success: false, data: undefined } for invalid JSON', () => {
    const result = parseJsonSafe('{invalid json}', schema)
    expect(result).toEqual({ success: false, data: undefined })
  })

  it('returns { success: false, data: undefined } when JSON does not match the schema', () => {
    const result = parseJsonSafe('{"name":"Carol","age":"twenty"}', schema)
    expect(result).toEqual({ success: false, data: undefined })
  })

  it('returns { success: false, data: undefined } when required fields are missing', () => {
    const result = parseJsonSafe('{"name":"Dave"}', schema)
    expect(result).toEqual({ success: false, data: undefined })
  })

  it('returns { success: false, data: undefined } for an empty string', () => {
    const result = parseJsonSafe('', schema)
    expect(result).toEqual({ success: false, data: undefined })
  })
})
