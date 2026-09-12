import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BrowserImportSource } from '@shared/types/browser-import'
import type { BrowserProfile } from '@shared/types/browser-profile'
import type { CookiesSetDetails } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserCookieImporter, writeImportedCookies } from '../browser-cookie-importer'
import { BrowserImportError } from '../browser-import-errors'

const targetProfiles: readonly BrowserProfile[] = [
  { id: 'default', name: 'Default', kind: 'persistent' },
  { id: 'incognito', name: 'Incognito', kind: 'incognito' },
]
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function firefoxFixture() {
  const home = await mkdtemp(path.join(tmpdir(), 'openwaggle-importer-test-'))
  temporaryDirectories.push(home)
  const databasePath = path.join(home, '.mozilla', 'firefox', 'safe-profile', 'cookies.sqlite')
  await mkdir(path.dirname(databasePath), { recursive: true })
  await writeFile(databasePath, 'fixture')
  const source = {
    id: 'firefox',
    name: 'Firefox',
    profiles: [{ directory: 'safe-profile', name: 'Primary' }],
  } satisfies BrowserImportSource
  return { databasePath, home, source }
}

function resultWith(value = 'secret') {
  return {
    cookies: [
      {
        url: 'https://example.test/',
        domain: '.example.test',
        name: 'session',
        value,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
      },
    ],
    skipped: 0,
    skippedDomains: [],
  } as const
}

function reasonOf(error: unknown) {
  return error instanceof BrowserImportError ? error.reason : undefined
}

describe('browser cookie importer', () => {
  it('revalidates the exact listed source profile before reading its database', async () => {
    const fixture = await firefoxFixture()
    const readFirefox = vi.fn(async () => resultWith())
    const set = vi.fn(async () => undefined)
    const flushStore = vi.fn(async () => undefined)
    const importer = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      getSession: () => ({ cookies: { set, flushStore } }),
      pathContext: { home: fixture.home, platform: 'linux' },
      listSources: async () => [fixture.source],
      readFirefox,
    })

    await expect(
      importer.importCookies({
        sourceId: 'firefox',
        sourceProfileDirectory: '../escape',
        targetProfileId: 'default',
      }),
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'unknown-source-profile')
    expect(readFirefox).not.toHaveBeenCalled()

    await expect(
      importer.importCookies({
        sourceId: 'firefox',
        sourceProfileDirectory: 'safe-profile',
        targetProfileId: 'default',
      }),
    ).resolves.toEqual({ imported: 1, skipped: 0, skippedDomains: [] })
    expect(readFirefox).toHaveBeenCalledExactlyOnceWith(fixture.databasePath)
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ value: 'secret' }))
    expect(flushStore).toHaveBeenCalledOnce()
  })

  it('rejects missing and incognito targets before touching source cookies', async () => {
    const fixture = await firefoxFixture()
    const readFirefox = vi.fn(async () => resultWith())
    const importer = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      pathContext: { home: fixture.home, platform: 'linux' },
      listSources: async () => [fixture.source],
      readFirefox,
    })

    for (const targetProfileId of ['missing', 'incognito']) {
      await expect(
        importer.importCookies({
          sourceId: 'firefox',
          sourceProfileDirectory: 'safe-profile',
          targetProfileId,
        }),
      ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'unknown-target-profile')
    }
    expect(readFirefox).not.toHaveBeenCalled()
  })

  it('imports into a prepared persistent target without weakening the direct API', async () => {
    const fixture = await firefoxFixture()
    const readFirefox = vi.fn(async () => resultWith())
    const set = vi.fn(async () => undefined)
    const importer = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      getSession: () => ({ cookies: { set, flushStore: vi.fn(async () => undefined) } }),
      pathContext: { home: fixture.home, platform: 'linux' },
      listSources: async () => [fixture.source],
      readFirefox,
    })
    const input = {
      sourceId: 'firefox',
      sourceProfileDirectory: 'safe-profile',
      targetProfileId: 'profile-prepared',
    } as const

    await expect(importer.importCookies(input)).rejects.toSatisfy(
      (error: unknown) => reasonOf(error) === 'unknown-target-profile',
    )
    await expect(
      importer.importCookiesIntoPreparedProfile(input, {
        id: 'profile-prepared',
        name: 'Firefox',
        kind: 'persistent',
      }),
    ).resolves.toEqual({ imported: 1, skipped: 0, skippedDomains: [] })
    expect(readFirefox).toHaveBeenCalledOnce()
    expect(set).toHaveBeenCalledOnce()
  })

  it('rejects mismatched and incognito prepared targets before reading', async () => {
    const fixture = await firefoxFixture()
    const readFirefox = vi.fn(async () => resultWith())
    const importer = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      pathContext: { home: fixture.home, platform: 'linux' },
      listSources: async () => [fixture.source],
      readFirefox,
    })
    const input = {
      sourceId: 'firefox',
      sourceProfileDirectory: 'safe-profile',
      targetProfileId: 'profile-prepared',
    } as const

    for (const target of [
      { id: 'different', name: 'Different', kind: 'persistent' },
      { id: 'profile-prepared', name: 'Incognito', kind: 'incognito' },
    ] as const) {
      await expect(importer.importCookiesIntoPreparedProfile(input, target)).rejects.toSatisfy(
        (error: unknown) => reasonOf(error) === 'unknown-target-profile',
      )
    }
    expect(readFirefox).not.toHaveBeenCalled()
  })

  it('rejects Windows Chromium sources that require unsupported app-bound decryption', async () => {
    const readChromium = vi.fn(async () => resultWith())
    const listSources = vi.fn(async () => [
      {
        id: 'chrome',
        name: 'Chrome',
        profiles: [{ directory: 'Default', name: 'Default' }],
      } satisfies BrowserImportSource,
    ])
    const importer = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      pathContext: { home: 'C:\\Users\\test', platform: 'win32' },
      listSources,
      readChromium,
    })

    await expect(
      importer.importCookies({
        sourceId: 'chrome',
        sourceProfileDirectory: 'Default',
        targetProfileId: 'default',
      }),
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'unsupported-platform')
    expect(listSources).not.toHaveBeenCalled()
    expect(readChromium).not.toHaveBeenCalled()
  })

  it('reports expired and individually rejected writes without exposing cookie values', async () => {
    const set = vi.fn(async (cookie: CookiesSetDetails) => {
      if (cookie.name === 'rejected') throw new Error('secret-value must stay internal')
    })
    const flushStore = vi.fn(async () => {
      throw new Error('disk temporarily busy')
    })
    const result = await writeImportedCookies(
      { cookies: { set, flushStore } },
      {
        cookies: [
          ...resultWith('accepted').cookies,
          {
            ...resultWith('expired').cookies[0],
            name: 'expired',
            expirationDate: 50,
          },
          { ...resultWith('rejected-value').cookies[0], name: 'rejected' },
        ],
        skipped: 2,
        skippedDomains: ['already-skipped.test'],
      },
      100,
    )

    expect(result).toEqual({
      imported: 1,
      skipped: 4,
      skippedDomains: ['already-skipped.test', 'example.test'],
    })
    expect(set).toHaveBeenCalledTimes(2)
    expect(flushStore).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('rejected-value')
  })

  it('serializes imports targeting one profile', async () => {
    const fixture = await firefoxFixture()
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let reads = 0
    const readFirefox = vi.fn(async () => {
      reads += 1
      if (reads === 1) await firstGate
      return resultWith(String(reads))
    })
    const importer = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      getSession: () => ({
        cookies: { set: vi.fn(async () => undefined), flushStore: vi.fn(async () => undefined) },
      }),
      pathContext: { home: fixture.home, platform: 'linux' },
      listSources: async () => [fixture.source],
      readFirefox,
    })
    const input = {
      sourceId: 'firefox',
      sourceProfileDirectory: 'safe-profile',
      targetProfileId: 'default',
    } as const

    const first = importer.importCookies(input)
    const second = importer.importCookies(input)
    await vi.waitFor(() => expect(readFirefox).toHaveBeenCalledTimes(1))
    releaseFirst?.()
    await Promise.all([first, second])

    expect(readFirefox).toHaveBeenCalledTimes(2)
  })

  it('preserves typed source and session failure reasons', async () => {
    const fixture = await firefoxFixture()
    const blocked = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      pathContext: { home: fixture.home, platform: 'linux' },
      listSources: async () => [{ ...fixture.source, unavailable: 'browser-running' }],
    })
    await expect(
      blocked.importCookies({
        sourceId: 'firefox',
        sourceProfileDirectory: 'safe-profile',
        targetProfileId: 'default',
      }),
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'browser-running')

    const noSession = createBrowserCookieImporter({
      getTargetProfiles: () => targetProfiles,
      getSession: () => {
        throw new Error('session unavailable')
      },
      pathContext: { home: fixture.home, platform: 'linux' },
      listSources: async () => [fixture.source],
      readFirefox: async () => resultWith(),
    })
    await expect(
      noSession.importCookies({
        sourceId: 'firefox',
        sourceProfileDirectory: 'safe-profile',
        targetProfileId: 'default',
      }),
    ).rejects.toSatisfy((error: unknown) => reasonOf(error) === 'session-unavailable')
  })
})
