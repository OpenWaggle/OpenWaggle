import { describe, expect, it } from 'vitest'
import type { PortContract } from '../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { secureStorageContract } from '../../../ports/desktop-shell/__tests__/contracts/secure-storage.contract'
import { createKeychainSecureStorage, type KeychainKeyStore } from '../electrobun-secure-storage'
import { isSealedBlob } from '../../../electron-migration/keychain-sealer'

function memoryKeychain() {
  const items = new Map<string, string>()
  const calls: string[] = []
  const keychain = { available: true }
  const store: KeychainKeyStore = (item) => {
    calls.push(item.create === null ? 'read' : 'create')
    if (!keychain.available) throw new Error('no keyring')
    const id = `${item.service}/${item.name}`
    if (!items.has(id) && item.create !== null) items.set(id, item.create)
    return items.get(id) ?? null
  }
  return { items, calls, keychain, store }
}

function storage(keychain: ReturnType<typeof memoryKeychain>, now = () => 0) {
  return createKeychainSecureStorage({
    store: keychain.store,
    name: () => 'openwaggle',
    withCreationLock: (operation) => operation(),
    now,
  })
}

/** One test per contract case, each against a fresh harness of the Electrobun adapter. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electrobun)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

runContract(secureStorageContract, async () => {
  const keychain = memoryKeychain()
  return {
    subject: storage(keychain),
    makeUnavailable: () => {
      keychain.keychain.available = false
    },
  }
})

describe('Electrobun SecureStorage', () => {
  it('seals in the migration format with one key it creates once and then reuses', () => {
    const keychain = memoryKeychain()
    const first = storage(keychain)
    const sealed = first.encryptString('token')
    expect(isSealedBlob(sealed)).toBe(true)
    expect([...keychain.items.keys()]).toEqual(['OpenWaggle Secret Storage/openwaggle'])
    // Another process finds the same key and opens what the first one sealed.
    expect(storage(keychain).decryptString(sealed)).toBe('token')
    first.encryptString('again')
    expect(keychain.calls).toEqual(['read', 'create', 'read'])
  })

  it('warms from an in-process read without starting the key child', async () => {
    const keychain = memoryKeychain()
    const sealed = storage(keychain).encryptString('warm')
    keychain.calls.length = 0
    const warmed = createKeychainSecureStorage({
      store: keychain.store,
      read: async (item) => keychain.items.get(`${item.service}/${item.name}`) ?? null,
      name: () => 'openwaggle',
      withCreationLock: (operation) => operation(),
    })
    await warmed.warm()
    expect(warmed.decryptString(sealed)).toBe('warm')
    expect(keychain.calls).toEqual([])
  })

  it('asks the keychain again only after an unavailable answer has aged', () => {
    const keychain = memoryKeychain()
    keychain.keychain.available = false
    const clock = { now: 0 }
    const subject = storage(keychain, () => clock.now)
    expect(subject.isEncryptionAvailable()).toBe(false)
    keychain.keychain.available = true
    expect(subject.isEncryptionAvailable()).toBe(false)
    clock.now = 60_000
    expect(subject.isEncryptionAvailable()).toBe(true)
  })
})
