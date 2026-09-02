import fs from 'node:fs/promises'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'

const {
  applySyntaxThemePreviewMock,
  authorizeMock,
  listInstalledSyntaxThemesMock,
  parseSyntaxThemeSourceMock,
  showOpenDialogMock,
  typedHandleMock,
} = vi.hoisted(() => ({
  applySyntaxThemePreviewMock: vi.fn(),
  authorizeMock: vi.fn(),
  listInstalledSyntaxThemesMock: vi.fn(),
  parseSyntaxThemeSourceMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../typed-ipc', () => ({ typedHandle: typedHandleMock }))
vi.mock('../../desktop-ui', () => ({
  browserWindowFromWebContents: vi.fn(),
  showOpenDialog: showOpenDialogMock,
}))
vi.mock('../../adapters/syntax-theme-import', () => ({
  applySyntaxThemePreview: applySyntaxThemePreviewMock,
  listInstalledSyntaxThemes: listInstalledSyntaxThemesMock,
  parseSyntaxThemeSource: parseSyntaxThemeSourceMock,
  removeInstalledSyntaxTheme: vi.fn(),
}))

import { registerSyntaxThemeHandlers } from '../syntax-themes-handler'

const authorizationLayer = Layer.succeed(
  WorkspaceProjectAuthorization,
  WorkspaceProjectAuthorization.of({ authorize: authorizeMock }),
)

function listHandler() {
  const registration = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) =>
      candidate[0] === 'syntax-themes:list' && typeof candidate[1] === 'function',
  )
  const handler = registration?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), authorizationLayer))
}

function effectHandler(channel: string) {
  const registration = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) =>
      candidate[0] === channel && typeof candidate[1] === 'function',
  )
  const handler = registration?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

function previewToken(value: unknown) {
  if (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string'
  ) {
    return value.token
  }
  throw new Error('Expected a syntax import preview token.')
}

describe('syntax theme project authorization', () => {
  beforeEach(() => {
    authorizeMock.mockReset()
    listInstalledSyntaxThemesMock.mockReset()
    typedHandleMock.mockReset()
    listInstalledSyntaxThemesMock.mockResolvedValue({
      themes: [],
      languages: [],
      appearances: [],
    })
    parseSyntaxThemeSourceMock.mockResolvedValue({ themes: [], languages: [], appearances: [] })
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/theme.json'] })
    registerSyntaxThemeHandlers()
  })

  it('authorizes the canonical project root before reading project syntax resources', async () => {
    const canonicalProjectPath = await fs.realpath(process.cwd())
    authorizeMock.mockReturnValue(Effect.succeed(canonicalProjectPath))

    await listHandler()?.({}, process.cwd())

    expect(authorizeMock).toHaveBeenCalledWith(canonicalProjectPath)
    expect(listInstalledSyntaxThemesMock).toHaveBeenCalledWith(
      '/user-data/syntax-resources',
      canonicalProjectPath,
    )
  })

  it('rejects an unauthorized existing directory before reading its resources', async () => {
    authorizeMock.mockReturnValue(Effect.fail(new Error('Project path is not authorized.')))

    await expect(listHandler()?.({}, process.cwd())).rejects.toThrow(
      'Project path is not authorized.',
    )
    expect(listInstalledSyntaxThemesMock).not.toHaveBeenCalled()
  })

  it('bounds retained previews and supersedes an earlier preview from the same renderer', async () => {
    const selectImport = effectHandler('syntax-themes:select-import')
    const applyImport = effectHandler('syntax-themes:apply-import')
    const first = await selectImport?.({ sender: { id: 1 } })
    const second = await selectImport?.({ sender: { id: 2 } })
    const third = await selectImport?.({ sender: { id: 3 } })

    await expect(applyImport?.({ sender: { id: 1 } }, previewToken(first))).rejects.toThrow()
    expect(applySyntaxThemePreviewMock).not.toHaveBeenCalled()
    await expect(applyImport?.({ sender: { id: 2 } }, previewToken(second))).resolves.toEqual({
      themes: [],
      languages: [],
      appearances: [],
    })

    const replacement = await selectImport?.({ sender: { id: 3 } })
    expect(applySyntaxThemePreviewMock).toHaveBeenCalledTimes(1)
    await expect(applyImport?.({ sender: { id: 3 } }, previewToken(third))).rejects.toThrow()
    expect(applySyntaxThemePreviewMock).toHaveBeenCalledTimes(1)
    await expect(applyImport?.({ sender: { id: 3 } }, previewToken(replacement))).resolves.toEqual({
      themes: [],
      languages: [],
      appearances: [],
    })
    expect(applySyntaxThemePreviewMock).toHaveBeenCalledTimes(2)
  })
})
