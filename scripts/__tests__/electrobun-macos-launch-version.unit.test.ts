import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyLaunchVersion, withMinimumSystemVersion } from '../electrobun-macos-launch-version'

const HUTCH_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
</dict>
</plist>
`

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

async function bundle(directory: string, name: string) {
  const plist = path.join(directory, name, 'Contents', 'Info.plist')
  await fs.mkdir(path.dirname(plist), { recursive: true })
  await fs.writeFile(plist, HUTCH_PLIST)
  return plist
}

async function directory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launch-version-'))
  temporaryRoots.push(root)
  return root
}

describe('withMinimumSystemVersion', () => {
  it('adds LSMinimumSystemVersion to a property list that has none', () => {
    const plist = withMinimumSystemVersion(HUTCH_PLIST, '12.0')
    expect(plist).toMatch(/<key>LSMinimumSystemVersion<\/key>\s*<string>12\.0<\/string>\n<\/dict>/u)
    expect(plist).toContain('<key>CFBundleExecutable</key>')
  })

  it('replaces an existing value instead of adding a second key', () => {
    const plist = withMinimumSystemVersion(withMinimumSystemVersion(HUTCH_PLIST, '14.0'), '12.0')
    expect(plist.match(/LSMinimumSystemVersion/gu)).toHaveLength(1)
    expect(plist).toContain('<string>12.0</string>')
  })

  it('refuses a property list it cannot place the key in', () => {
    expect(() => withMinimumSystemVersion('<plist/>', '12.0')).toThrow(/closing/u)
  })
})

describe('applyLaunchVersion', () => {
  it('sets every app bundle of a postBuild build directory', async () => {
    const build = await directory()
    const plist = await bundle(build, 'OpenWaggle.app')
    const bundles = await applyLaunchVersion({
      ELECTROBUN_OS: 'macos',
      ELECTROBUN_BUILD_DIR: build,
    })
    expect(bundles).toEqual([path.join(build, 'OpenWaggle.app')])
    expect(await fs.readFile(plist, 'utf8')).toContain('<string>12.0</string>')
  })

  it('sets only the wrapper during postWrap', async () => {
    const build = await directory()
    const inner = await bundle(build, 'OpenWaggle.app')
    const wrapperRoot = await directory()
    const wrapper = await bundle(wrapperRoot, 'OpenWaggle.app')
    await applyLaunchVersion({
      ELECTROBUN_OS: 'macos',
      ELECTROBUN_BUILD_DIR: build,
      ELECTROBUN_WRAPPER_BUNDLE_PATH: path.join(wrapperRoot, 'OpenWaggle.app'),
    })
    expect(await fs.readFile(wrapper, 'utf8')).toContain('LSMinimumSystemVersion')
    expect(await fs.readFile(inner, 'utf8')).not.toContain('LSMinimumSystemVersion')
  })

  it('does nothing for other platforms and fails when macOS has no bundle', async () => {
    expect(await applyLaunchVersion({ ELECTROBUN_OS: 'linux' })).toEqual([])
    await expect(
      applyLaunchVersion({ ELECTROBUN_OS: 'macos', ELECTROBUN_BUILD_DIR: await directory() }),
    ).rejects.toThrow(/No macOS app bundle/u)
  })
})
