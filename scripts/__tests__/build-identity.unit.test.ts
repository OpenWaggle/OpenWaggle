import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  MAC_DEV_DOCK_ICON,
  resolveBuildChannel,
  resolveBuildIdentity,
  resolveDevSlug,
  resolveIconBasePath,
  resolveMacIconPath,
} from '../build-identity'
import { electrobunAppConfig } from '../electrobun/app-config'
import { stagedResources } from '../electrobun/stage'

function appConfig(channel: 'stable' | 'beta' | 'dev') {
  const environment = channel === 'dev' ? {} : { OPENWAGGLE_RELEASE_CHANNEL: channel }
  return electrobunAppConfig({
    identity: resolveBuildIdentity(environment),
    version: '1.0.0',
    environment,
  })
}

const CWD = process.cwd()

describe('build channel resolution (provenance-gated)', () => {
  it('honours an explicit release-workflow channel signal', () => {
    for (const channel of ['stable', 'alpha', 'beta', 'rc'] as const) {
      expect(resolveBuildChannel({ OPENWAGGLE_RELEASE_CHANNEL: channel })).toBe(channel)
    }
    expect(resolveBuildChannel({ OPENWAGGLE_RELEASE_CHANNEL: 'ALPHA' })).toBe('alpha')
  })

  it('defaults to dev when no channel signal is present', () => {
    expect(resolveBuildChannel({})).toBe('dev')
  })

  it('never trusts the version string as a channel signal', () => {
    // A dev build off the release train carries -alpha.N but is still dev.
    expect(resolveBuildChannel({ npm_package_version: '0.3.0-alpha.66' })).toBe('dev')
  })

  it('refuses bogus channel values, falling back to dev', () => {
    expect(resolveBuildChannel({ OPENWAGGLE_RELEASE_CHANNEL: 'nightly' })).toBe('dev')
  })
})

describe('dev slug', () => {
  it('sanitizes an explicit slug to a reverse-DNS-safe token', () => {
    expect(resolveDevSlug({ OPENWAGGLE_DEV_SLUG: 'feat/Build Identity!' }, CWD)).toBe(
      'feat-build-identity',
    )
  })

  it('falls back to local when the slug is empty after sanitizing', () => {
    expect(resolveDevSlug({ OPENWAGGLE_DEV_SLUG: '///' }, CWD)).toBe('local')
  })
})

describe('build identity', () => {
  it('gives stable the canonical identity and does not isolate userData', () => {
    expect(resolveBuildIdentity({ OPENWAGGLE_RELEASE_CHANNEL: 'stable' }, CWD)).toEqual({
      channel: 'stable',
      slug: null,
      productName: 'OpenWaggle',
      appId: 'com.openwaggle.app',
      isolateUserData: false,
    })
  })

  it('gives release channels the canonical appId but a distinct display name', () => {
    const alpha = resolveBuildIdentity({ OPENWAGGLE_RELEASE_CHANNEL: 'alpha' }, CWD)
    const beta = resolveBuildIdentity({ OPENWAGGLE_RELEASE_CHANNEL: 'beta' }, CWD)
    const rc = resolveBuildIdentity({ OPENWAGGLE_RELEASE_CHANNEL: 'rc' }, CWD)
    // Released channels share one identity (no install-base migration); they
    // differ only in display name and icon.
    for (const id of [alpha, beta, rc]) {
      expect(id.appId).toBe('com.openwaggle.app')
      expect(id.isolateUserData).toBe(false)
    }
    expect(alpha.productName).toBe('OpenWaggle Alpha')
    expect(beta.productName).toBe('OpenWaggle Beta')
    expect(rc.productName).toBe('OpenWaggle RC')
  })

  it('folds dev provenance into a distinct, isolated identity so dev builds coexist', () => {
    const identity = resolveBuildIdentity(
      { OPENWAGGLE_DEV_SLUG: 'feature/terminal-worktree-sessions' },
      CWD,
    )
    expect(identity.channel).toBe('dev')
    expect(identity.slug).toBe('feature-terminal-worktree-sessions')
    expect(identity.productName).toBe('OpenWaggle Dev (feature-terminal-worktree-sessions)')
    expect(identity.appId).toBe('com.openwaggle.dev.feature-terminal-worktree-sessions')
    expect(identity.isolateUserData).toBe(true)
    // ASCII-only: a non-ASCII product name propagates into the app's User-Agent
    // (an HTTP ByteString header) and throws on every request. Regression guard.
    expect(identity.productName).toMatch(/^[\x20-\x7e]*$/u)
  })
})

describe('icon path', () => {
  it('keeps the hand-authored icon for stable and a labelled variant per channel', () => {
    expect(resolveIconBasePath('stable', 'build')).toBe('build/icon.png')
    expect(resolveIconBasePath('alpha', 'build')).toBe('build/icon-alpha.png')
    expect(resolveIconBasePath('beta', 'build')).toBe('build/icon-beta.png')
    expect(resolveIconBasePath('rc', 'build')).toBe('build/icon-rc.png')
    expect(resolveIconBasePath('dev', 'build')).toBe('build/icon-dev.png')
  })

  it('ships the channel icon as the runtime icon resource (dock/taskbar match the channel)', () => {
    const channelIcon = resolveIconBasePath('beta', 'build')
    expect(stagedResources(channelIcon)).toContainEqual({ from: channelIcon, to: 'icon.png' })
    expect(appConfig('beta').build.linux.icon).toBe(channelIcon)
  })

  it('has a committed icon asset for every channel', () => {
    const repoRoot = path.resolve(__dirname, '..', '..')
    for (const channel of ['stable', 'alpha', 'beta', 'rc', 'dev'] as const) {
      const iconPath = path.join(repoRoot, resolveIconBasePath(channel, 'build'))
      expect(existsSync(iconPath), `${iconPath} is missing`).toBe(true)
      const macIconPath = path.join(repoRoot, resolveMacIconPath(channel, 'build'))
      expect(existsSync(macIconPath), `${macIconPath} is missing`).toBe(true)
    }
    expect(existsSync(path.join(repoRoot, 'build', MAC_DEV_DOCK_ICON))).toBe(true)
  })

  it('gives every channel its own rounded-square macOS icon', () => {
    expect(resolveMacIconPath('stable', 'build')).toBe('build/icon.icns')
    expect(resolveMacIconPath('beta', 'build')).toBe('build/icon-beta.icns')
  })
})

describe('Session link scheme', () => {
  it('is declared by release channels and never by dev builds', () => {
    expect(appConfig('dev').app).not.toHaveProperty('urlSchemes')
    expect(appConfig('stable').app).toMatchObject({ urlSchemes: ['openwaggle'] })
    expect(appConfig('beta').app).toMatchObject({ urlSchemes: ['openwaggle'] })
  })
})

describe('packaged runtime resources', () => {
  it('includes the prepared semantic model used by packaged Session search', () => {
    expect(stagedResources('build/icon.png')).toContainEqual({
      from: 'build/session-embedding-model',
      to: 'session-embedding-model',
    })
  })
})
