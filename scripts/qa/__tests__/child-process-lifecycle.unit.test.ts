import { describe, expect, it, vi } from 'vitest'
import {
  type StoppableChild,
  stopChild,
} from '../child-process-lifecycle'

class FakeChild implements StoppableChild {
  readonly signalCode = null
  readonly kill = vi.fn(() => true)

  constructor(
    readonly pid: number,
    readonly exitCode: number | null = null,
  ) {}

  once() {
    return this
  }

  off() {
    return this
  }
}

describe('QA child-process lifecycle', () => {
  it('terminates the complete Windows process tree and waits for proven exit', async () => {
    const child = new FakeChild(42)
    const waitForExit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const terminateWindowsTree = vi.fn(async () => undefined)

    await stopChild(child, { platform: 'win32', terminateWindowsTree, waitForExit })

    expect(child.kill).not.toHaveBeenCalled()
    expect(terminateWindowsTree).toHaveBeenNthCalledWith(1, 42, false)
    expect(terminateWindowsTree).toHaveBeenNthCalledWith(2, 42, true)
    expect(waitForExit).toHaveBeenCalledTimes(2)
  })

  it('targets the Windows process tree before accepting a fast root exit', async () => {
    const child = new FakeChild(44)
    const waitForExit = vi.fn(async () => true)
    const terminateWindowsTree = vi.fn(async () => undefined)

    await stopChild(child, { platform: 'win32', terminateWindowsTree, waitForExit })

    expect(terminateWindowsTree).toHaveBeenCalledWith(44, false)
    expect(terminateWindowsTree.mock.invocationCallOrder[0]).toBeLessThan(
      waitForExit.mock.invocationCallOrder[0],
    )
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('fails closed when a Windows root exited with a surviving descendant', async () => {
    const terminateWindowsTree = vi.fn(async () => {
      throw new Error('The root process no longer exists.')
    })
    const verifyWindowsTreeExit = vi.fn(async () => false)

    await expect(
      stopChild(new FakeChild(45, 0), {
        platform: 'win32',
        terminateWindowsTree,
        verifyWindowsTreeExit,
        waitForExit: async () => true,
      }),
    ).rejects.toThrow('Windows GUI process-tree termination failed without proof of exit')

    expect(terminateWindowsTree).toHaveBeenNthCalledWith(1, 45, false)
    expect(terminateWindowsTree).toHaveBeenNthCalledWith(2, 45, true)
    expect(verifyWindowsTreeExit).toHaveBeenCalledTimes(2)
  })

  it('accepts an exited Windows root only after proving no descendants remain', async () => {
    const terminateWindowsTree = vi.fn(async () => {
      throw new Error('The root process no longer exists.')
    })
    const verifyWindowsTreeExit = vi.fn(async () => true)

    await expect(
      stopChild(new FakeChild(46, 0), {
        platform: 'win32',
        terminateWindowsTree,
        verifyWindowsTreeExit,
        waitForExit: async () => true,
      }),
    ).resolves.toBeUndefined()

    expect(terminateWindowsTree).toHaveBeenCalledOnce()
    expect(verifyWindowsTreeExit).toHaveBeenCalledWith(46)
  })

  it('fails closed when forced termination cannot prove process exit', async () => {
    await expect(
      stopChild(new FakeChild(43), {
        platform: 'linux',
        waitForExit: async () => false,
      }),
    ).rejects.toThrow('Could not prove GUI process 43 exited')
  })
})
