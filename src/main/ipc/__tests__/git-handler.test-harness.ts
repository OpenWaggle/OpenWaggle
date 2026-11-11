import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import type { DesktopDialogsShape } from '../../ports/desktop-shell/dialogs'
import type * as GitHandlers from '../git'

type TestMock = ReturnType<typeof vi.fn>
type ShowMessageBoxMock = Mock<DesktopDialogsShape['showMessageBox']>

interface GitHandlerMocks {
  readonly fromWebContentsMock: TestMock
  readonly execFileMock: TestMock
  readonly showMessageBoxMock: ShowMessageBoxMock
  readonly typedHandleMock: TestMock
}

const mocks: GitHandlerMocks = vi.hoisted(() => ({
  fromWebContentsMock: vi.fn(),
  execFileMock: vi.fn(),
  showMessageBoxMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

export const fromWebContentsMock: TestMock = mocks.fromWebContentsMock
export const execFileMock: TestMock = mocks.execFileMock
export const showMessageBoxMock: ShowMessageBoxMock = mocks.showMessageBoxMock
export const typedHandleMock: TestMock = mocks.typedHandleMock

vi.mock('../typed-ipc', () => ({
  RelayedHostResult: class {
    constructor(readonly value: unknown) {}
  },
  hostHandle: typedHandleMock,
  relayingHandle: typedHandleMock,
  typedHandle: typedHandleMock,
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('../../desktop-shell/desktop-windows', () => ({
  desktopWindows: { fromSurface: fromWebContentsMock },
}))
vi.mock('../../desktop-shell/dialogs', () => ({
  desktopDialogs: { showMessageBox: showMessageBoxMock },
}))

export function registeredHandler(name: string) {
  const call = typedHandleMock.mock.calls.find((c: unknown[]) => c[0] === name)
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

export function resetGitHandlerMocks() {
  typedHandleMock.mockReset()
  fromWebContentsMock.mockReset()
  fromWebContentsMock.mockReturnValue({ id: 'owner-window' })
  execFileMock.mockReset()
  showMessageBoxMock.mockReset()
  showMessageBoxMock.mockResolvedValue({ response: 0 })
}

export function loadGitHandlers(): Promise<typeof GitHandlers> {
  return import('../git')
}
