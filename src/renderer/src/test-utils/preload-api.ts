/** What the bridge answers `undefined` for, so `await`, JSON and DOM probes do not see a method. */
const NOT_METHODS = new Set(['then', 'toJSON', 'hasAttribute'])

function absentMember(name: string) {
  // The real bridge answers a member the preload lacks the same way: a subscription that never
  // fires, and a call that rejects.
  if (name.startsWith('on')) return () => () => {}
  return () => Promise.reject(new Error(`The test preload has no "${name}".`))
}

/**
 * The renderer's `api` for a test that mocks `@/shared/lib/ipc`: the members the test gives, and
 * for every other name what `src/renderer/src/shared/lib/ipc.ts` returns when the preload lacks
 * it. A plain partial object answers `undefined`, so code that rightly calls a contract member,
 * with no `typeof` guard, would throw where the app never does.
 *
 * `vi.mock('@/shared/lib/ipc', async () => ({
 *   api: (await import('@/test-utils/preload-api')).preloadApi(apiMocks),
 * }))`
 */
export function preloadApi<Members extends object>(members: Members): Members {
  return new Proxy(members, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver)
      if (value !== undefined) return value
      if (typeof name !== 'string' || NOT_METHODS.has(name)) return undefined
      return absentMember(name)
    },
  })
}
