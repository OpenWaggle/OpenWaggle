import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function loadEnv() {
  const env = await import('../env')
  const { applyPiPackageDirectoryTo, withShellPiPackageDirectory } = await import(
    '../pi-package-directory-environment'
  )
  return { ...env, applyPiPackageDirectoryTo, withShellPiPackageDirectory }
}

const BUNDLED_PI =
  '/Applications/OpenWaggle.app/Contents/Resources/app.asar/node_modules/@earendil-works/pi-coding-agent'
const USER_PI = '/nix/store/pi'

describe('Pi package directory environment', () => {
  it("always points OpenWaggle's bundled Pi at its own package, even over the user's value", async () => {
    const { applyPiPackageDirectoryTo } = await loadEnv()
    const unset: NodeJS.ProcessEnv = {}
    applyPiPackageDirectoryTo(BUNDLED_PI, unset)
    expect(unset.PI_PACKAGE_DIR).toBe(BUNDLED_PI)

    const userSet: NodeJS.ProcessEnv = { PI_PACKAGE_DIR: USER_PI }
    applyPiPackageDirectoryTo(BUNDLED_PI, userSet)
    expect(userSet.PI_PACKAGE_DIR).toBe(BUNDLED_PI)
  })

  it("keeps OpenWaggle's own Pi package directory out of agent, terminal, and Host shells", async () => {
    vi.stubEnv('PI_PACKAGE_DIR', undefined)
    const {
      applyPiPackageDirectory,
      getInteractiveTerminalEnv,
      getSessionHostChildEnv,
      withShellPiPackageDirectory,
    } = await loadEnv()
    applyPiPackageDirectory(BUNDLED_PI)

    expect(getInteractiveTerminalEnv('1.0.0').PI_PACKAGE_DIR).toBeUndefined()
    // The detached Session Host sets its own value again, from the environment the user had.
    expect(getSessionHostChildEnv().PI_PACKAGE_DIR).toBeUndefined()
    expect(withShellPiPackageDirectory({ PI_PACKAGE_DIR: BUNDLED_PI, KEEP: '1' })).toEqual({
      KEEP: '1',
    })
  })

  it("passes a user's own PI_PACKAGE_DIR through to the shells OpenWaggle starts", async () => {
    vi.stubEnv('PI_PACKAGE_DIR', USER_PI)
    const {
      applyPiPackageDirectory,
      getInteractiveTerminalEnv,
      getSessionHostChildEnv,
      withShellPiPackageDirectory,
    } = await loadEnv()
    applyPiPackageDirectory(BUNDLED_PI)

    expect(getInteractiveTerminalEnv('1.0.0').PI_PACKAGE_DIR).toBe(USER_PI)
    expect(getSessionHostChildEnv().PI_PACKAGE_DIR).toBe(USER_PI)
    expect(withShellPiPackageDirectory({ PI_PACKAGE_DIR: BUNDLED_PI })).toEqual({
      PI_PACKAGE_DIR: USER_PI,
    })
  })
})
