import { describe, expect, it, vi } from 'vitest'
import {
  type StoppableChild,
  stopChild,
} from '../child-process-lifecycle'
import type { WindowsProcessIdentity } from '../windows-process-tree'

function processIdentity(processId: number, creationDate = `created-${String(processId)}`) {
  return { processId, creationDate } satisfies WindowsProcessIdentity
}

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
    const snapshot = [processIdentity(42), processIdentity(420)]
    const snapshotWindowsTree = vi.fn(async () => snapshot)
    const waitForExit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const terminateWindowsTree = vi.fn(async () => undefined)
    const verifyWindowsTreeExit = vi.fn(async () => true)

    await stopChild(child, {
      platform: 'win32',
      snapshotWindowsTree,
      terminateWindowsTree,
      verifyWindowsTreeExit,
      waitForExit,
    })

    expect(child.kill).not.toHaveBeenCalled()
    expect(terminateWindowsTree).toHaveBeenNthCalledWith(1, 42, snapshot, false)
    expect(terminateWindowsTree).toHaveBeenNthCalledWith(2, 42, snapshot, true)
    expect(waitForExit).toHaveBeenCalledTimes(2)
    expect(verifyWindowsTreeExit).toHaveBeenCalledWith(snapshot)
  })

  it('targets the Windows process tree before accepting a fast root exit', async () => {
    const child = new FakeChild(44)
    const snapshot = [processIdentity(44)]
    const waitForExit = vi.fn(async () => true)
    const terminateWindowsTree = vi.fn(async () => undefined)
    const verifyWindowsTreeExit = vi.fn(async () => true)

    await stopChild(child, {
      platform: 'win32',
      snapshotWindowsTree: async () => snapshot,
      terminateWindowsTree,
      verifyWindowsTreeExit,
      waitForExit,
    })

    expect(terminateWindowsTree).toHaveBeenCalledWith(44, snapshot, false)
    expect(terminateWindowsTree.mock.invocationCallOrder[0]).toBeLessThan(
      waitForExit.mock.invocationCallOrder[0],
    )
    expect(verifyWindowsTreeExit).toHaveBeenCalledWith(snapshot)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('forces a successful Windows termination when descendant absence is not proven', async () => {
    const snapshot = [processIdentity(45), processIdentity(450)]
    const terminateWindowsTree = vi.fn(async () => undefined)
    const verifyWindowsTreeExit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(
      stopChild(new FakeChild(45, 0), {
        platform: 'win32',
        snapshotWindowsTree: async () => snapshot,
        terminateWindowsTree,
        verifyWindowsTreeExit,
        waitForExit: async () => true,
      }),
    ).resolves.toBeUndefined()

    expect(terminateWindowsTree).toHaveBeenNthCalledWith(1, 45, snapshot, false)
    expect(terminateWindowsTree).toHaveBeenNthCalledWith(2, 45, snapshot, true)
    expect(verifyWindowsTreeExit).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a Windows root exited with a surviving descendant', async () => {
    const snapshot = [processIdentity(470)]
    const terminateWindowsTree = vi.fn(async () => undefined)
    const verifyWindowsTreeExit = vi.fn(async () => false)

    await expect(
      stopChild(new FakeChild(47, 0), {
        platform: 'win32',
        snapshotWindowsTree: async () => snapshot,
        terminateWindowsTree,
        verifyWindowsTreeExit,
        waitForExit: async () => true,
      }),
    ).rejects.toThrow('Could not prove GUI process 47 exited')

    expect(terminateWindowsTree).toHaveBeenNthCalledWith(1, 47, snapshot, false)
    expect(terminateWindowsTree).toHaveBeenNthCalledWith(2, 47, snapshot, true)
    expect(verifyWindowsTreeExit).toHaveBeenCalledTimes(2)
  })

  it('accepts an exited Windows root only after proving no descendants remain', async () => {
    const snapshot = [processIdentity(46), processIdentity(460)]
    const terminateWindowsTree = vi.fn(async () => {
      throw new Error('The root process no longer exists.')
    })
    const verifyWindowsTreeExit = vi.fn(async () => true)

    await expect(
      stopChild(new FakeChild(46, 0), {
        platform: 'win32',
        snapshotWindowsTree: async () => snapshot,
        terminateWindowsTree,
        verifyWindowsTreeExit,
        waitForExit: async () => true,
      }),
    ).resolves.toBeUndefined()

    expect(terminateWindowsTree).toHaveBeenCalledOnce()
    expect(verifyWindowsTreeExit).toHaveBeenCalledWith(snapshot)
  })

  it('uses a retained Windows snapshot after an expected child exit', async () => {
    const snapshot = [processIdentity(49), processIdentity(490)]
    const snapshotWindowsTree = vi.fn(async () => {
      throw new Error('The exited root no longer has a live snapshot.')
    })
    const terminateWindowsTree = vi.fn(async () => undefined)
    const verifyWindowsTreeExit = vi.fn(async () => true)

    await expect(
      stopChild(new FakeChild(49, 0), {
        platform: 'win32',
        windowsProcessTreeSnapshot: snapshot,
        snapshotWindowsTree,
        terminateWindowsTree,
        verifyWindowsTreeExit,
        waitForExit: async () => true,
      }),
    ).resolves.toBeUndefined()

    expect(snapshotWindowsTree).not.toHaveBeenCalled()
    expect(terminateWindowsTree).toHaveBeenCalledWith(49, snapshot, false)
    expect(verifyWindowsTreeExit).toHaveBeenCalledWith(snapshot)
  })

  it('fails closed when an exited Windows root has no capturable tree identity', async () => {
    const terminateWindowsTree = vi.fn(async () => undefined)

    await expect(
      stopChild(new FakeChild(48, 0), {
        platform: 'win32',
        snapshotWindowsTree: async () => [],
        terminateWindowsTree,
      }),
    ).rejects.toThrow('descendant absence is unproven')

    expect(terminateWindowsTree).not.toHaveBeenCalled()
  })

  it('fails closed when forced termination cannot prove process exit', async () => {
    const signalPosixTree = vi.fn()
    await expect(
      stopChild(new FakeChild(43), {
        platform: 'linux',
        signalPosixTree,
        waitForPosixTreeExit: async () => false,
      }),
    ).rejects.toThrow('Could not prove process tree 43 exited')

    expect(signalPosixTree).toHaveBeenNthCalledWith(1, 43, 'SIGTERM')
    expect(signalPosixTree).toHaveBeenNthCalledWith(2, 43, 'SIGKILL')
  })
})
