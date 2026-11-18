import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listBrowserImportSources } from '../browser-import-sources'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('Safari profile discovery', () => {
  it('recovers named WebKit stores when Safari metadata is unavailable', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'openwaggle-safari-profile-test-'))
    temporaryDirectories.push(home)
    const library = path.join(home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library')
    const namedId = 'abcdef12-3456-7890-abcd-ef1234567890'
    const namedCookies = path.join(library, 'WebKit', 'WebsiteDataStore', namedId, 'Cookies')
    await mkdir(namedCookies, { recursive: true })
    await mkdir(path.join(library, 'WebKit', 'WebsiteDataStore', '..escape', 'Cookies'), {
      recursive: true,
    })
    await writeFile(path.join(namedCookies, 'Cookies.binarycookies'), '')

    const safari = (await listBrowserImportSources({ home, platform: 'darwin' })).find(
      (source) => source.id === 'safari',
    )

    expect(safari).toEqual({
      id: 'safari',
      name: 'Safari',
      profiles: [{ directory: namedCookies, name: namedId }],
    })
  })
})
