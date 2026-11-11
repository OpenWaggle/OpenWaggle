import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkNativePlatformFloor, formatFloorReport } from '../check-native-platform-floor'
import { packageJson } from './packaged-app-fixtures'
import {
  ELF_MACHINE,
  elfImage,
  fatMachOImage,
  MACHO_CPU,
  machOImage,
  PE_MACHINE,
  peImage,
} from './native-binary-fixtures'

const temporaryRoots: string[] = []

const APP_MANIFEST = packageJson('openwaggle')

/**
 * An unwrapped Electrobun app tree; it gets the app's package.json at both the macOS and the
 * Linux/Windows app directory.
 */
async function tree(files: Record<string, Buffer | string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-floor-'))
  temporaryRoots.push(root)
  const withApp = {
    'Contents/Resources/app/package.json': APP_MANIFEST,
    'Resources/app/package.json': APP_MANIFEST,
    ...files,
  }
  for (const [relative, contents] of Object.entries(withApp)) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await fs.writeFile(path.join(root, relative), contents)
  }
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

const libc = (...versions: string[]) => ({ file: 'libc.so.6', versions })
const libstdcxx = (...versions: string[]) => ({ file: 'libstdc++.so.6', versions })
const SQLITE = 'Resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
const LAUNCHER = 'bin/launcher'

function infoPlist(minimumSystemVersion: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>LSMinimumSystemVersion</key><string>${minimumSystemVersion}</string></dict></plist>`
}

describe('Linux native platform floor', () => {
  it('passes when every x64 ELF needs at most glibc 2.35 and GLIBCXX 3.4.30', async () => {
    const root = await tree({
      [LAUNCHER]: elfImage({ needs: [libc('GLIBC_2.2.5', 'GLIBC_2.34', 'GLIBC_PRIVATE')] }),
      [SQLITE]: elfImage({
        needs: [libc('GLIBC_2.35'), libstdcxx('GLIBCXX_3.4.30', 'CXXABI_1.3.13')],
      }),
    })
    const report = await checkNativePlatformFloor(root, 'linux')
    expect(report.violations).toEqual([])
    expect(report.checked).toBe(2)
    expect(report.architectures).toEqual(['x64'])
  })

  it('fails on a native module built against glibc 2.38, as node-pty was in beta.25', async () => {
    const root = await tree({
      [LAUNCHER]: elfImage({ needs: [libc('GLIBC_2.34')] }),
      [SQLITE]: elfImage({
        needs: [libc('GLIBC_2.38'), libstdcxx('GLIBCXX_3.4.31', 'CXXABI_1.3.15')],
      }),
    })
    const report = await checkNativePlatformFloor(root, 'linux')
    expect(report.violations).toEqual([
      `${SQLITE} needs GLIBC_2.38 (libc.so.6), above the supported GLIBC_2.35`,
      `${SQLITE} needs GLIBCXX_3.4.31 (libstdc++.so.6), above the supported GLIBCXX_3.4.30`,
      `${SQLITE} needs CXXABI_1.3.15 (libstdc++.so.6), above the supported CXXABI_1.3.13`,
    ])
  })

  it('fails on binaries for another platform or architecture, which can never load', async () => {
    const root = await tree({
      [LAUNCHER]: elfImage({ needs: [libc('GLIBC_2.17')] }),
      'lib/linux-arm64/pty.node': elfImage({
        machine: ELF_MACHINE.aarch64,
        needs: [libc('GLIBC_2.39')],
      }),
      'lib/darwin/pty.node': machOImage({ cpu: MACHO_CPU.arm64, minos: '15.0' }),
      'lib/win32/pty.node': peImage({ subsystemVersion: [10, 0] }),
    })
    const report = await checkNativePlatformFloor(root, 'linux')
    expect(report.checked).toBe(1)
    expect(report.violations).toEqual([
      'lib/darwin/pty.node (Mach-O arm64) cannot load in this x64 app',
      'lib/linux-arm64/pty.node (ELF arm64) cannot load in this x64 app',
      'lib/win32/pty.node (PE x64) cannot load in this x64 app',
    ])
  })

  it('fails closed without the main executable', async () => {
    const root = await tree({ [SQLITE]: elfImage({ needs: [libc('GLIBC_2.17')] }) })
    await expect(checkNativePlatformFloor(root, 'linux')).rejects.toThrow(/launcher/u)
  })
})

describe('macOS native platform floor', () => {
  const executable = 'Contents/MacOS/launcher'
  const onnx = 'Contents/Resources/app/node_modules/onnxruntime-node/bin/libonnxruntime.dylib'

  it('passes the beta.25 shape: a 12.0 executable, 13.4 onnxruntime, and LSMinimumSystemVersion 12.0', async () => {
    const root = await tree({
      [executable]: machOImage({ cpu: MACHO_CPU.arm64, minos: '12.0' }),
      [onnx]: machOImage({ cpu: MACHO_CPU.arm64, minos: '13.4' }),
      'Contents/Info.plist': infoPlist('12.0'),
    })
    const report = await checkNativePlatformFloor(root, 'darwin')
    expect(report.violations).toEqual([])
    expect(report.checked).toBe(2)
  })

  it('fails when a library needs a macOS newer than 13.4 or has no minimum', async () => {
    const root = await tree({
      [executable]: machOImage({ cpu: MACHO_CPU.arm64, minos: '12.0' }),
      [onnx]: machOImage({ cpu: MACHO_CPU.arm64, minos: '14.0' }),
      'Contents/lib/unversioned.dylib': machOImage({ cpu: MACHO_CPU.arm64 }),
      'Contents/Info.plist': infoPlist('12.0'),
    })
    const report = await checkNativePlatformFloor(root, 'darwin')
    expect(report.violations).toEqual([
      'Contents/lib/unversioned.dylib (arm64) declares no minimum macOS version',
      `${onnx} (arm64) needs macOS 14.0, above the supported 13.4`,
    ])
  })

  it('fails when the executable or LSMinimumSystemVersion would stop macOS 12 from launching', async () => {
    const root = await tree({
      [executable]: machOImage({ cpu: MACHO_CPU.arm64, minos: '13.0' }),
      'Contents/Info.plist': infoPlist('13.0'),
    })
    const report = await checkNativePlatformFloor(root, 'darwin')
    expect(report.violations).toEqual([
      `${executable} (arm64) needs macOS 13.0, so macOS 12.0 could not launch the app`,
      'Contents/Info.plist sets LSMinimumSystemVersion 13.0; it must stay 12.0',
    ])
  })

  it('checks the slices for the app architecture and fails on arm64-only or Linux binaries', async () => {
    const root = await tree({
      [executable]: machOImage({ cpu: MACHO_CPU.x86_64, minos: '12.0' }),
      'Contents/lib/universal.dylib': fatMachOImage([
        { cpu: MACHO_CPU.x86_64, minos: '11.0' },
        { cpu: MACHO_CPU.arm64, minos: '15.0' },
      ]),
      'Contents/lib/arm64-only.node': machOImage({ cpu: MACHO_CPU.arm64, minos: '15.0' }),
      'Contents/lib/linux.node': elfImage({ needs: [libc('GLIBC_2.40')] }),
      'Contents/Info.plist': infoPlist('12.0'),
    })
    const report = await checkNativePlatformFloor(root, 'darwin')
    expect(report.checked).toBe(2)
    expect(report.foreign).toEqual([
      'Contents/lib/arm64-only.node (Mach-O arm64)',
      'Contents/lib/linux.node (ELF x64)',
    ])
    expect(report.violations).toEqual([
      'Contents/lib/arm64-only.node (Mach-O arm64) cannot load in this x64 app',
      'Contents/lib/linux.node (ELF x64) cannot load in this x64 app',
    ])
  })
})

describe('Windows native platform floor', () => {
  it('fails when an x64 or x86 PE requires a Windows newer than 10.0 or an arm64 image ships', async () => {
    const root = await tree({
      'bin/launcher.exe': peImage({ osVersion: [6, 0], subsystemVersion: [10, 0] }),
      'Resources/ok.node': peImage({ subsystemVersion: [6, 0] }),
      'Resources/new.dll': peImage({ osVersion: [10, 1] }),
      'Resources/arm64.node': peImage({ machine: PE_MACHINE.arm64, osVersion: [11, 0] }),
      'Resources/elevate.exe': peImage({ machine: PE_MACHINE.x86, subsystemVersion: [10, 2] }),
    })
    const report = await checkNativePlatformFloor(root, 'win32')
    expect(report.violations).toEqual([
      'Resources/arm64.node (PE arm64) cannot load in this x64 app',
      'Resources/elevate.exe needs Windows 10.2, above the supported 10.0',
      'Resources/new.dll needs Windows 10.1, above the supported 10.0',
    ])
    expect(report.checked).toBe(4)
  })
})

describe('formatFloorReport', () => {
  it('summarizes the counts and violations', async () => {
    const root = await tree({
      [LAUNCHER]: elfImage({ needs: [libc('GLIBC_2.38')] }),
      'other.node': elfImage({ machine: ELF_MACHINE.aarch64 }),
    })
    const text = formatFloorReport(await checkNativePlatformFloor(root, 'linux'))
    expect(text).toContain(`linux electrobun native floor (x64): ${root}`)
    expect(text).toContain('checked 1 native binaries, 1 for another platform or architecture')
    expect(text).toContain('  FAIL other.node (ELF arm64) cannot load in this x64 app')
    expect(text).toContain(
      '  FAIL bin/launcher needs GLIBC_2.38 (libc.so.6), above the supported GLIBC_2.35',
    )
  })
})

describe('native packages missing for the app architecture', () => {
  it('fails the Intel app when sharp and keyring shipped only their arm64 builds', async () => {
    const root = await tree({
      'Contents/MacOS/launcher': machOImage({ cpu: MACHO_CPU.x86_64, minos: '12.0' }),
      'Contents/Resources/app/node_modules/sharp/package.json': packageJson('sharp', [
        '@img/sharp-darwin-arm64',
        '@img/sharp-darwin-x64',
      ]),
      'Contents/Resources/app/node_modules/@img/sharp-darwin-x64/package.json':
        packageJson('@img/sharp-darwin-x64'),
      'Contents/Resources/app/node_modules/@napi-rs/keyring/package.json': packageJson(
        '@napi-rs/keyring',
        ['@napi-rs/keyring-darwin-x64'],
      ),
      'Contents/Info.plist': infoPlist('12.0'),
    })
    expect((await checkNativePlatformFloor(root, 'darwin')).violations).toEqual([
      '@napi-rs/keyring-darwin-x64, which @napi-rs/keyring needs on darwin-x64, is not in the app',
    ])
  })
})
