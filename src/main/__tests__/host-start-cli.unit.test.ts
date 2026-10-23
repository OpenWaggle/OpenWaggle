import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', getVersion: () => '1.2.3' } }))

const { runHostStart } = await import('../host-start-cli')

function dependencies(state: 'running' | 'gone', output: string[]) {
  const start = vi.fn(async () => fromPartial({ clientVersion: 'test' }))
  return {
    start,
    status: {
      probe: async () => {
        if (state === 'gone') throw Object.assign(new Error('gone'), { code: 'ECONNREFUSED' })
        return { hostInstanceId: 'host-1', revision: 26 }
      },
    },
    writeStdout: async (text: string) => {
      output.push(text)
    },
  }
}

describe('openwaggle host start', () => {
  it('starts the Host without a window and reports it running', async () => {
    const output: string[] = []
    const value = dependencies('running', output)
    await expect(runHostStart([], value)).resolves.toBe(0)
    expect(value.start).toHaveBeenCalledOnce()
    expect(output.join('')).toBe('Session Host: running\n')
  })

  it('reports a Host that did not come up', async () => {
    const output: string[] = []
    await expect(runHostStart(['--json'], dependencies('gone', output))).resolves.toBe(8)
    expect(output.join('')).toContain('not-running')
  })

  it('refuses arguments it does not take', async () => {
    await expect(runHostStart(['now'], dependencies('running', []))).resolves.toBe(2)
  })
})
