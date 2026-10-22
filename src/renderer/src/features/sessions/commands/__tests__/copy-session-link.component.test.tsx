import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ copyToClipboard: vi.fn(), showToast: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: { copyToClipboard: mocks.copyToClipboard } }))
vi.mock('@/shell/ui-store', () => ({
  useUIStore: { getState: () => ({ showToast: mocks.showToast }) },
}))

const { copySessionLink } = await import('../copy-session-link')

beforeEach(() => {
  mocks.copyToClipboard.mockClear()
  mocks.showToast.mockClear()
})

describe('copySessionLink', () => {
  it('copies the Session link and confirms it', () => {
    copySessionLink('4bc96a8e-3b0a-456f-8ac3-64b8be7dc940')

    const link = 'openwaggle://sessions/4bc96a8e-3b0a-456f-8ac3-64b8be7dc940'
    expect(mocks.copyToClipboard).toHaveBeenCalledWith(link)
    expect(mocks.showToast).toHaveBeenCalledWith(`Session link copied: ${link}`, 'success')
  })

  it('copies nothing for an identity a link cannot carry', () => {
    copySessionLink('imported/session')

    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('This session has no link.', 'error')
  })
})
