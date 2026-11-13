import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import {
  anyObjectSchema,
  lenientArray,
  lenientOptional,
  lenientRecord,
  lenientStringRecordSchema,
  nonBlankStringSchema,
} from '../lenient'

const entrySchema = Schema.Struct({
  name: lenientOptional(Schema.String),
  count: lenientOptional(Schema.Number),
})

describe('lenient schemas', () => {
  it('reads a field of the wrong type as absent and keeps the others', () => {
    expect(decodeUnknownOrThrow(entrySchema, { name: 7, count: 2 })).toEqual({
      name: undefined,
      count: 2,
    })
  })

  it('keeps the array items that decode and reads anything but an array as empty', () => {
    const names = lenientArray(Schema.String)
    expect(decodeUnknownOrThrow(names, ['a', 1, 'b'])).toEqual(['a', 'b'])
    expect(decodeUnknownOrThrow(names, { 0: 'a' })).toEqual([])
  })

  it('keeps the map entries whose value decodes', () => {
    expect(decodeUnknownOrThrow(lenientStringRecordSchema, { a: 'x', b: 2 })).toEqual({ a: 'x' })
    expect(decodeUnknownOrThrow(lenientRecord(Schema.Number), { a: 1, b: 'x' })).toEqual({ a: 1 })
    expect(decodeUnknownOrThrow(lenientRecord(Schema.Number), ['x'])).toEqual({})
  })

  // Regression: an empty Struct took a string, a number or a boolean for an object.
  it.each([
    { value: [], kind: 'an array' },
    { value: 'text', kind: 'a string' },
    { value: 42, kind: 'a number' },
    { value: true, kind: 'a boolean' },
    { value: null, kind: 'null' },
  ])('refuses $kind as an object', ({ value }) => {
    expect(Schema.is(anyObjectSchema)(value)).toBe(false)
  })

  it('accepts an object, and only a string with something in it', () => {
    expect(Schema.is(anyObjectSchema)({ any: 'field' })).toBe(true)
    expect(Schema.is(nonBlankStringSchema)(' x ')).toBe(true)
    expect(Schema.is(nonBlankStringSchema)('  ')).toBe(false)
  })
})
