import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../canonical-json'

describe('canonicalJson', () => {
  it('keeps array order while normalizing nested object-key order', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: { d: 4, c: 3 }, omitted: undefined })).toBe(
      '{"a":{"c":3,"d":4},"z":[{"a":1,"b":2}]}',
    )
  })
})
