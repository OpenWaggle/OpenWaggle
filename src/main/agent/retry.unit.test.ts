import { describe, expect, it, vi } from 'vitest'
import { withRetry } from './retry'

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

function makeHttpError(status: number, message: string): Error {
  const error = new Error(message)
  ;(error as Error & { status: number }).status = status
  return error
}

describe('withRetry', () => {
  it('retries on 529 overloaded status', async () => {
    const HTTP_529 = 529
    let attempt = 0
    const fn = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw makeHttpError(HTTP_529, 'overloaded')
      return 'ok'
    })

    const result = await withRetry(fn, { maxAttempts: 2, delayMs: 1 })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on "overloaded" string pattern without status code', async () => {
    let attempt = 0
    const fn = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw new Error('The server is overloaded right now')
      return 'ok'
    })

    const result = await withRetry(fn, { maxAttempts: 2, delayMs: 1 })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry on non-transient errors', async () => {
    const HTTP_401 = 401
    const fn = vi.fn(async () => {
      throw makeHttpError(HTTP_401, 'Unauthorized')
    })

    await expect(withRetry(fn, { maxAttempts: 2, delayMs: 1 })).rejects.toThrow('Unauthorized')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
