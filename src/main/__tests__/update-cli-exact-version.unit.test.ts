import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { installedVersion, spawnMock, writeCliStdoutMock } = vi.hoisted(() => ({
  installedVersion: { value: '1.0.0-beta.25' },
  spawnMock: vi.fn(),
  writeCliStdoutMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/workspace/OpenWaggle',
    getVersion: () => installedVersion.value,
    requestSingleInstanceLock: () => true,
    releaseSingleInstanceLock: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}))
vi.mock('../cli-stdout', () => ({ writeCliStdout: writeCliStdoutMock }))
vi.mock('../host-cli', () => ({ stopHostForUpdate: vi.fn() }))

import type { ParsedArguments } from '../mcp-cli-arguments'
import { installExactVersion, UpdateCliUsageError } from '../update-cli-exact-version'

const parsed: ParsedArguments = { positionals: [], options: new Map(), passthrough: [] }

function stubRelease(tag: string) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ tag_name: tag, assets: [] }) }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('exact-version update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installedVersion.value = '1.0.0-beta.25'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['v1.0.0', 'v1.0.0-rc.1', 'v1.0.0-beta.26'])(
    'reports a newer version %s as available',
    async (tag) => {
      stubRelease(tag)

      await expect(installExactVersion(parsed, tag, true)).resolves.toEqual({
        exitCode: 0,
        updaterOwnsExit: false,
      })
      expect(writeCliStdoutMock).toHaveBeenCalledWith(`OpenWaggle ${tag} is available.\n`)
    },
  )

  it('allows reinstalling the installed version', async () => {
    stubRelease('v1.0.0-beta.25')

    await expect(installExactVersion(parsed, 'v1.0.0-beta.25', true)).resolves.toMatchObject({
      exitCode: 0,
    })
  })

  it.each([
    ['v1.0.0-beta.20', true],
    ['v1.0.0-beta.20', false],
    ['v1.0.0-alpha.9', false],
    ['v0.4.0', false],
  ])('refuses the older version %s (check only: %s)', async (tag, checkOnly) => {
    const fetchMock = stubRelease(tag)

    const refusal = installExactVersion(parsed, tag, checkOnly)

    await expect(refusal).rejects.toBeInstanceOf(UpdateCliUsageError)
    await expect(refusal).rejects.toThrow(
      `OpenWaggle ${tag} is older than the installed 1.0.0-beta.25. Downgrades are unsupported`,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
    expect(writeCliStdoutMock).not.toHaveBeenCalled()
  })

  it('refuses when the installed version cannot be compared', async () => {
    installedVersion.value = 'development'
    const fetchMock = stubRelease('v1.0.0')

    await expect(installExactVersion(parsed, 'v1.0.0', true)).rejects.toThrow(
      'cannot compare v1.0.0 with the installed version development',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a release that does not exist as not_found, with its kind (#351)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 404 })),
    )

    await expect(installExactVersion(parsed, 'v99.0.0', true)).rejects.toMatchObject({
      kind: 'not_found',
      message: 'OpenWaggle release v99.0.0 was not found.',
    })
  })
})
