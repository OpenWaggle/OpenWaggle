import type { CliShimMutationResult } from '@shared/types/cli-shim'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  ensureCliShimInstalled: vi.fn<() => Promise<CliShimMutationResult>>(),
}))

vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
}))
vi.mock('../cli-shim-service', () => ({
  createAppCliShimService: () => ({ status: vi.fn(), install: vi.fn() }),
  ensureCliShimInstalled: mocks.ensureCliShimInstalled,
}))

async function loadCliShimStartup() {
  vi.resetModules()
  return import('../cli-shim-startup')
}

describe('beginAppCliShimSetupWhen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when setup is not wanted', async () => {
    const { beginAppCliShimSetupWhen } = await loadCliShimStartup()

    await expect(beginAppCliShimSetupWhen(false)).resolves.toBeUndefined()

    expect(mocks.ensureCliShimInstalled).not.toHaveBeenCalled()
  })

  it('installs the CLI and logs a setup that could not make it available', async () => {
    mocks.ensureCliShimInstalled.mockResolvedValueOnce({
      ok: false,
      error: 'not writable',
      status: {
        management: 'user-shim',
        state: 'unavailable',
        commandPath: null,
        onPath: false,
        detail: 'not writable',
      },
    })
    const { beginAppCliShimSetupWhen } = await loadCliShimStartup()

    await expect(beginAppCliShimSetupWhen(true)).resolves.toBeUndefined()

    expect(mocks.ensureCliShimInstalled).toHaveBeenCalledOnce()
    expect(mocks.warn).toHaveBeenCalledWith('Could not make the bundled CLI available', {
      detail: 'not writable',
    })
  })

  it('logs a failed setup instead of rejecting', async () => {
    mocks.ensureCliShimInstalled.mockRejectedValueOnce(new Error('disk full'))
    const { beginAppCliShimSetupWhen } = await loadCliShimStartup()

    await expect(beginAppCliShimSetupWhen(true)).resolves.toBeUndefined()

    expect(mocks.warn).toHaveBeenCalledWith('CLI setup failed', expect.anything())
  })
})
