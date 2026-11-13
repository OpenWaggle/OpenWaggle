import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { checkNativePlatformFloor } from '../check-native-platform-floor'
import { elfImage, MACHO_CPU, machOImage } from './native-binary-fixtures'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

const libc = (...versions: string[]) => ({ file: 'libc.so.6', versions })
const libstdcxx = (...versions: string[]) => ({ file: 'libstdc++.so.6', versions })

function infoPlist(minimumSystemVersion: string) {
  return `<plist version="1.0"><dict><key>LSMinimumSystemVersion</key><string>${minimumSystemVersion}</string></dict></plist>`
}

/** A raw tree, without the Electron app.asar that `tree` adds. */
async function bareTree(files: Record<string, Buffer | string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'electrobun-floor-'))
  temporaryRoots.push(root)
  for (const [relative, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await fs.writeFile(path.join(root, relative), contents)
  }
  return root
}

/** Packs a tree the way Electrobun's self-extracting payload stores it: a zstd-compressed tar. */
async function payload(files: Record<string, Buffer | string>) {
  const source = await bareTree(files)
  const tarball = execFileSync('tar', ['-cf', '-', '-C', source, '.'])
  return zlib.zstdCompressSync(tarball)
}

describe('Electrobun apps', () => {
  const LAUNCHER = 'Contents/MacOS/launcher'
  const INNER = 'OpenWaggle.app/Contents'

  it('checks the macOS wrapper and every binary of its self-extracting payload', async () => {
    const root = await bareTree({
      [LAUNCHER]: machOImage({ cpu: MACHO_CPU.arm64, minos: '12.0' }),
      'Contents/Info.plist': infoPlist('12.0'),
      'Contents/Resources/abc123.tar.zst': await payload({
        [`${INNER}/MacOS/launcher`]: machOImage({ cpu: MACHO_CPU.arm64, minos: '12.0' }),
        [`${INNER}/MacOS/bun`]: machOImage({ cpu: MACHO_CPU.arm64, minos: '13.0' }),
        [`${INNER}/MacOS/libNativeWrapper.dylib`]: machOImage({
          cpu: MACHO_CPU.arm64,
          minos: '14.0',
        }),
        [`${INNER}/Info.plist`]: infoPlist('12.0'),
        [`${INNER}/Resources/app/bun/index.js`]: 'console.log("app")',
      }),
    })
    const report = await checkNativePlatformFloor(root, 'darwin')
    expect(report.shell).toBe('electrobun')
    expect(report.checked).toBe(4)
    expect(report.violations).toEqual([
      'abc123.tar.zst:OpenWaggle.app/Contents/MacOS/libNativeWrapper.dylib (arm64) needs macOS 14.0, above the supported 13.4',
    ])
  })

  it('requires the launch version in the payload app as well as the wrapper', async () => {
    const root = await bareTree({
      [LAUNCHER]: machOImage({ cpu: MACHO_CPU.arm64, minos: '12.0' }),
      'Contents/Info.plist': infoPlist('12.0'),
      'Contents/Resources/abc123.tar.zst': await payload({
        [`${INNER}/MacOS/launcher`]: machOImage({ cpu: MACHO_CPU.arm64, minos: '14.0' }),
        [`${INNER}/Info.plist`]: '<plist><dict></dict></plist>',
      }),
    })
    const { violations } = await checkNativePlatformFloor(root, 'darwin')
    expect(violations).toContain(
      'abc123.tar.zst:OpenWaggle.app/Contents/MacOS/launcher (arm64) needs macOS 14.0, so macOS 12.0 could not launch the app',
    )
  })

  it('checks a Linux Electrobun payload against the glibc floor', async () => {
    const root = await bareTree({
      'bin/launcher': elfImage({ needs: [libc('GLIBC_2.34')] }),
      'Resources/xyz.tar.zst': await payload({
        'OpenWaggle/bin/launcher': elfImage({ needs: [libc('GLIBC_2.34')] }),
        'OpenWaggle/bin/libNativeWrapper.so': elfImage({ needs: [libstdcxx('GLIBCXX_3.4.32')] }),
      }),
    })
    expect((await checkNativePlatformFloor(root, 'linux')).violations).toEqual([
      'xyz.tar.zst:OpenWaggle/bin/libNativeWrapper.so needs GLIBCXX_3.4.32 (libstdc++.so.6), above the supported GLIBCXX_3.4.30',
    ])
  })

  it('fails an Electrobun payload that holds no app', async () => {
    const root = await bareTree({
      'bin/launcher': elfImage({ needs: [libc('GLIBC_2.34')] }),
      'Resources/empty.tar.zst': await payload({ 'README.txt': 'no app' }),
    })
    expect((await checkNativePlatformFloor(root, 'linux')).violations).toEqual([
      'empty.tar.zst contains no app',
    ])
  })

  it('checks a native-layer devkit binary by binary, without bundle checks', async () => {
    const root = await bareTree({
      launcher: machOImage({ cpu: MACHO_CPU.x86_64, minos: '12.0' }),
      'libNativeWrapper.dylib': machOImage({ cpu: MACHO_CPU.x86_64, minos: '13.4' }),
      'cef/bun Helper.app/Contents/MacOS/bun Helper': machOImage({
        cpu: MACHO_CPU.x86_64,
        minos: '14.0',
      }),
    })
    const report = await checkNativePlatformFloor(root, 'darwin', undefined, { devkit: true })
    expect(report.shell).toBe('electrobun-devkit')
    expect(report.violations).toEqual([
      'cef/bun Helper.app/Contents/MacOS/bun Helper (x64) needs macOS 14.0, above the supported 13.4',
    ])
  })
})
