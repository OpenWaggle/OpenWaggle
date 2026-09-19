// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getCliShimStatus: vi.fn(),
    installCliShim: vi.fn(),
    removeCliShim: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

const { CliAccessCard } = await import('../sections/CliAccessCard')

const commandPath = '/Users/person/.local/bin/openwaggle'

describe('CliAccessCard', () => {
  beforeEach(() => {
    apiMock.getCliShimStatus.mockReset()
    apiMock.installCliShim.mockReset()
    apiMock.removeCliShim.mockReset()
  })

  afterEach(() => cleanup())

  it('installs the command from the not-installed state', async () => {
    apiMock.getCliShimStatus.mockResolvedValue({
      management: 'user-shim',
      state: 'not-installed',
      commandPath,
      onPath: true,
    })
    apiMock.installCliShim.mockResolvedValue({
      ok: true,
      status: {
        management: 'user-shim',
        state: 'installed',
        commandPath,
        onPath: true,
      },
    })
    render(<CliAccessCard />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))

    expect(apiMock.installCliShim).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByText('Installed')).toBeInTheDocument())
  })

  it('explains a conflict without offering a destructive action', async () => {
    apiMock.getCliShimStatus.mockResolvedValue({
      management: 'user-shim',
      state: 'conflict',
      commandPath,
      onPath: true,
      detail: 'Another file already uses this path. OpenWaggle will not replace it.',
    })
    render(<CliAccessCard />)

    expect(await screen.findByText('Path already in use')).toBeInTheDocument()
    expect(screen.getByText(/will not replace it/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
