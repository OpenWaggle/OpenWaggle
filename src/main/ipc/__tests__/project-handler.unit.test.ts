import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  hostHandle: typedHandleMock,
  typedHandle: typedHandleMock,
}))

import { registerProjectHandlers } from '../project-handler'

function getRegisteredHandler(name: string) {
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
  let projectPath: string | undefined

  beforeEach(() => {
    typedHandleMock.mockReset()
    showOpenDialogMock.mockReset()
    fromWebContentsMock.mockReset()
  })

  afterEach(async () => {
    if (projectPath) await fs.rm(projectPath, { recursive: true, force: true })
    projectPath = undefined
  })

  it('surfaces an invalid project file for permission-sensitive settings reads', async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-ipc-'))
    await fs.mkdir(path.join(projectPath, '.openwaggle'))
    await fs.writeFile(path.join(projectPath, '.openwaggle', 'settings.json'), '{ invalid json')
    registerProjectHandlers()

    const preferences = getRegisteredHandler('project-config:get-preferences')
    const grants = getRegisteredHandler('authorization-grants:list')
    await expect(preferences?.({}, projectPath)).rejects.toThrow()
    await expect(grants?.({}, projectPath)).rejects.toThrow()
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

  it('canonicalizes the picked folder through symlinks', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pick-'))
    const realDir = path.join(parent, 'real')
    const aliasPath = path.join(parent, 'alias')
    await fs.mkdir(realDir)
    await fs.symlink(realDir, aliasPath)
    fromWebContentsMock.mockReturnValue(null)
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [aliasPath] })

    registerProjectHandlers()

    const handler = getRegisteredHandler('project:select-folder')
    const result = await handler?.({ sender: { id: 11 } })

    expect(result).toBe(await fs.realpath(realDir))
    await fs.rm(parent, { recursive: true, force: true })
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
