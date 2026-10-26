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
const mockAppGetPath = vi.fn((_name: string) => '/tmp/logs')
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
const mockEnv = vi.hoisted((): MockUsageEnv => ({}))
vi.mock('../../env', () => ({ env: mockEnv }))
vi.mock('@shared/build-identity-runtime', () => ({ BUILD_CHANNEL: 'beta' }))

vi.mock('../../desktop-native-admission', () => ({
  getDesktopNativeAdmissionIssue: () => mockNativeAdmissionIssue(),
  recoverDesktopNativeAdmission: () => mockRecoverNativeAdmission(),
}))

vi.mock('electron', () => ({
  shell: {
    openPath: (p: string) => mockShellOpenPath(p),
    openExternal: (url: string) => mockShellOpenExternal(url),
    showItemInFolder: (p: string) => mockShellShowItemInFolder(p),
  },
  app: { getPath: (name: string) => mockAppGetPath(name) },
  clipboard: {
    readText: () => mockClipboardReadText(),
    writeText: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: vi.fn(),
  },
}))

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
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
    mockAppGetPath.mockReset()
    mockClipboardReadText.mockReset()
    mockNativeAdmissionIssue.mockReturnValue(null)
    mockShellOpenPath.mockResolvedValue('')
    mockAppGetPath.mockReturnValue('/tmp/logs')
    mockClipboardReadText.mockReturnValue('clipboard text')
  })

  it('registers exactly nine invoke handlers', () => {
    registerShellHandlers()

    expect(handlers.size).toBe(9)
    expect(handlers.has('app:get-usage-statistics-block')).toBe(true)
    expect(handlers.has('app:recover-native-admission')).toBe(true)
    expect(handlers.has('app:open-logs-dir')).toBe(true)
    expect(handlers.has('app:get-logs-path')).toBe(true)
    expect(handlers.has('app:get-native-admission-issue')).toBe(true)
    expect(handlers.has('shell:open-path')).toBe(true)
    expect(handlers.has('shell:reveal-path')).toBe(true)
    expect(handlers.has('shell:open-external')).toBe(true)
    expect(handlers.has('clipboard:read-text')).toBe(true)
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
      expect(mockAppGetPath).toHaveBeenCalledWith('logs')
    })

    it('uses the path returned by app.getPath', async () => {
      mockAppGetPath.mockReturnValue('/custom/log/dir')
      registerShellHandlers()

      const handler = handlers.get('app:open-logs-dir')
      await handler?.({})
      expect(mockShellOpenPath).toHaveBeenCalledWith('/custom/log/dir')
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
      expect(mockAppGetPath).toHaveBeenCalledWith('logs')
      expect(result).toBe('/tmp/logs')
    })

    it('reflects the current logs path dynamically', async () => {
      mockAppGetPath.mockReturnValue('/another/path')
      registerShellHandlers()

      const handler = handlers.get('app:get-logs-path')
      const result = await handler?.()
      expect(result).toBe('/another/path')
    })
  })

  describe('shell:open-external', () => {
    it('opens https URLs via shell.openExternal', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')
      expect(handler).toBeDefined()

      await handler?.({}, 'https://github.com')
      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com')
    })

    it('opens http URLs via shell.openExternal', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')

      await handler?.({}, 'http://localhost:3000')
      expect(mockShellOpenExternal).toHaveBeenCalledWith('http://localhost:3000')
    })

    it('refuses a link that is not a web link, in words the user can act on', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')

      await expect(handler?.({}, 'file:///etc/passwd')).rejects.toThrow(
        'OpenWaggle opens only http and https links in your browser.',
      )
      expect(mockShellOpenExternal).not.toHaveBeenCalled()
    })

    it('refuses a malformed link without the parser error', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-external')

      await expect(handler?.({}, '/screenshots/hive-sessions.png')).rejects.toThrow(
        /^This link is not a valid web address\.$/u,
      )
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

    it('rejects empty paths', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-path')

      await expect(handler?.({}, '  ')).rejects.toThrow('There is no file to open.')
      expect(mockShellOpenPath).not.toHaveBeenCalled()
    })

    it('says a missing file is gone instead of opening nothing', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-path')

      await expect(handler?.({}, missingFile)).rejects.toThrow(
        /^hive-sessions\.png isn't there anymore\. It may have been moved or deleted\.$/u,
      )
      expect(mockShellOpenPath).not.toHaveBeenCalled()
    })

    it('says a path under a file is gone too', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:open-path')

      await expect(handler?.({}, path.join(existingFile, 'inner.png'))).rejects.toThrow(
        /^inner\.png isn't there anymore\./u,
      )
      expect(mockShellOpenPath).not.toHaveBeenCalled()
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

    it('rejects empty paths', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:reveal-path')

      await expect(handler?.({}, '  ')).rejects.toThrow('There is no file to reveal.')
      expect(mockShellShowItemInFolder).not.toHaveBeenCalled()
    })

    it('says a missing file is gone instead of revealing nothing', async () => {
      registerShellHandlers()
      const handler = handlers.get('shell:reveal-path')

      await expect(handler?.({}, missingFile)).rejects.toThrow(
        /^hive-sessions\.png isn't there anymore\. It may have been moved or deleted\.$/u,
      )
      expect(mockShellShowItemInFolder).not.toHaveBeenCalled()
    })
  })
})
