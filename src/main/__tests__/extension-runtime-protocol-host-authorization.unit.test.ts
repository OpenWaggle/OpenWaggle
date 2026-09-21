import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  runAppEffect: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/user-data') },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
}))

vi.mock('../application/local-session-command-dispatcher', () => ({
  invokeConfiguredHostUiRaw: mocks.invoke,
}))

vi.mock('../runtime', () => ({
  runAppEffect: mocks.runAppEffect,
}))

import { defaultExtensionRuntimeModuleAccessChecker } from '../extension-runtime-protocol'

describe('extension runtime protocol Host authorization', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.runAppEffect.mockReset()
  })

  it('uses the authoritative Host decision for an attached GUI', async () => {
    const input = {
      packagePath: '/project/.openwaggle/extensions/example',
      contentHash: 'hash',
      projectPaths: ['/project'],
      sessionId: 'session-1',
    }
    mocks.invoke.mockResolvedValue({ handled: true, result: true })

    await expect(defaultExtensionRuntimeModuleAccessChecker(input)).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('extensions:authorize-runtime-module', [input])
    expect(mocks.runAppEffect).not.toHaveBeenCalled()
  })
})
