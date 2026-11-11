import { describe, expect, it, vi } from 'vitest'

const lookups = vi.hoisted(() => ({ names: new Array<string>() }))

// Each directory lookup is recorded, so the test sees any made while modules load.
vi.mock('../desktop-shell/app-paths', async () => {
  const { fakeAppPaths } = await import('../test-support/fake-desktop-shell')
  const paths = fakeAppPaths()
  return {
    appPaths: {
      ...paths,
      userData: () => {
        lookups.names.push('userData')
        return paths.userData()
      },
      logs: () => {
        lookups.names.push('logs')
        return paths.logs()
      },
      appData: () => {
        lookups.names.push('appData')
        return paths.appData()
      },
    },
  }
})

/*
 * `userData` moves to OPENWAGGLE_USER_DATA_DIR (QA, tests) only once startup applies it, so a
 * lookup made while modules load would resolve the default profile "~/Library/Application
 * Support/<app name>" instead of the overridden one, and anything derived from it would land
 * there.
 */
describe('Main process startup imports', () => {
  it('look up no profile directory while they load', async () => {
    await import('../application-protocols')

    expect(lookups.names).toEqual([])
  })
})
