import { describe, expect, it } from 'vitest'
import { createKeychainSealer, isSealedBlob, type KeychainSecrets } from '../keychain-sealer'

function memorySecrets() {
  const items = new Map<string, string>()
  let writes = 0
  const secrets: KeychainSecrets = {
    get: async ({ service, name }) => items.get(`${service}\0${name}`) ?? null,
    set: async ({ service, name, value }) => {
      writes += 1
      items.set(`${service}\0${name}`, value)
    },
  }
  return { secrets, items, writes: () => writes }
}

function serialLock() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(operation: () => Promise<T>) => {
    const run = tail.then(operation)
    tail = run.catch(() => undefined)
    return run
  }
}

const ITEM = { service: 'openwaggle Secret Storage', name: 'openwaggle' }

describe('keychain sealer', () => {
  it('round-trips a secret under a key it creates once in the keychain', async () => {
    const store = memorySecrets()
    const sealer = createKeychainSealer({
      ...ITEM,
      secrets: store.secrets,
      withCreationLock: serialLock(),
    })
    const blob = await sealer.seal('mcp token ✓')
    expect(isSealedBlob(blob)).toBe(true)
    await expect(sealer.open(blob)).resolves.toBe('mcp token ✓')
    expect(store.items.size).toBe(1)
  })

  it('never stores two keys when two sealers start at once', async () => {
    const store = memorySecrets()
    const lock = serialLock()
    const first = createKeychainSealer({ ...ITEM, secrets: store.secrets, withCreationLock: lock })
    const second = createKeychainSealer({ ...ITEM, secrets: store.secrets, withCreationLock: lock })
    const [left, right] = await Promise.all([first.seal('left'), second.seal('right')])
    expect(store.writes()).toBe(1)
    await expect(second.open(left)).resolves.toBe('left')
    await expect(first.open(right)).resolves.toBe('right')
  })

  it('does not open a blob sealed under another key', async () => {
    const one = createKeychainSealer({
      ...ITEM,
      secrets: memorySecrets().secrets,
      withCreationLock: serialLock(),
    })
    const other = createKeychainSealer({
      ...ITEM,
      secrets: memorySecrets().secrets,
      withCreationLock: serialLock(),
    })
    const blob = await one.seal('secret')
    await other.seal('creates its own key')
    await expect(other.open(blob)).rejects.toThrow()
  })

  it('asks the keychain again after a failed read', async () => {
    const store = memorySecrets()
    let fail = true
    const flaky: KeychainSecrets = {
      get: async (item) => {
        if (fail) throw new Error('keychain locked')
        return store.secrets.get(item)
      },
      set: store.secrets.set,
    }
    const sealer = createKeychainSealer({ ...ITEM, secrets: flaky, withCreationLock: serialLock() })
    await expect(sealer.seal('first')).rejects.toThrow('keychain locked')
    fail = false
    await expect(sealer.open(await sealer.seal('second'))).resolves.toBe('second')
  })
})
