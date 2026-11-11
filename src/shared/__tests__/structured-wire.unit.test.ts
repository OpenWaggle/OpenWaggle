import { describe, expect, it } from 'vitest'
import { decodeStructured, encodeStructured, structuredTransport } from '../structured-wire'

/** What the Electrobun RPC wire does to a value: JSON out, JSON in. */
function roundTrip(value: unknown) {
  return decodeStructured(JSON.parse(JSON.stringify(encodeStructured(value))))
}

describe('structured wire', () => {
  it.each([
    ['undefined in arrays and objects', [undefined, { a: undefined, b: 1 }]],
    ['non-finite and negative-zero numbers', [Number.NaN, Infinity, -Infinity, -0]],
    ['a bigint', 2n ** 70n],
    ['a date', new Date('2026-11-02T10:00:00.000Z')],
    ['a regular expression', /a+b/giu],
    ['a map with object keys', new Map<unknown, unknown>([[{ k: 1 }, new Set(['x'])]])],
    ['nested plain data', { list: [1, 'two', { three: [null, true] }] }],
    ['an object that uses the tag key', { $ow: 'undefined', other: 1 }],
  ])('round-trips %s', (_name, value) => {
    expect(roundTrip(value)).toEqual(value)
  })

  it('keeps binary payloads, their view kind and only the viewed bytes', () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9])
    const decoded = roundTrip({
      pcm: backing.subarray(1, 4),
      samples: new Float32Array([0.5, -1]),
      raw: new Uint8Array([7, 8]).buffer,
      large: new Uint8Array(100_000).fill(255),
    })
    expect(decoded).toEqual({
      pcm: new Uint8Array([1, 2, 3]),
      samples: new Float32Array([0.5, -1]),
      raw: new Uint8Array([7, 8]).buffer,
      large: new Uint8Array(100_000).fill(255),
    })
  })

  it('keeps the name and message of an error', () => {
    const error = new TypeError('refused')
    const decoded = roundTrip(error)
    expect(decoded).toBeInstanceOf(Error)
    expect(decoded).toMatchObject({ name: 'TypeError', message: 'refused' })
  })

  it.each([
    ['a function', () => undefined],
    ['a symbol', Symbol('s')],
  ])('refuses %s, as structured clone does', (_name, value) => {
    expect(() => encodeStructured({ value })).toThrow(TypeError)
  })

  it('refuses a value that contains itself but allows shared children', () => {
    const shared = { leaf: true }
    expect(roundTrip([shared, shared])).toEqual([shared, shared])
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => encodeStructured(cyclic)).toThrow(/contains itself/u)
  })

  it.each([
    ['an unknown tag', { $ow: 'weird' }],
    ['bytes of an unknown view', { $ow: 'bytes', kind: 'Float16Array', base64: '' }],
    ['a map entry that is not a pair', { $ow: 'map', entries: [[1]] }],
  ])('refuses %s it did not write', (_name, wire) => {
    expect(() => decodeStructured(wire)).toThrow(TypeError)
  })
})

describe('structured transport', () => {
  it('carries structured params and payloads through a JSON wire, both ways', () => {
    const received: unknown[] = []
    let deliver: (packet: unknown) => void = () => undefined
    const wire: string[] = []
    const transport = structuredTransport({
      send: (packet) => void wire.push(JSON.stringify(packet)),
      registerHandler: (handler) => {
        deliver = handler
      },
    })
    transport.registerHandler?.((packet) => received.push(packet))

    void transport.send?.({ type: 'request', id: 1, method: 'm', params: { args: [undefined] } })
    expect(JSON.parse(wire[0] ?? 'null')).toEqual({
      type: 'request',
      id: 1,
      method: 'm',
      params: { args: [{ $ow: 'undefined' }] },
    })
    deliver(
      JSON.parse(
        JSON.stringify({
          type: 'message',
          id: 'e',
          payload: encodeStructured(new Uint8Array([1])),
        }),
      ),
    )
    deliver({ type: 'response', id: 1, success: false, error: 'refused' })
    expect(received).toEqual([
      { type: 'message', id: 'e', payload: new Uint8Array([1]) },
      { type: 'response', id: 1, success: false, error: 'refused' },
    ])
  })
})
