import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, typedOnMock, spawnMock, resizeMock, writeMock, killMock } = vi.hoisted(
  () => ({
    typedHandleMock: vi.fn(),
    typedOnMock: vi.fn(),
    spawnMock: vi.fn(),
    resizeMock: vi.fn(),
    writeMock: vi.fn(),
    killMock: vi.fn(),
  }),
)

vi.mock('./typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../env', () => ({
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

vi.mock('node-pty', () => ({
  default: {
    spawn: spawnMock,
  },
  spawn: spawnMock,
}))

import { registerTerminalHandlers } from './terminal-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => unknown) | undefined {
  const call = typedHandleMock.mock.calls.find(([channel]) => channel === name)
  return call?.[1] as ((...args: unknown[]) => unknown) | undefined
}

function getSendHandler(name: string): ((...args: unknown[]) => unknown) | undefined {
  const call = typedOnMock.mock.calls.find(([channel]) => channel === name)
  return call?.[1] as ((...args: unknown[]) => unknown) | undefined
}

describe('registerTerminalHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
    spawnMock.mockReset()
    resizeMock.mockReset()
    writeMock.mockReset()
    killMock.mockReset()

    spawnMock.mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      resize: resizeMock,
      write: writeMock,
      kill: killMock,
    })
  })

  it('rejects non-absolute project paths for terminal creation', () => {
    registerTerminalHandlers()
    const createHandler = getInvokeHandler('terminal:create')
    expect(createHandler).toBeDefined()

    expect(() => createHandler?.({}, 'relative/path')).toThrow('Project path must be absolute.')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('validates resize/write payloads at runtime', () => {
    registerTerminalHandlers()
    const resizeHandler = getInvokeHandler('terminal:resize')
    const writeHandler = getSendHandler('terminal:write')

    expect(resizeHandler).toBeDefined()
    expect(writeHandler).toBeDefined()

    expect(() => resizeHandler?.({}, 'missing', 120, 40)).not.toThrow()
    expect(() => resizeHandler?.({}, 'missing', 800, 40)).toThrow()
    expect(() => writeHandler?.({}, 'missing', 'echo hello')).not.toThrow()
    expect(() => writeHandler?.({}, 'missing', 'x'.repeat(20_000))).not.toThrow()
  })
})
