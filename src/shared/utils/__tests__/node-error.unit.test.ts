import { describe, expect, it } from 'vitest'
import { isEnoent, isNodeError } from '../node-error'

describe('isNodeError', () => {
  it('returns true for an Error object that has a code property', () => {
    const err = Object.assign(new Error('test'), { code: 'ENOENT' })
    expect(isNodeError(err)).toBe(true)
  })

  it('returns true when the code matches the specified code', () => {
    const err = Object.assign(new Error('test'), { code: 'ENOENT' })
    expect(isNodeError(err, 'ENOENT')).toBe(true)
  })

  it('returns false for a plain Error with no code property', () => {
    const err = new Error('plain error')
    expect(isNodeError(err)).toBe(false)
  })

  it('returns false when code does not match the specified code', () => {
    const err = Object.assign(new Error('test'), { code: 'EACCES' })
    expect(isNodeError(err, 'ENOENT')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isNodeError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isNodeError(undefined)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isNodeError('ENOENT')).toBe(false)
  })

  it('returns false for a number', () => {
    expect(isNodeError(42)).toBe(false)
  })
})

describe('isEnoent', () => {
  it('returns true for an error with ENOENT code', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' })
    expect(isEnoent(err)).toBe(true)
  })

  it('returns false for an error with a different code', () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    expect(isEnoent(err)).toBe(false)
  })

  it('returns false for a plain Error with no code', () => {
    expect(isEnoent(new Error('no code'))).toBe(false)
  })

  it('returns false for non-object values', () => {
    expect(isEnoent(null)).toBe(false)
    expect(isEnoent(undefined)).toBe(false)
    expect(isEnoent('ENOENT')).toBe(false)
  })
})
