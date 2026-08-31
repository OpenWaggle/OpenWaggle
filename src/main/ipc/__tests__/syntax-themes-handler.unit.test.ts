import fs from 'node:fs/promises'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'

const { authorizeMock, listInstalledSyntaxThemesMock, typedHandleMock } = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  listInstalledSyntaxThemesMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../typed-ipc', () => ({ typedHandle: typedHandleMock }))
vi.mock('../../desktop-ui', () => ({
  browserWindowFromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
}))
vi.mock('../../adapters/syntax-theme-import', () => ({
  applySyntaxThemePreview: vi.fn(),
  listInstalledSyntaxThemes: listInstalledSyntaxThemesMock,
  parseSyntaxThemeSource: vi.fn(),
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
})
