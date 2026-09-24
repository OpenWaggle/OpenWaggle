import { describe, expect, it, vi } from 'vitest'
import { createPreparationProcessOwnership } from '../preparation-process-ownership'

describe('Preparation process ownership', () => {
  it('retains ownership after failed stop, shares shutdown, and reports why the workspace is reserved', async () => {
    const stop = vi
      .fn()
      .mockRejectedValueOnce(new Error('still alive'))
      .mockResolvedValue(undefined)
    const output = vi.fn()
    const process = { pid: 123, closed: Promise.resolve({ exitCode: 0 }), stop }
    const ownership = createPreparationProcessOwnership()
    ownership.add(process, output)
    const pending = ownership.stop(process)
    expect(ownership.stop(process)).toBe(pending)
    const shutdown = ownership.stopAll()
    await Promise.all([pending, shutdown])
    expect(stop).toHaveBeenCalledTimes(2)
    expect(output).toHaveBeenCalledWith(expect.stringContaining('workspace remains reserved'))
    await ownership.stopAll()
    expect(stop).toHaveBeenCalledTimes(2)
  })
})
