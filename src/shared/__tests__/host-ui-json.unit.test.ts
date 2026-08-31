import { describe, expect, it } from 'vitest'
import { toHostUiJsonValue } from '../host-ui-json'

describe('Host UI JSON transport values', () => {
  it('preserves nested JSON values', () => {
    expect(toHostUiJsonValue({ enabled: true, nested: [1, null, 'ok'] })).toEqual({
      enabled: true,
      nested: [1, null, 'ok'],
    })
  })

  it.each([
    ['NaN', Number.NaN],
    ['BigInt', BigInt(1)],
  ])('rejects %s before JSON framing', (_label, value) => {
    expect(() => toHostUiJsonValue(value)).toThrow('Host UI transport')
  })

  it('explicitly omits optional object properties whose value is undefined', () => {
    expect(toHostUiJsonValue({ title: 'Active Session', archived: undefined })).toEqual({
      title: 'Active Session',
    })
  })

  it('rejects cyclic values before JSON framing', () => {
    const value: { self?: unknown } = {}
    value.self = value

    expect(() => toHostUiJsonValue(value)).toThrow('cyclic')
  })
})
