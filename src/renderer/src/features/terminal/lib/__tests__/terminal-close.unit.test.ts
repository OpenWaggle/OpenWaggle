import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndCloseTerminals } from '../terminal-close'

const mocks = vi.hoisted(() => ({
  assessTerminalClose: vi.fn(),
  closeTerminal: vi.fn(),
  showConfirm: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))

describe('terminal close protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.closeTerminal.mockResolvedValue(undefined)
    mocks.showConfirm.mockResolvedValue(true)
  })

  it('closes a confidently idle terminal without prompting', async () => {
    mocks.assessTerminalClose.mockResolvedValue({ disposition: 'safe', reason: 'idle' })

    await expect(
      confirmAndCloseTerminals('owner', [{ terminalId: 'term-1', label: 'Terminal 1' }]),
    ).resolves.toBe('closed')

    expect(mocks.showConfirm).not.toHaveBeenCalled()
    expect(mocks.closeTerminal).toHaveBeenCalledWith('owner', 'term-1', true)
  })

  it('lists active processes and ports in one destructive confirmation', async () => {
    mocks.assessTerminalClose
      .mockResolvedValueOnce({
        disposition: 'confirm',
        reason: 'active',
        processNames: ['vite'],
        ports: [5173],
      })
      .mockResolvedValueOnce({
        disposition: 'confirm',
        reason: 'uncertain',
        processNames: [],
        ports: [],
      })

    await expect(
      confirmAndCloseTerminals('owner', [
        { terminalId: 'term-1', label: 'Dev server' },
        { terminalId: 'term-2', label: 'Terminal 2' },
      ]),
    ).resolves.toBe('closed')

    expect(mocks.showConfirm).toHaveBeenCalledWith(
      'Close 2 terminals?',
      expect.stringContaining('Processes: vite'),
    )
    expect(mocks.showConfirm.mock.calls[0]?.[1]).toContain('Listening ports: 5173')
    expect(mocks.showConfirm.mock.calls[0]?.[1]).toContain('could not verify')
    expect(mocks.closeTerminal).toHaveBeenCalledTimes(2)
  })

  it('does not mutate a process when confirmation is cancelled', async () => {
    mocks.assessTerminalClose.mockResolvedValue({
      disposition: 'confirm',
      reason: 'active',
      processNames: ['node'],
      ports: [],
    })
    mocks.showConfirm.mockResolvedValue(false)

    await expect(
      confirmAndCloseTerminals('owner', [{ terminalId: 'term-1', label: 'Terminal 1' }]),
    ).resolves.toBe('cancelled')
    expect(mocks.closeTerminal).not.toHaveBeenCalled()
  })

  it('waits for every close before reporting success', async () => {
    mocks.assessTerminalClose.mockResolvedValue({ disposition: 'safe', reason: 'dead' })
    mocks.closeTerminal.mockRejectedValueOnce(new Error('shutdown failed'))

    await expect(
      confirmAndCloseTerminals('owner', [{ terminalId: 'term-1', label: 'Terminal 1' }]),
    ).rejects.toThrow('shutdown failed')
  })
})
