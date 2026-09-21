import { describe, expect, it, vi } from 'vitest'
import { flushCliOutput } from '../cli-output-flush'

describe('CLI output flush', () => {
  it('waits for both machine-output pipes to drain before resolving', async () => {
    const callbacks: Array<(error?: Error | null) => void> = []
    const output = {
      stdout: {
        write: vi.fn((_chunk: string, callback: (error?: Error | null) => void) => {
          callbacks.push(callback)
          return false
        }),
      },
      stderr: {
        write: vi.fn((_chunk: string, callback: (error?: Error | null) => void) => {
          callbacks.push(callback)
          return false
        }),
      },
    }
    const settled = vi.fn()

    const flushing = flushCliOutput(output).then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    callbacks[0]?.()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    callbacks[1]?.()
    await flushing
    expect(settled).toHaveBeenCalledOnce()
  })

  it('rejects when an output pipe cannot flush', async () => {
    const output = {
      stdout: {
        write: (_chunk: string, callback: (error?: Error | null) => void) => {
          callback(new Error('pipe closed'))
          return false
        },
      },
      stderr: {
        write: (_chunk: string, callback: (error?: Error | null) => void) => {
          callback()
          return true
        },
      },
    }

    await expect(flushCliOutput(output)).rejects.toThrow('pipe closed')
  })
})
