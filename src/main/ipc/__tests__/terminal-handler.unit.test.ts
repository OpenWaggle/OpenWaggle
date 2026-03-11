import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, typedOnMock, spawnMock, resizeMock, writeMock, killMock, broadcastMock } =
  vi.hoisted(() => ({
    typedHandleMock: vi.fn(),
    typedOnMock: vi.fn(),
    spawnMock: vi.fn(),
    resizeMock: vi.fn(),
    writeMock: vi.fn(),
    killMock: vi.fn(),
    broadcastMock: vi.fn(),
  }))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../env', () => ({
  getSafeChildEnv: () => ({
    SHELL: '/bin/zsh',
    PATH: '/usr/bin',
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastMock,
}))

vi.mock('node-pty', () => ({
  default: {
    spawn: spawnMock,
  },
  spawn: spawnMock,
}))

import { cleanupTerminals, registerTerminalHandlers } from '../terminal-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

function getSendHandler(name: string): ((...args: unknown[]) => Promise<void>) | undefined {
  const call = typedOnMock.mock.calls.find((c: unknown[]) => c[0] === name)
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('registerTerminalHandlers', () => {
  let onDataCallback: ((data: string) => void) | undefined
  let onExitCallback: (() => void) | undefined

  beforeEach(() => {
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
    spawnMock.mockReset()
    resizeMock.mockReset()
    writeMock.mockReset()
    killMock.mockReset()
    broadcastMock.mockReset()
    onDataCallback = undefined
    onExitCallback = undefined

    spawnMock.mockReturnValue({
      onData: vi.fn((cb: (data: string) => void) => {
        onDataCallback = cb
      }),
      onExit: vi.fn((cb: () => void) => {
        onExitCallback = cb
      }),
      resize: resizeMock,
      write: writeMock,
      kill: killMock,
    })
  })

  it('registers all expected IPC channels', () => {
    registerTerminalHandlers()

    const typedChannels = typedHandleMock.mock.calls.map((c: unknown[]) => c[0] as string)
    const sendChannels = typedOnMock.mock.calls.map((c: unknown[]) => c[0] as string)

    expect(typedChannels).toContain('terminal:create')
    expect(typedChannels).toContain('terminal:close')
    expect(typedChannels).toContain('terminal:resize')
    expect(sendChannels).toContain('terminal:write')
  })

  describe('terminal:create', () => {
    it('rejects non-absolute project paths', async () => {
      registerTerminalHandlers()
      const handler = getInvokeHandler('terminal:create')
      expect(handler).toBeDefined()

      await expect(handler?.({}, 'relative/path')).rejects.toThrow('Project path must be absolute.')
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('rejects empty project path', async () => {
      registerTerminalHandlers()
      const handler = getInvokeHandler('terminal:create')

      await expect(handler?.({}, '')).rejects.toThrow()
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('spawns a pty process with correct defaults for a valid path', async () => {
      // The handler checks fs.existsSync and fs.statSync, so we need to
      // ensure the path /tmp exists (it does in CI and local)
      registerTerminalHandlers()
      const handler = getInvokeHandler('terminal:create')

      const id = await handler?.({}, '/tmp')
      expect(typeof id).toBe('string')
      expect(spawnMock).toHaveBeenCalledOnce()
      expect(spawnMock).toHaveBeenCalledWith(
        '/bin/zsh',
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: '/tmp',
        }),
      )
    })

    it('broadcasts terminal data events when pty produces output', async () => {
      registerTerminalHandlers()
      const handler = getInvokeHandler('terminal:create')

      const id = await handler?.({}, '/tmp')
      expect(onDataCallback).toBeDefined()

      // Simulate pty output
      onDataCallback?.('hello world')
      expect(broadcastMock).toHaveBeenCalledWith('terminal:data', {
        terminalId: id,
        data: 'hello world',
      })
    })

    it('returns a UUID-formatted terminal ID', async () => {
      registerTerminalHandlers()
      const handler = getInvokeHandler('terminal:create')

      const id = (await handler?.({}, '/tmp')) as string
      // UUID v4 format
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })
  })

  describe('terminal:close', () => {
    it('kills the pty process and removes the terminal', async () => {
      registerTerminalHandlers()
      const createHandler = getInvokeHandler('terminal:create')
      const closeHandler = getInvokeHandler('terminal:close')

      const id = await createHandler?.({}, '/tmp')
      await closeHandler?.({}, id)

      expect(killMock).toHaveBeenCalledOnce()
    })

    it('silently ignores close for unknown terminal ID', async () => {
      registerTerminalHandlers()
      const closeHandler = getInvokeHandler('terminal:close')

      // Should not throw
      await expect(closeHandler?.({}, 'nonexistent-id')).resolves.not.toThrow()
      expect(killMock).not.toHaveBeenCalled()
    })
  })

  describe('terminal:resize', () => {
    it('resizes the pty process with valid dimensions', async () => {
      registerTerminalHandlers()
      const createHandler = getInvokeHandler('terminal:create')
      const resizeHandler = getInvokeHandler('terminal:resize')

      const id = await createHandler?.({}, '/tmp')
      await resizeHandler?.({}, id, 120, 40)

      expect(resizeMock).toHaveBeenCalledWith(120, 40)
    })

    it('rejects cols exceeding maximum (500)', async () => {
      registerTerminalHandlers()
      const resizeHandler = getInvokeHandler('terminal:resize')

      await expect(resizeHandler?.({}, 'missing', 501, 40)).rejects.toThrow()
    })

    it('rejects rows exceeding maximum (200)', async () => {
      registerTerminalHandlers()
      const resizeHandler = getInvokeHandler('terminal:resize')

      await expect(resizeHandler?.({}, 'missing', 80, 201)).rejects.toThrow()
    })

    it('rejects cols below minimum (10)', async () => {
      registerTerminalHandlers()
      const resizeHandler = getInvokeHandler('terminal:resize')

      await expect(resizeHandler?.({}, 'missing', 5, 40)).rejects.toThrow()
    })

    it('rejects rows below minimum (5)', async () => {
      registerTerminalHandlers()
      const resizeHandler = getInvokeHandler('terminal:resize')

      await expect(resizeHandler?.({}, 'missing', 80, 3)).rejects.toThrow()
    })

    it('accepts boundary values', async () => {
      registerTerminalHandlers()
      const resizeHandler = getInvokeHandler('terminal:resize')

      await expect(resizeHandler?.({}, 'missing', 10, 5)).resolves.not.toThrow()
      await expect(resizeHandler?.({}, 'missing', 500, 200)).resolves.not.toThrow()
    })

    it('silently ignores resize for unknown terminal ID', async () => {
      registerTerminalHandlers()
      const resizeHandler = getInvokeHandler('terminal:resize')

      // Valid dimensions but nonexistent terminal
      await resizeHandler?.({}, 'nonexistent-id', 80, 24)
      expect(resizeMock).not.toHaveBeenCalled()
    })
  })

  describe('terminal:write', () => {
    it('writes data to the pty process', async () => {
      registerTerminalHandlers()
      const createHandler = getInvokeHandler('terminal:create')
      const writeHandler = getSendHandler('terminal:write')

      const id = await createHandler?.({}, '/tmp')
      await writeHandler?.({}, id, 'echo hello')

      expect(writeMock).toHaveBeenCalledWith('echo hello')
    })

    it('silently ignores write for unknown terminal ID', async () => {
      registerTerminalHandlers()
      const writeHandler = getSendHandler('terminal:write')

      // Should not throw
      await expect(writeHandler?.({}, 'nonexistent', 'data')).resolves.not.toThrow()
      expect(writeMock).not.toHaveBeenCalled()
    })

    it('silently ignores write with data exceeding max bytes (16KB)', async () => {
      registerTerminalHandlers()
      const writeHandler = getSendHandler('terminal:write')

      // 16 * 1024 = 16384 bytes max
      const oversizedData = 'x'.repeat(16 * 1024 + 1)
      // Should not throw or write
      await expect(writeHandler?.({}, 'some-id', oversizedData)).resolves.not.toThrow()
      expect(writeMock).not.toHaveBeenCalled()
    })

    it('accepts write at exactly max bytes', async () => {
      registerTerminalHandlers()
      const createHandler = getInvokeHandler('terminal:create')
      const writeHandler = getSendHandler('terminal:write')

      const id = await createHandler?.({}, '/tmp')
      const maxData = 'x'.repeat(16 * 1024)
      await writeHandler?.({}, id, maxData)

      expect(writeMock).toHaveBeenCalledWith(maxData)
    })

    it('silently ignores empty write data', async () => {
      registerTerminalHandlers()
      const writeHandler = getSendHandler('terminal:write')

      // Empty string parses OK but is falsy; handler returns early
      await writeHandler?.({}, 'any-id', '')
      expect(writeMock).not.toHaveBeenCalled()
    })
  })

  describe('terminal exit cleanup', () => {
    it('removes terminal from map when pty process exits', async () => {
      registerTerminalHandlers()
      const createHandler = getInvokeHandler('terminal:create')
      const closeHandler = getInvokeHandler('terminal:close')

      const id = await createHandler?.({}, '/tmp')

      // Simulate the pty exit callback
      expect(onExitCallback).toBeDefined()
      onExitCallback?.()

      // Now close should be a no-op because exit already cleaned up
      closeHandler?.({}, id)
      expect(killMock).not.toHaveBeenCalled()
    })
  })

  describe('cleanupTerminals', () => {
    it('kills all active terminals', async () => {
      // First clean up any terminals left from previous tests
      cleanupTerminals()
      killMock.mockReset()

      registerTerminalHandlers()
      const createHandler = getInvokeHandler('terminal:create')

      await createHandler?.({}, '/tmp')
      await createHandler?.({}, '/tmp')

      cleanupTerminals()

      expect(killMock).toHaveBeenCalledTimes(2)
    })
  })
})
