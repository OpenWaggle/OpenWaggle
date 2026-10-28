import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/user-data') },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
}))

vi.mock('../application/gui-session-command-router', () => ({
  invokeConfiguredHostUiRaw: mocks.invoke,
}))

import { defaultExtensionRuntimeModuleAccessChecker } from '../extension-runtime-protocol'

const input = {
  packagePath: '/project/.openwaggle/extensions/example',
  contentHash: 'hash',
  projectPaths: ['/project'],
  sessionId: 'session-1',
}

describe('extension runtime protocol Host authorization', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('uses the authoritative Host decision for an attached GUI', async () => {
    mocks.invoke.mockResolvedValue({ handled: true, result: true })

    await expect(defaultExtensionRuntimeModuleAccessChecker(input)).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('extensions:authorize-runtime-module', [input])
  })

  it('loads no extension module when no Session Host answers: the window never decides (A-F5)', async () => {
    mocks.invoke.mockResolvedValue({ handled: false })

    await expect(defaultExtensionRuntimeModuleAccessChecker(input)).resolves.toBe(false)
  })
})
