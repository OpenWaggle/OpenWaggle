import * as Effect from 'effect/Effect'
import { vi } from 'vitest'
import type * as GitHandlers from '../git'

type TestMock = ReturnType<typeof vi.fn>

interface GitHandlerMocks {
  readonly execFileMock: TestMock
  readonly typedHandleMock: TestMock
}

const mocks: GitHandlerMocks = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

export const execFileMock: TestMock = mocks.execFileMock
export const typedHandleMock: TestMock = mocks.typedHandleMock

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
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
  execFileMock.mockReset()
}

export function loadGitHandlers(): Promise<typeof GitHandlers> {
  return import('../git')
}
