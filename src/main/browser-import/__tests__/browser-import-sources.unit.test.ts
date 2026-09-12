import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BROWSER_IMPORT_SOURCES,
  browserImportSourceDefinition,
  cookieDatabaseCandidates,
  isSafeBrowserProfileDirectory,
  parseFirefoxProfiles,
} from '../browser-import-source-definitions'
import { listBrowserImportSources } from '../browser-import-sources'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function temporaryHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'openwaggle-browser-source-test-'))
  temporaryDirectories.push(home)
  return home
}

describe('browser import source definitions', () => {
  it('pins source paths and platform availability instead of guessing', () => {
    const chrome = browserImportSourceDefinition('chrome')
    const helium = browserImportSourceDefinition('helium')
    const firefox = browserImportSourceDefinition('firefox')
    expect(chrome?.userDataDirectory({ home: '/Users/test', platform: 'darwin' })).toBe(
      '/Users/test/Library/Application Support/Google/Chrome',
    )
    expect(chrome?.userDataDirectory({ home: '/home/test', platform: 'linux' })).toBe(
      '/home/test/.config/google-chrome',
    )
    expect(
      chrome?.userDataDirectory({
        home: 'C:\\Users\\test',
        platform: 'win32',
        localAppData: 'D:\\Profiles\\Local',
      }),
    ).toBeUndefined()
    expect(
      helium?.userDataDirectory({
        home: 'C:\\Users\\test',
        platform: 'win32',
        localAppData: 'D:\\Profiles\\Local',
      }),
    ).toBe('D:\\Profiles\\Local\\imput\\Helium\\User Data')
    expect(
      firefox?.userDataDirectory({
        home: 'C:\\Users\\test',
        platform: 'win32',
        appData: 'D:\\Profiles\\Roaming',
      }),
    ).toBe('D:\\Profiles\\Roaming\\Mozilla\\Firefox')
    expect(BROWSER_IMPORT_SOURCES.map((source) => source.id)).toContain('safari')
  })

  it('advertises only Firefox and Helium imports on Windows', async () => {
    const sources = await listBrowserImportSources({
      home: 'C:\\Users\\test',
      platform: 'win32',
      appData: 'D:\\Profiles\\Roaming',
      localAppData: 'D:\\Profiles\\Local',
    })

    expect(sources.map((source) => source.id)).toEqual(['helium', 'firefox'])
    expect(sources.every((source) => source.unavailable === 'not-installed')).toBe(true)
  })

  it('rejects Chromium profile paths that could escape the user-data root', () => {
    for (const directory of ['', '.', '..', '../escape', 'nested/profile', 'nested\\profile']) {
      expect(isSafeBrowserProfileDirectory(directory)).toBe(false)
    }
    expect(isSafeBrowserProfileDirectory('Default')).toBe(true)
    expect(isSafeBrowserProfileDirectory('Profile 12')).toBe(true)
  })

  it('parses only valid Firefox profile sections and confines relative paths', () => {
    const profiles = parseFirefoxProfiles(
      [
        '[InstallABC]',
        'Default=Profiles/ignored',
        '[Profile0]',
        'Name=Primary',
        'IsRelative=1',
        'Path=Profiles/abc.default',
        '[Profile1]',
        'Name=Escape',
        'IsRelative=1',
        'Path=../outside',
        '[Profile2]',
        'Name=Absolute custom',
        'IsRelative=0',
        'Path=/Volumes/Secure/firefox',
        '[Profile3]',
        'Name=Invalid absolute relative',
        'IsRelative=1',
        'Path=/tmp/outside',
        '[Profile4]',
        'IsRelative=maybe',
        'Path=Profiles/nope',
      ].join('\n'),
      '/Users/test/Library/Application Support/Firefox',
    )

    expect(profiles).toEqual([
      { directory: 'Profiles/abc.default', name: 'Primary' },
      { directory: '/Volumes/Secure/firefox', name: 'Absolute custom' },
    ])
  })

  it('prefers current Chromium and Safari cookie locations with legacy fallback', () => {
    const chrome = browserImportSourceDefinition('chrome')
    const safari = browserImportSourceDefinition('safari')
    if (!chrome || !safari) throw new Error('browser definitions missing')
    expect(
      cookieDatabaseCandidates(chrome, { home: '/Users/test', platform: 'darwin' }, 'Default'),
    ).toEqual([
      '/Users/test/Library/Application Support/Google/Chrome/Default/Network/Cookies',
      '/Users/test/Library/Application Support/Google/Chrome/Default/Cookies',
    ])
    expect(
      cookieDatabaseCandidates(safari, { home: '/Users/test', platform: 'darwin' }, 'Default'),
    ).toEqual([
      '/Users/test/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies',
      '/Users/test/Library/Cookies/Cookies.binarycookies',
    ])
    expect(
      cookieDatabaseCandidates(
        safari,
        { home: '/Users/test', platform: 'darwin' },
        '/Users/test/Library/WebKit/WebsiteDataStore/abc/Cookies',
      ),
    ).toEqual(['/Users/test/Library/WebKit/WebsiteDataStore/abc/Cookies/Cookies.binarycookies'])
  })
})

describe('browser import source discovery', () => {
  it('discovers Safari default and named WebKit profile cookie stores', async () => {
    const home = await temporaryHome()
    const library = path.join(home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library')
    const namedId = '12345678-90ab-cdef-1234-567890abcdef'
    await mkdir(path.join(library, 'Cookies'), { recursive: true })
    await mkdir(path.join(library, 'Safari'), { recursive: true })
    await mkdir(path.join(library, 'WebKit', 'WebsiteDataStore', namedId, 'Cookies'), {
      recursive: true,
    })
    await writeFile(path.join(library, 'Cookies', 'Cookies.binarycookies'), '')
    await writeFile(
      path.join(library, 'WebKit', 'WebsiteDataStore', namedId, 'Cookies', 'Cookies.binarycookies'),
      '',
    )
    const { DatabaseSync } = await import('node:sqlite')
    const metadata = new DatabaseSync(path.join(library, 'Safari', 'SafariTabs.db'))
    metadata.exec(`
      CREATE TABLE bookmarks (
        title TEXT,
        external_uuid TEXT,
        parent INTEGER,
        type INTEGER,
        subtype INTEGER,
        deleted INTEGER,
        order_index INTEGER
      );
      INSERT INTO bookmarks VALUES ('Personal', 'DefaultProfile', 0, 1, 2, 0, 0);
      INSERT INTO bookmarks VALUES ('Work', '${namedId.toUpperCase()}', 0, 1, 2, 0, 1);
      INSERT INTO bookmarks VALUES ('Unsafe', '../escape', 0, 1, 2, 0, 2);
    `)
    metadata.close()

    const safari = (await listBrowserImportSources({ home, platform: 'darwin' })).find(
      (source) => source.id === 'safari',
    )

    expect(safari?.profiles).toEqual([
      { directory: '.', name: 'Personal' },
      {
        directory: path.join(library, 'WebKit', 'WebsiteDataStore', namedId, 'Cookies'),
        name: 'Work',
      },
    ])
  })

  it('uses declared Chromium profiles and drops metadata path traversal', async () => {
    const home = await temporaryHome()
    const root = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
    await mkdir(path.join(root, 'Default', 'Network'), { recursive: true })
    await mkdir(path.join(home, 'outside', 'Network'), { recursive: true })
    await writeFile(path.join(root, 'Default', 'Network', 'Cookies'), '')
    await writeFile(path.join(home, 'outside', 'Network', 'Cookies'), '')
    await writeFile(
      path.join(root, 'Local State'),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Personal' },
            '../outside': { name: 'Escaped' },
          },
        },
      }),
    )

    const sources = await listBrowserImportSources({ home, platform: 'darwin' })

    expect(sources.find((source) => source.id === 'chrome')).toMatchObject({
      profiles: [{ directory: 'Default', name: 'Personal' }],
    })
  })

  it('discovers Chromium browsers that keep their cookie database at the user-data root', async () => {
    const home = await temporaryHome()
    const root = path.join(home, '.config', 'opera')
    await mkdir(path.join(root, 'Network'), { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(path.join(root, 'Network', 'Cookies'))
    database.exec("CREATE TABLE cookies (name TEXT); INSERT INTO cookies VALUES ('session');")
    database.close()

    const opera = (await listBrowserImportSources({ home, platform: 'linux' })).find(
      (source) => source.id === 'opera',
    )

    expect(opera).toMatchObject({
      profiles: [{ directory: '.', name: 'Default', cookieCount: 1 }],
    })
  })

  it('marks a live Chromium singleton conservatively and clears a stale one', async () => {
    const home = await temporaryHome()
    const root = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
    await mkdir(path.join(root, 'Default', 'Network'), { recursive: true })
    await writeFile(path.join(root, 'Default', 'Network', 'Cookies'), '')
    await writeFile(
      path.join(root, 'Local State'),
      JSON.stringify({ profile: { info_cache: { Default: { name: 'Default' } } } }),
    )
    const lock = path.join(root, 'SingletonLock')
    await symlink(`${hostname()}-${String(process.pid)}`, lock)

    let chrome = (await listBrowserImportSources({ home, platform: 'darwin' })).find(
      (source) => source.id === 'chrome',
    )
    expect(chrome?.unavailable).toBe('browser-running')

    await rm(lock)
    await symlink(`${hostname()}-999999999`, lock)
    chrome = (await listBrowserImportSources({ home, platform: 'darwin' })).find(
      (source) => source.id === 'chrome',
    )
    expect(chrome?.unavailable).toBeUndefined()
  })

  it('finds Firefox Snap profiles with absolute paths and counts default-container cookies', async () => {
    const home = await temporaryHome()
    const profile = path.join(
      home,
      'snap',
      'firefox',
      'common',
      '.mozilla',
      'firefox',
      'snap.default',
    )
    await mkdir(profile, { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(path.join(profile, 'cookies.sqlite'))
    database.exec(`
      CREATE TABLE moz_cookies (originAttributes TEXT NOT NULL);
      INSERT INTO moz_cookies VALUES (''), (''), ('^userContextId=2');
    `)
    database.close()

    const firefox = (await listBrowserImportSources({ home, platform: 'linux' })).find(
      (source) => source.id === 'firefox',
    )

    expect(firefox?.profiles).toEqual([
      { directory: profile, name: 'snap.default', cookieCount: 2 },
    ])
  })
})
