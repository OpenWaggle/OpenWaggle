import { afterEach, describe, expect, it, vi } from 'vitest'
import { killPendingMcpProcessGroups, stopMcpProcessGroup } from '../pi-mcp-upstream'

afterEach(() => {
  vi.restoreAllMocks()
})

describe.skipIf(process.platform === 'win32')("stopping a stdio server's process group", () => {
  it('kills a group that ignored SIGTERM at Host exit, without waiting for the grace', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

    await stopMcpProcessGroup(4242)
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM')

    killPendingMcpProcessGroups()
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    kill.mockClear()
    // Each group is killed once.
    killPendingMcpProcessGroups()
    expect(kill).not.toHaveBeenCalled()
  })
})
