import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type MainCompileCacheEnvironment,
  mainCompileCacheLocation,
} from '../main-compile-cache-location'

const HOME = path.join(path.sep, 'home', 'ada')

function environment(
  overrides: Partial<MainCompileCacheEnvironment> = {},
): MainCompileCacheEnvironment {
  return { platform: 'darwin', env: {}, homeDirectory: HOME, channel: 'beta', ...overrides }
}

describe('mainCompileCacheLocation', () => {
  it('keeps one per-user cache per Build channel outside userData and the temp directory', () => {
    expect(mainCompileCacheLocation(environment())).toEqual({
      kind: 'enabled',
      directory: path.join(HOME, 'Library', 'Caches', 'OpenWaggle', 'compile-cache', 'beta'),
    })
    expect(mainCompileCacheLocation(environment({ channel: 'stable' }))).toEqual({
      kind: 'enabled',
      directory: path.join(HOME, 'Library', 'Caches', 'OpenWaggle', 'compile-cache', 'stable'),
    })
  })

  it('does not follow TMPDIR, which an agent shell points at a Session scratch directory', () => {
    const fromAgentShell = environment({ env: { TMPDIR: '/tmp/ow-scratch-501/session' } })

    expect(mainCompileCacheLocation(fromAgentShell)).toEqual(
      mainCompileCacheLocation(environment()),
    )
  })

  it('uses LOCALAPPDATA on Windows and XDG_CACHE_HOME on Linux', () => {
    expect(
      mainCompileCacheLocation(
        environment({ platform: 'win32', env: { LOCALAPPDATA: path.join(HOME, 'Local') } }),
      ),
    ).toEqual({
      kind: 'enabled',
      directory: path.join(HOME, 'Local', 'OpenWaggle', 'Cache', 'compile-cache', 'beta'),
    })
    expect(
      mainCompileCacheLocation(
        environment({ platform: 'linux', env: { XDG_CACHE_HOME: path.join(HOME, 'xdg') } }),
      ),
    ).toEqual({
      kind: 'enabled',
      directory: path.join(HOME, 'xdg', 'openwaggle', 'compile-cache', 'beta'),
    })
    expect(mainCompileCacheLocation(environment({ platform: 'linux' }))).toEqual({
      kind: 'enabled',
      directory: path.join(HOME, '.cache', 'openwaggle', 'compile-cache', 'beta'),
    })
  })

  it('ignores a relative XDG_CACHE_HOME, as the XDG specification requires', () => {
    expect(
      mainCompileCacheLocation(
        environment({ platform: 'linux', env: { XDG_CACHE_HOME: 'cache' } }),
      ),
    ).toEqual({
      kind: 'enabled',
      directory: path.join(HOME, '.cache', 'openwaggle', 'compile-cache', 'beta'),
    })
  })

  it('skips an AppImage, which mounts at a new path on every launch', () => {
    expect(
      mainCompileCacheLocation(
        environment({ platform: 'linux', env: { APPIMAGE: '/opt/OpenWaggle.AppImage' } }),
      ),
    ).toEqual({ kind: 'disabled', reason: 'appimage' })
  })

  it('can be moved for measurement profiles and turned off', () => {
    const override = path.join(path.sep, 'perf', 'cache')
    expect(
      mainCompileCacheLocation(environment({ env: { OPENWAGGLE_COMPILE_CACHE_DIR: override } })),
    ).toEqual({ kind: 'enabled', directory: path.join(override, 'beta') })
    expect(
      mainCompileCacheLocation(environment({ env: { OPENWAGGLE_DISABLE_COMPILE_CACHE: '1' } })),
    ).toEqual({ kind: 'disabled', reason: 'opted-out' })
  })
})
