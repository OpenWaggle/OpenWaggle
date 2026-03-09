import { describe, expect, it } from 'vitest'
import { detectToolResultError } from '../stream-part-collector'

describe('detectToolResultError', () => {
  it('returns true for {ok: false, error: "msg"}', () => {
    expect(detectToolResultError({ ok: false, error: 'command failed' })).toBe(true)
  })

  it('returns true for {ok: false, message: "msg"}', () => {
    expect(detectToolResultError({ ok: false, message: 'something went wrong' })).toBe(true)
  })

  it('returns false for {ok: false} alone (no error/message field)', () => {
    expect(detectToolResultError({ ok: false })).toBe(false)
  })

  it('returns false for {ok: false, error: ""}', () => {
    expect(detectToolResultError({ ok: false, error: '' })).toBe(false)
  })

  it('returns true for {error: "msg"} without ok field', () => {
    expect(detectToolResultError({ error: 'something broke' })).toBe(true)
  })

  it('returns false for {error: ""} (empty error string)', () => {
    expect(detectToolResultError({ error: '' })).toBe(false)
  })

  it('returns false for {error: null}', () => {
    expect(detectToolResultError({ error: null })).toBe(false)
  })

  it('returns false for {error: 42} (non-string error)', () => {
    expect(detectToolResultError({ error: 42 })).toBe(false)
  })

  it('recursively parses JSON string wrapping', () => {
    const inner = JSON.stringify({ ok: false, error: 'nested failure' })
    expect(detectToolResultError(inner)).toBe(true)
  })

  it('returns false for non-error JSON strings', () => {
    expect(detectToolResultError(JSON.stringify({ ok: true }))).toBe(false)
  })

  it('returns false for non-JSON strings', () => {
    expect(detectToolResultError('just a regular string')).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(detectToolResultError(42)).toBe(false)
    expect(detectToolResultError(true)).toBe(false)
    expect(detectToolResultError(undefined)).toBe(false)
  })

  it('returns false for null', () => {
    expect(detectToolResultError(null)).toBe(false)
  })

  it('returns false for regular objects without error markers', () => {
    expect(detectToolResultError({ kind: 'text', text: 'hello' })).toBe(false)
  })

  it('returns false for {ok: true}', () => {
    expect(detectToolResultError({ ok: true })).toBe(false)
  })
})
