import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  showOpenDialogMock,
  fromWebContentsMock,
  getProjectMcpMock,
  setProjectMcpMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  fromWebContentsMock: vi.fn(),
  getProjectMcpMock: vi.fn(),
  setProjectMcpMock: vi.fn(),
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

import { ProjectMcpSettingsService } from '../../ports/project-mcp-settings-service'
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

const TestProjectMcpSettingsLayer = Layer.succeed(ProjectMcpSettingsService, {
  get: (projectPath) => Effect.sync(() => getProjectMcpMock(projectPath)),
  set: (projectPath, settings) => Effect.sync(() => setProjectMcpMock(projectPath, settings)),
})

function getRegisteredProjectHandler(
  name: string,
): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestProjectMcpSettingsLayer))
}

describe('registerProjectHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    showOpenDialogMock.mockReset()
    fromWebContentsMock.mockReset()
    getProjectMcpMock.mockReset()
    setProjectMcpMock.mockReset()
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

  it('returns project MCP settings through the project MCP service', async () => {
    getProjectMcpMock.mockReturnValue({ enabled: 'disabled' })
    const projectPath = mkdtempSync(join(tmpdir(), 'openwaggle-project-handler-'))
    const resolvedProjectPath = realpathSync(projectPath)
    registerProjectHandlers()

    const handler = getRegisteredProjectHandler('project-config:get-mcp')
    expect(handler).toBeDefined()

    const result = await handler?.({}, projectPath)

    expect(result).toEqual({ enabled: 'disabled' })
    expect(getProjectMcpMock).toHaveBeenCalledWith(resolvedProjectPath)
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('validates and persists project MCP settings', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'openwaggle-project-handler-'))
    const resolvedProjectPath = realpathSync(projectPath)
    registerProjectHandlers()

    const handler = getRegisteredProjectHandler('project-config:set-mcp')
    expect(handler).toBeDefined()

    await expect(handler?.({}, projectPath, { enabled: 'enabled' })).resolves.toBeUndefined()

    expect(setProjectMcpMock).toHaveBeenCalledWith(resolvedProjectPath, { enabled: 'enabled' })
    rmSync(projectPath, { recursive: true, force: true })
  })
})
