import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSettingsStoreTestLifecycle } from '../store/__tests__/settings-test-harness'

const mocks = vi.hoisted(() => ({ loadMcpShellEnvironment: vi.fn(async () => undefined) }))

vi.mock('../mcp-shell-environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mcp-shell-environment')>()),
  loadMcpShellEnvironment: mocks.loadMcpShellEnvironment,
}))
// The Host's background services are not under test; they need the Host's real dependencies.
vi.mock('../runtime-host-services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime-host-services')>()),
  startHostBackgroundServices: () => Effect.void,
}))

// Loaded while the file is collected, which has no time limit: the first import of the runtime's
// module graph is slow under load, and in the settings lifecycle's beforeEach it counted against
// the hook timeout.
await import('../runtime')

/*
 * The desktop app initializes the same runtime as the Session Host, but every MCP channel is
 * Host-backed. Reading the login shell's environment there spawned `$SHELL -ilc env` at every app
 * start and kept its tokens in the window process for nothing.
 */
describe('MCP Host services', () => {
  installSettingsStoreTestLifecycle()

  afterEach(async () => {
    const { stopSessionHostOwnedServices } = await import('../runtime')
    await stopSessionHostOwnedServices()
    mocks.loadMcpShellEnvironment.mockClear()
  })

  it('are not started when the desktop app initializes its runtime', async () => {
    const { initializeAppRuntime } = await import('../runtime')

    await initializeAppRuntime()

    expect(mocks.loadMcpShellEnvironment).not.toHaveBeenCalled()
  })

  it('start with the Session Host-owned services', async () => {
    const { initializeAppRuntime, startSessionHostOwnedServices } = await import('../runtime')
    await initializeAppRuntime()

    await startSessionHostOwnedServices()

    expect(mocks.loadMcpShellEnvironment).toHaveBeenCalledOnce()
  })
})
