import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createKeychainSecureStorage, mockKeychainKeyStore } from '../electrobun-secure-storage'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function profile() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ow-mock-keychain-'))
  directories.push(directory)
  return directory
}

function storage(directory: string) {
  return createKeychainSecureStorage({
    store: mockKeychainKeyStore(() => directory),
    name: () => 'qa profile/1',
    withCreationLock: (operation) => operation(),
  })
}

/** `--use-mock-keychain`: QA keeps its key in the profile, never in the OS keychain. */
describe('the mock keychain', () => {
  it('reads nothing until a key is created, then answers every reader alike', async () => {
    const directory = await profile()
    const store = mockKeychainKeyStore(() => directory)
    const item = { service: 'OpenWaggle Secret Storage', name: 'qa profile/1' }

    expect(store({ ...item, create: null })).toBeNull()
    expect(store({ ...item, create: 'first' })).toBe('first')
    expect(store({ ...item, create: 'second' })).toBe('first')
    expect(store({ ...item, create: null })).toBe('first')
  })

  // Windows has no POSIX file modes; its profile directory is the user's own.
  it.runIf(process.platform !== 'win32')(
    'keeps the key owner-only inside the profile',
    async () => {
      const directory = await profile()
      storage(directory).encryptString('secret')

      const file = path.join(directory, 'mock-keychain', encodeURIComponent('qa profile/1'))
      expect((await stat(file)).mode & 0o777).toBe(0o600)
    },
  )

  it('decrypts in another process of the same profile', async () => {
    const directory = await profile()
    const sealed = storage(directory).encryptString('secret')

    expect(storage(directory).decryptString(sealed)).toBe('secret')
  })
})
