import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverElectrobunApps, parseFloorArguments } from '../native-platform-floor-targets'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
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
    expect(parseFloorArguments(['--', 'a.app'], 'darwin')).toEqual({
      platform: 'darwin',
      paths: ['a.app'],
      devkit: false,
    })
  })

  it('accepts an explicit platform, for checking another platform from a local extract', () => {
    expect(parseFloorArguments(['--platform', 'linux', 'root'], 'darwin')).toEqual({
      platform: 'linux',
      paths: ['root'],
      devkit: false,
    })
  })

  it('checks an Electrobun native-layer devkit, which has to be named', () => {
    expect(parseFloorArguments(['--devkit', 'devkit'], 'linux')).toEqual({
      platform: 'linux',
      paths: ['devkit'],
      devkit: true,
    })
    expect(() => parseFloorArguments(['--devkit'], 'linux')).toThrow(/needs the devkit/u)
  })

  it('rejects platforms the guard does not know', () => {
    expect(() => parseFloorArguments([], 'freebsd')).toThrow(/Usage/u)
    expect(() => parseFloorArguments(['--platform'], 'linux')).toThrow(/Usage/u)
  })
})

describe('discoverElectrobunApps', () => {
  it('checks the unwrapped macOS app package.ts ships, one per architecture', async () => {
    const root = await dist([
      'out/electrobun/inner/stable-macos-arm64/OpenWaggle.app/',
      'out/electrobun/inner/stable-macos-x64/OpenWaggle.app/',
      'out/electrobun/build/stable-macos-arm64/OpenWaggle.app/',
    ])
    expect(await discoverElectrobunApps('darwin', root)).toEqual([
      path.join(root, 'out/electrobun/inner/stable-macos-arm64/OpenWaggle.app'),
      path.join(root, 'out/electrobun/inner/stable-macos-x64/OpenWaggle.app'),
    ])
  })

  it("checks Hutch's wrapper on Windows and Linux, whose payload the guard unpacks", async () => {
    const root = await dist(['out/electrobun/build/stable-win-x64/OpenWaggle/'])
    expect(await discoverElectrobunApps('win32', root)).toEqual([
      path.join(root, 'out/electrobun/build/stable-win-x64/OpenWaggle'),
    ])
    await expect(discoverElectrobunApps('linux', root)).rejects.toThrow(
      /No packaged linux Electrobun app/u,
    )
  })
})
