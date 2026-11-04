import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowOptions = vi.hoisted(() => ({ captured: [] as unknown[] }))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => '/Users/fixture',
}))
vi.mock('../application-menu', () => ({ installDevToolsShortcut: vi.fn() }))
vi.mock('../desktop-window-policy', () => ({ focusWindow: vi.fn(), revealWindow: vi.fn() }))
vi.mock('../error-reporting', () => ({ errorReportingRendererArguments: () => [] }))
vi.mock('../external-navigation', () => ({ openExternalFromRenderer: vi.fn() }))
vi.mock('../renderer-document-trust', () => ({ isTrustedRendererDocument: () => true }))
vi.mock('../renderer-protocol', () => ({
  devRendererUrl: () => null,
  INDEX_HTML: 'index.html',
  isTrustedRendererRequest: () => false,
  RENDERER_PROTOCOL_ORIGIN: 'openwaggle://app',
  rendererUrlWithAutomationIdentity: (url: string) => url,
}))
vi.mock('../security/electron-security', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../security/electron-security')>()),
  installCspHeaders: vi.fn(),
}))
vi.mock('../desktop-ui', () => ({
  isAutomationMode: () => true,
  getAllBrowserWindows: () => [],
  createBrowserWindow: (options: unknown) => {
    windowOptions.captured.push(options)
    const session = { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() }
    return {
      on: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      webContents: { once: vi.fn(), on: vi.fn(), setWindowOpenHandler: vi.fn(), session },
    }
  },
}))

describe('createMainWindow', () => {
  beforeEach(() => {
    windowOptions.captured.length = 0
  })

  it("passes main's home directory to the preload as a renderer argument", async () => {
    const { createMainWindow } = await import('../main-window')
    createMainWindow({ appIconPath: '/icon.png', startupMark: () => undefined })

    expect(windowOptions.captured).toEqual([
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          additionalArguments: expect.arrayContaining([
            '--openwaggle-home-directory=/Users/fixture',
          ]),
          sandbox: true,
          contextIsolation: true,
        }),
      }),
    ])
  })
})
