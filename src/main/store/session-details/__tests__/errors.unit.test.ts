import { describe, expect, it } from 'vitest'
import { describeError, hasNodeErrorCode } from '../errors'

describe('session detail error helpers', () => {
  it('normalizes unknown thrown values and detects Node-style error codes', () => {
    const error = new Error('missing file')
    Object.defineProperty(error, 'code', { value: 'ENOENT' })

    expect(describeError(error)).toBe('missing file')
    expect(describeError('plain failure')).toBe('plain failure')
    expect(hasNodeErrorCode(error, 'ENOENT')).toBe(true)
    expect(hasNodeErrorCode(error, 'EACCES')).toBe(false)
    expect(hasNodeErrorCode('plain failure', 'ENOENT')).toBe(false)
  })
})
