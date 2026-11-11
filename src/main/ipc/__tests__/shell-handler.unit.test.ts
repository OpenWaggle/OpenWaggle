import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DesktopNativeRecoveryOutcome } from '@shared/types/openwaggle-desktop-api'
import * as Effect from 'effect/Effect'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'ow-shell-handler-'))
const existingFile = path.join(fixtureRoot, 'image.png')
writeFileSync(existingFile, 'png')
const missingFile = path.join(fixtureRoot, 'hive-sessions.png')

const mockShellOpenPath = vi.fn()
const mockShellShowItemInFolder = vi.fn()
const mockLogsPath = vi.fn(() => '/tmp/logs')
const handlers = new Map<string, (...args: unknown[]) => unknown>()

const mockShellOpenExternal = vi.fn(async (_url: string) => {})
const mockClipboardReadText = vi.fn(() => 'clipboard text')
const mockNativeAdmissionIssue = vi.fn<() => string | null>(() => null)
const mockRecoverNativeAdmission = vi.fn<() => Promise<DesktopNativeRecoveryOutcome>>(async () => ({
  outcome: 'recovered',
}))
interface MockUsageEnv {
  DO_NOT_TRACK?: string
  PI_TELEMETRY?: string
  CI?: string
  OPENWAGGLE_AUTOMATION?: '1'
}
const mockEnv = vi.hoisted(() => {
  const env: MockUsageEnv = {}
  return env
})
vi.mock('../../env', () => ({ env: mockEnv }))
vi.mock('@shared/build-identity-runtime', () => ({ BUILD_CHANNEL: 'beta' }))

vi.mock('../../desktop-native-admission', () => ({
  getDesktopNativeAdmissionIssue: () => mockNativeAdmissionIssue(),
  recoverDesktopNativeAdmission: () => mockRecoverNativeAdmission(),
}))

vi.mock('../../desktop-shell/os-shell', () => ({
  osShell: {
    openPath: (p: string) => mockShellOpenPath(p),
    openExternal: (url: string) => mockShellOpenExternal(url),
    showItemInFolder: (p: string) => mockShellShowItemInFolder(p),
    trashItem: vi.fn(),
    beep: vi.fn(),
  },
}))
vi.mock('../../desktop-shell/app-paths', async () => ({
  appPaths: {
    ...(await import('../../test-support/fake-desktop-shell')).fakeAppPaths(),
    logs: () => mockLogsPath(),
  },
}))
vi.mock('../../desktop-shell/clipboard', async () => ({
  clipboard: {
    ...(await import('../../test-support/fake-desktop-shell')).fakeClipboard(),
    readText: () => mockClipboardReadText(),
  },
}))
vi.mock('../../desktop-shell/ipc-transport', () => ({
  ipcMainTransport: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: vi.fn(),
  },
}))

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(effect),
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromiseExit(effect),
}))
vi.mock('../../gui-runtime', () => ({
  runGuiEffect: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(effect),
  runGuiEffectExit: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromiseExit(effect),
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { registerShellHandlers } from '../shell-handler'

describe('shell-handler', () => {
  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

  beforeEach(() => {
    handlers.clear()
    mockShellOpenPath.mockReset()
    mockShellShowItemInFolder.mockReset()
    mockShellOpenExternal.mockReset()
    mockLogsPath.mockReset()
    mockClipboardReadText.mockReset()
    mockNativeAdmissionIssue.mockReturnValue(null)
    mockShellOpenPath.mockResolvedValue('')
    mockLogsPath.mockReturnValue('/tmp/logs')
    mockClipboardReadText.mockReturnValue('clipboard text')
  })

  it.each([null, 'Previous desktop ownership remains uncertain.'])(
    'exposes the read-only GUI native admission state: %s',
    async (issue) => {
      mockNativeAdmissionIssue.mockReturnValue(issue)
      registerShellHandlers()
      expect(await handlers.get('app:get-native-admission-issue')?.({})).toBe(issue)
      expect(mockShellOpenPath).not.toHaveBeenCalled()
      expect(mockShellOpenExternal).not.toHaveBeenCalled()
    },
  )

  it('runs the GUI-offered native admission recovery and returns its typed outcome', async () => {
    registerShellHandlers()
    expect(await handlers.get('app:recover-native-admission')?.({})).toEqual({
      outcome: 'recovered',
    })
    const failure = { outcome: 'failed', message: 'Host refused', retryable: true } as const
    mockRecoverNativeAdmission.mockResolvedValueOnce(failure)
    expect(await handlers.get('app:recover-native-admission')?.({})).toEqual(failure)
    expect(mockRecoverNativeAdmission).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{}, null],
    [{ OPENWAGGLE_AUTOMATION: '1' as const }, 'automation'],
    [{ DO_NOT_TRACK: '1' }, 'do-not-track'],
    [{ CI: 'true' }, 'ci'],
  ])('tells the Settings switch why this window never sends statistics: %o', async (env, block) => {
    for (const key of ['DO_NOT_TRACK', 'PI_TELEMETRY', 'CI', 'OPENWAGGLE_AUTOMATION'] as const) {
      delete mockEnv[key]
    }
    Object.assign(mockEnv, env)
    registerShellHandlers()
    expect(await handlers.get('app:get-usage-statistics-block')?.({})).toBe(block)
  })

  it('reads paste text through Electron clipboard isolation', async () => {
    registerShellHandlers()

    await expect(handlers.get('clipboard:read-text')?.({})).resolves.toBe('clipboard text')
    expect(mockClipboardReadText).toHaveBeenCalledOnce()
  })

  describe('app:open-logs-dir', () => {
    it('calls shell.openPath with the logs directory', async () => {
      registerShellHandlers()

      const handler = handlers.get('app:open-logs-dir')
      expect(handler).toBeDefined()
      await handler?.({})
      expect(mockShellOpenPath).toHaveBeenCalledWith('/tmp/logs')
      expect(mockLogsPath).toHaveBeenCalledOnce()
    })

    it('propagates a blocked automation path instead of dropping the rejection', async () => {
      mockShellOpenPath.mockRejectedValueOnce(new Error('Blocked native desktop UI'))
      registerShellHandlers()

      const handler = handlers.get('app:open-logs-dir')
      await expect(handler?.({})).rejects.toThrow('Blocked native desktop UI')
    })
  })

  describe('app:get-logs-path', () => {
    it('returns app.getPath("logs")', async () => {
      registerShellHandlers()

      const handler = handlers.get('app:get-logs-path')
      expect(handler).toBeDefined()
      const result = await handler?.()
      expect(mockLogsPath).toHaveBeenCalledOnce()
      expect(result).toBe('/tmp/logs')
    })
  })

  describe('shell:open-external', () => {
    it.each(['https://github.com', 'http://localhost:3000'])(
      'opens the web link %s via shell.openExternal',
      async (url) => {
        registerShellHandlers()

        await handlers.get('shell:open-external')?.({}, url)
        expect(mockShellOpenExternal).toHaveBeenCalledWith(url)
      },
    )

    it.each([
      ['file:///etc/passwd', /^OpenWaggle opens only http and https links in your browser\.$/u],
      ['/screenshots/hive-sessions.png', /^This link is not a valid web address\.$/u],
    ])('refuses %s in words the user can act on', async (url, message) => {
      registerShellHandlers()

      await expect(handlers.get('shell:open-external')?.({}, url)).rejects.toThrow(message)
      expect(mockShellOpenExternal).not.toHaveBeenCalled()
    })

    it('says the browser could not open the link when the system refuses it', async () => {
      mockShellOpenExternal.mockRejectedValueOnce(new Error('LSOpenURLsWithRole() failed'))
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')

      await expect(handler?.({}, 'https://openwaggle.ai')).rejects.toThrow(
        /^Couldn't open the link in your browser\.$/u,
      )
    })
  })

  describe('shell:open-path', () => {
    it('opens local paths through shell.openPath', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-path')
      expect(handler).toBeDefined()

      await handler?.({}, fixtureRoot)
      expect(mockShellOpenPath).toHaveBeenCalledWith(fixtureRoot)
    })

    it("maps shell.openPath's own failure to a message for the user", async () => {
      mockShellOpenPath.mockResolvedValueOnce('Failed to open path')
      registerShellHandlers()
      const handler = handlers.get('shell:open-path')

      await expect(handler?.({}, existingFile)).rejects.toThrow(
        /^Couldn't open image\.png\. No app on this computer opened it\.$/u,
      )
    })
  })

  describe('shell:reveal-path', () => {
    it('reveals a local path in its platform file browser', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:reveal-path')
      expect(handler).toBeDefined()

      await handler?.({}, `  ${existingFile}  `)

      expect(mockShellShowItemInFolder).toHaveBeenCalledWith(existingFile)
    })
  })

  describe('shell:open-path and shell:reveal-path', () => {
    const missingMessage =
      /^hive-sessions\.png isn't there anymore\. It may have been moved or deleted\.$/u

    it.each([
      ['shell:open-path', '  ', 'There is no file to open.'],
      ['shell:open-path', missingFile, missingMessage],
      [
        'shell:open-path',
        path.join(existingFile, 'inner.png'),
        /^inner\.png isn't there anymore\./u,
      ],
      ['shell:reveal-path', '  ', 'There is no file to reveal.'],
      ['shell:reveal-path', missingFile, missingMessage],
    ])('%s refuses %j without calling the shell', async (channel, targetPath, message) => {
      registerShellHandlers()

      await expect(handlers.get(channel)?.({}, targetPath)).rejects.toThrow(message)
      expect(mockShellOpenPath).not.toHaveBeenCalled()
      expect(mockShellShowItemInFolder).not.toHaveBeenCalled()
    })
  })
})
