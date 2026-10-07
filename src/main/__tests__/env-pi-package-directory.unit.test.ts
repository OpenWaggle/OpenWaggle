import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function loadEnv() {
  const env = await import('../env')
  const { applyPiPackageDirectoryTo, withoutInjectedPiPackageDirectory } = await import(
    '../pi-package-directory-environment'
  )
  return { ...env, applyPiPackageDirectoryTo, withoutInjectedPiPackageDirectory }
}

const BUNDLED_PI =
  '/Applications/OpenWaggle.app/Contents/Resources/app.asar/node_modules/@earendil-works/pi-coding-agent'

describe('Pi package directory environment', () => {
  it('points Pi at its package directory unless PI_PACKAGE_DIR is already set', async () => {
    const { applyPiPackageDirectoryTo } = await loadEnv()
    const unset: NodeJS.ProcessEnv = {}
    applyPiPackageDirectoryTo(BUNDLED_PI, unset)
    expect(unset.PI_PACKAGE_DIR).toBe(BUNDLED_PI)

    const overridden: NodeJS.ProcessEnv = { PI_PACKAGE_DIR: '/nix/store/pi' }
    applyPiPackageDirectoryTo(BUNDLED_PI, overridden)
    expect(overridden.PI_PACKAGE_DIR).toBe('/nix/store/pi')
  })

  it("keeps OpenWaggle's own Pi package directory out of agent and terminal shells", async () => {
    vi.stubEnv('PI_PACKAGE_DIR', undefined)
    const {
      applyPiPackageDirectory,
      getInteractiveTerminalEnv,
      getSessionHostChildEnv,
      withoutInjectedPiPackageDirectory,
    } = await loadEnv()
    applyPiPackageDirectory(BUNDLED_PI)

    // The detached Session Host runs the same bundled Pi, so it inherits the value.
    expect(getSessionHostChildEnv().PI_PACKAGE_DIR).toBe(BUNDLED_PI)
    expect(getInteractiveTerminalEnv('1.0.0').PI_PACKAGE_DIR).toBeUndefined()
    expect(withoutInjectedPiPackageDirectory({ PI_PACKAGE_DIR: BUNDLED_PI, KEEP: '1' })).toEqual({
      KEEP: '1',
    })
  })

  it("passes a user's own PI_PACKAGE_DIR through to shells", async () => {
    vi.stubEnv('PI_PACKAGE_DIR', '/nix/store/pi')
    const {
      getInteractiveTerminalEnv,
      applyPiPackageDirectory,
      withoutInjectedPiPackageDirectory,
    } = await loadEnv()
    applyPiPackageDirectory(BUNDLED_PI)

    expect(getInteractiveTerminalEnv('1.0.0').PI_PACKAGE_DIR).toBe('/nix/store/pi')
    expect(withoutInjectedPiPackageDirectory({ PI_PACKAGE_DIR: '/nix/store/pi' })).toEqual({
      PI_PACKAGE_DIR: '/nix/store/pi',
    })
  })
})
