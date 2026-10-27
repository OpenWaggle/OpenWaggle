import { describe, expect, it, vi } from 'vitest'
import { coalescedRead, keyedCoalescedRead } from '../coalesced-read'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('coalescedRead (boot fetch dedupe)', () => {
  it('shares one read between callers in the same task', async () => {
    const read = vi.fn(async () => 'value')
    const shared = coalescedRead(read)

    await expect(Promise.all([shared(), shared(), shared()])).resolves.toEqual([
      'value',
      'value',
      'value',
    ])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('gives later callers one trailing read that starts after the one in flight', async () => {
    const first = deferred<string>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('fresh')
    const shared = coalescedRead<string>(read)

    const initial = shared()
    await Promise.resolve()
    const later = [shared(), shared()]
    expect(read).toHaveBeenCalledTimes(1)
    first.resolve('stale')

    await expect(initial).resolves.toBe('stale')
    await expect(Promise.all(later)).resolves.toEqual(['fresh', 'fresh'])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads again after a failed read, and reports the failure to its callers', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('up')
    const shared = coalescedRead<string>(read)

    await expect(shared()).rejects.toThrow('down')
    await expect(shared()).resolves.toBe('up')
  })

  it('keeps keys apart', async () => {
    const read = vi.fn(async (key: string) => key.toUpperCase())
    const shared = keyedCoalescedRead(read)

    await expect(Promise.all([shared('a'), shared('a'), shared('b')])).resolves.toEqual([
      'A',
      'A',
      'B',
    ])
    expect(read).toHaveBeenCalledTimes(2)
  })
})
