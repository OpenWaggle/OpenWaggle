import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverPackagedApps, parseFloorArguments } from '../native-platform-floor-targets'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function dist(paths: readonly string[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-floor-dist-'))
  temporaryRoots.push(root)
  for (const relative of paths) {
    const target = path.join(root, relative)
    if (relative.endsWith('/')) {
      await fs.mkdir(target, { recursive: true })
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, '')
    }
  }
  return root
}

describe('parseFloorArguments', () => {
  it('defaults to the host platform and takes app paths', () => {
    expect(parseFloorArguments(['--', 'a.app'], 'darwin')).toEqual({ platform: 'darwin', paths: ['a.app'] })
  })

  it('accepts an explicit platform, for checking another platform from a local extract', () => {
    expect(parseFloorArguments(['--platform', 'linux', 'root'], 'darwin')).toEqual({
      platform: 'linux',
      paths: ['root'],
    })
  })

  it('rejects platforms the guard does not know', () => {
    expect(() => parseFloorArguments([], 'freebsd')).toThrow(/Usage/u)
    expect(() => parseFloorArguments(['--platform'], 'linux')).toThrow(/Usage/u)
  })
})

describe('discoverPackagedApps', () => {
  it('finds both macOS app bundles electron-builder writes', async () => {
    const root = await dist(['mac/OpenWaggle.app/', 'mac-arm64/OpenWaggle.app/', 'openwaggle.dmg'])
    expect(await discoverPackagedApps('darwin', root)).toEqual([
      path.join(root, 'mac-arm64/OpenWaggle.app'),
      path.join(root, 'mac/OpenWaggle.app'),
    ])
  })

  it('inspects the shipped AppImage on Linux rather than the unpacked directory', async () => {
    const root = await dist(['linux-unpacked/', 'openwaggle-1.0.0-x86_64.AppImage'])
    expect(await discoverPackagedApps('linux', root)).toEqual([path.join(root, 'openwaggle-1.0.0-x86_64.AppImage')])
  })

  it('finds the unpacked Windows app', async () => {
    const root = await dist(['win-unpacked/', 'openwaggle-1.0.0-x64.exe'])
    expect(await discoverPackagedApps('win32', root)).toEqual([path.join(root, 'win-unpacked')])
  })

  it('fails closed when nothing was packaged', async () => {
    const root = await dist([])
    await expect(discoverPackagedApps('linux', root)).rejects.toThrow(/No packaged linux app/u)
  })
})
