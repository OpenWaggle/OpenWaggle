import { describe, expect, it, vi } from 'vitest'
import { withLegacySessionWriterFence } from '../legacy-session-writer-fence'

function lock(input: { readonly owned: boolean; readonly acquired: boolean }) {
  return {
    hasSingleInstanceLock: vi.fn(() => input.owned),
    requestSingleInstanceLock: vi.fn(() => input.acquired),
    releaseSingleInstanceLock: vi.fn(),
  }
}

describe('legacy Session writer fence', () => {
  it('refuses cutover while another desktop instance can write the legacy store', async () => {
    const instanceLock = lock({ owned: false, acquired: false })
    const operation = vi.fn(async () => undefined)

    await expect(withLegacySessionWriterFence(operation, instanceLock)).rejects.toThrow(
      'Close the running OpenWaggle window',
    )
    expect(operation).not.toHaveBeenCalled()
    expect(instanceLock.releaseSingleInstanceLock).not.toHaveBeenCalled()
  })

  it('holds a newly acquired fence through cutover and then releases it', async () => {
    const order: string[] = []
    const instanceLock = {
      hasSingleInstanceLock: () => false,
      requestSingleInstanceLock: () => {
        order.push('acquire')
        return true
      },
      releaseSingleInstanceLock: () => {
        order.push('release')
      },
    }

    await withLegacySessionWriterFence(async () => {
      order.push('cutover')
    }, instanceLock)

    expect(order).toEqual(['acquire', 'cutover', 'release'])
  })

  it('keeps the GUI-owned desktop lock after cutover', async () => {
    const instanceLock = lock({ owned: true, acquired: false })

    await withLegacySessionWriterFence(async () => undefined, instanceLock)

    expect(instanceLock.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(instanceLock.releaseSingleInstanceLock).not.toHaveBeenCalled()
  })
})
