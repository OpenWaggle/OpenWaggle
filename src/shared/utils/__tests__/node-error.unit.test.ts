import { describe, expect, it } from 'vitest'
import { errorCode, isEnoent, isNodeError } from '../node-error'

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

describe('errorCode', () => {
  it('reads a code the error inherits from its prototype', () => {
    class InheritedCodeError extends RangeError {}
    Object.defineProperty(InheritedCodeError.prototype, 'code', {
      value: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    })
    expect(errorCode(new InheritedCodeError('overflow'))).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
  })

  it('reads an own code and is undefined for values without one', () => {
    expect(errorCode(Object.assign(new Error('exit'), { code: 2 }))).toBe(2)
    expect(errorCode(new Error('plain'))).toBeUndefined()
    expect(errorCode('ENOENT')).toBeUndefined()
    expect(errorCode(null)).toBeUndefined()
  })
})
