import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, showOpenDialogMock, fromWebContentsMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  fromWebContentsMock: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerProjectHandlers } from '../project-handler'

function getRegisteredHandler(
  name: string,
): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('registerProjectHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    showOpenDialogMock.mockReset()
    fromWebContentsMock.mockReset()
  })

  it('attaches the folder dialog to the requesting window when available', async () => {
    const browserWindow = { id: 7 }
    const sender = { id: 3 }
    fromWebContentsMock.mockReturnValue(browserWindow)
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/project'],
    })

    registerProjectHandlers()

    const handler = getRegisteredHandler('project:select-folder')
    expect(handler).toBeDefined()

    const result = await handler?.({ sender })

    expect(fromWebContentsMock).toHaveBeenCalledWith(sender)
    expect(showOpenDialogMock).toHaveBeenCalledWith(browserWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    })
    expect(result).toBe('/tmp/project')
  })

  it('falls back to an app-level dialog when no owner window exists', async () => {
    const sender = { id: 5 }
    fromWebContentsMock.mockReturnValue(null)
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/project'],
    })

    registerProjectHandlers()

    const handler = getRegisteredHandler('project:select-folder')
    expect(handler).toBeDefined()

    const result = await handler?.({ sender })

    expect(fromWebContentsMock).toHaveBeenCalledWith(sender)
    expect(showOpenDialogMock).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    })
    expect(result).toBe('/tmp/project')
  })

  it('returns null when the dialog is cancelled', async () => {
    const sender = { id: 9 }
    fromWebContentsMock.mockReturnValue(null)
    showOpenDialogMock.mockResolvedValue({
      canceled: true,
      filePaths: [],
    })

    registerProjectHandlers()

    const handler = getRegisteredHandler('project:select-folder')
    expect(handler).toBeDefined()

    const result = await handler?.({ sender })

    expect(result).toBeNull()
  })
})
