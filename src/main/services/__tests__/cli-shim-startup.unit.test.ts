import type { CliShimMutationResult, CliShimStatus } from '@shared/types/cli-shim'
import { describe, expect, it, vi } from 'vitest'
import {
  createCliShimSetupGate,
  getAppCliShimStatus,
  waitForCliSetupBeforeExit,
} from '../cli-shim-startup'

describe('CLI shim startup', () => {
  it('waits for startup CLI setup before reporting the command status', async () => {
    const installed: CliShimStatus = {
      management: 'user-shim',
      state: 'installed',
      commandPath: '/tmp/openwaggle',
      onPath: true,
    }
    let finishSetup!: (result: CliShimMutationResult) => void
    const setup = new Promise<CliShimMutationResult>((resolve) => {
      finishSetup = resolve
    })
    const service = {
      status: vi
        .fn()
        .mockResolvedValueOnce({ ...installed, state: 'not-installed' })
        .mockResolvedValue(installed),
      install: vi.fn().mockReturnValue(setup),
    }
    const gate = createCliShimSetupGate(service)
    const started = gate.begin()
    await vi.waitFor(() => expect(service.install).toHaveBeenCalledOnce())

    let readSettled = false
    const read = gate.status().then((status) => {
      readSettled = true
      return status
    })
    await Promise.resolve()
    expect(readSettled).toBe(false)

    finishSetup({ ok: true, status: installed })
    await expect(started).resolves.toMatchObject({ ok: true })
    await expect(read).resolves.toEqual(installed)
  })

  it('bounds CLI setup waiting during a fatal GUI bootstrap failure', async () => {
    await expect(waitForCliSetupBeforeExit(Promise.resolve(), 10)).resolves.toBe(true)
    await expect(waitForCliSetupBeforeExit(new Promise(() => {}), 10)).resolves.toBe(false)
  })

  it('returns an explicit diagnostic if setup never finishes', async () => {
    const service = {
      status: vi.fn().mockResolvedValue({
        management: 'user-shim',
        state: 'not-installed',
        commandPath: '/tmp/openwaggle',
        onPath: true,
      }),
      install: vi.fn().mockReturnValue(new Promise(() => {})),
    }
    const gate = createCliShimSetupGate(service, 10)
    void gate.begin()

    await expect(gate.status()).resolves.toMatchObject({
      state: 'unavailable',
      detail: expect.stringMatching(/setup is still running/i),
    })
  })

  it('does not show a packaged CLI diagnostic in a source build', async () => {
    await expect(getAppCliShimStatus(false)).resolves.toBeNull()
  })
})
