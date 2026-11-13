import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkFileAgainstSdk, parseTbd, SdkStubs } from '../check-macos-sdk-symbols'
import { readMachOImports } from '../macho-imports'
import { machOImportImage, universalImage } from './macho-import-fixtures'
import { MACHO_CPU } from './native-binary-fixtures'

const LIBSYSTEM = '/usr/lib/libSystem.B.dylib'
const APPKIT = '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit'
const CEF = '@rpath/Chromium Embedded Framework.framework/Chromium Embedded Framework'
const NEW_FRAMEWORK = '/System/Library/Frameworks/Fresh.framework/Versions/A/Fresh'

const LIBSYSTEM_TBD = `--- !tapi-tbd
tbd-version:     4
targets:         [ x86_64-macos, arm64-macos,
                   arm64e-macos ]
install-name:    '/usr/lib/libSystem.B.dylib'
reexported-libraries:
  - targets:         [ x86_64-macos, arm64-macos, arm64e-macos ]
    libraries:       [ '/usr/lib/system/libsystem_c.dylib' ]
exports:
  - targets:         [ x86_64-macos, arm64-macos, arm64e-macos ]
    symbols:         [ _mach_absolute_time, 
                       _dyld_stub_binder ]
--- !tapi-tbd
tbd-version:     4
targets:         [ x86_64-macos, arm64-macos, arm64e-macos ]
install-name:    '/usr/lib/system/libsystem_c.dylib'
exports:
  - targets:         [ x86_64-macos, arm64-macos, arm64e-macos ]
    symbols:         [ _malloc, _free ]
...
`

const APPKIT_TBD = `--- !tapi-tbd
tbd-version:     4
targets:         [ x86_64-macos, arm64e-macos ]
install-name:    '/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit'
exports:
  - targets:         [ x86_64-macos, arm64e-macos ]
    symbols:         [ _NSApp ]
    objc-classes:    [ NSView, NSWindow ]
    weak-symbols:    [ _NSWeakExport ]
...
`

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

async function sdk() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macos-sdk-'))
  temporaryRoots.push(root)
  const stubs = {
    'usr/lib/libSystem.B.tbd': LIBSYSTEM_TBD,
    'System/Library/Frameworks/AppKit.framework/Versions/C/AppKit.tbd': APPKIT_TBD,
  }
  for (const [relative, text] of Object.entries(stubs)) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await fs.writeFile(path.join(root, relative), text)
  }
  return root
}

async function binary(image: Buffer) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macho-'))
  temporaryRoots.push(root)
  const file = path.join(root, 'binary')
  await fs.writeFile(file, image)
  return file
}

describe('readMachOImports', () => {
  it('reads libraries and imports from the symbol table and chained fixups', () => {
    const image = machOImportImage({
      libraries: [{ installName: LIBSYSTEM }, { installName: NEW_FRAMEWORK, weak: true }],
      symbolTableImports: [
        { symbol: '_malloc', ordinal: 1 },
        { symbol: '_os_sync_wait_on_address', ordinal: 1, weak: true },
      ],
      fixupImports: [
        { symbol: '_malloc', ordinal: 1, weak: true },
        { symbol: '_FreshThing', ordinal: 2 },
      ],
    })
    const [slice] = readMachOImports(image)
    expect(slice?.architecture).toBe('arm64')
    expect(slice?.libraries).toEqual([
      { installName: LIBSYSTEM, weak: false },
      { installName: NEW_FRAMEWORK, weak: true },
    ])
    expect(slice?.imports).toEqual([
      // Imported strongly once, so required even though the fixup import is weak.
      { symbol: '_malloc', library: LIBSYSTEM, weak: false },
      { symbol: '_os_sync_wait_on_address', library: LIBSYSTEM, weak: true },
      // Everything from a weakly linked library is optional.
      { symbol: '_FreshThing', library: NEW_FRAMEWORK, weak: true },
    ])
  })

  it('reads every slice of a universal binary and ignores non-Mach-O files', () => {
    const arm64 = machOImportImage({ libraries: [{ installName: LIBSYSTEM }] })
    const x64 = machOImportImage({ cpu: MACHO_CPU.x86_64, libraries: [] })
    const universal = universalImage([
      { cpu: MACHO_CPU.arm64, image: arm64 },
      { cpu: MACHO_CPU.x86_64, image: x64 },
    ])
    expect(readMachOImports(universal).map((slice) => slice.architecture)).toEqual(['arm64', 'x64'])
    expect(readMachOImports(arm64)[0]?.libraries).toHaveLength(1)
    expect(readMachOImports(x64)[0]?.architecture).toBe('x64')
    expect(readMachOImports(Buffer.from('#!/bin/sh\n'))).toEqual([])
  })
})

describe('parseTbd', () => {
  it('reads exports per target across wrapped lists, Objective-C classes and re-exports', () => {
    const [libSystem, libC] = parseTbd(LIBSYSTEM_TBD)
    expect(libSystem?.installName).toBe(LIBSYSTEM)
    expect([...(libSystem?.symbols.get('arm64-macos') ?? [])]).toEqual([
      '_mach_absolute_time',
      '_dyld_stub_binder',
    ])
    expect(libSystem?.reexports.get('x86_64-macos')).toEqual(['/usr/lib/system/libsystem_c.dylib'])
    expect(libC?.symbols.get('arm64e-macos')?.has('_free')).toBe(true)

    const [appKit] = parseTbd(APPKIT_TBD)
    const exported = appKit?.symbols.get('arm64e-macos')
    expect(exported?.has('_OBJC_CLASS_$_NSView')).toBe(true)
    expect(exported?.has('_OBJC_METACLASS_$_NSWindow')).toBe(true)
    expect(exported?.has('_NSWeakExport')).toBe(true)
  })
})

describe('checkFileAgainstSdk', () => {
  it('passes imports the SDK exports, directly, re-exported, or for arm64e only', async () => {
    const stubs = new SdkStubs(await sdk())
    const file = await binary(
      machOImportImage({
        libraries: [{ installName: LIBSYSTEM }, { installName: APPKIT }, { installName: CEF }],
        fixupImports: [
          { symbol: '_mach_absolute_time', ordinal: 1 },
          { symbol: '_malloc', ordinal: 1 },
          { symbol: '_OBJC_CLASS_$_NSView', ordinal: 2 },
          { symbol: '_cef_initialize', ordinal: 3 },
        ],
      }),
    )
    expect(await checkFileAgainstSdk(file, 'binary', stubs, ['arm64'])).toEqual({
      slices: 1,
      violations: [],
    })
  })

  it('fails a required symbol or system library the SDK lacks, but allows weak ones', async () => {
    const stubs = new SdkStubs(await sdk())
    const file = await binary(
      machOImportImage({
        cpu: MACHO_CPU.x86_64,
        libraries: [
          { installName: LIBSYSTEM },
          { installName: NEW_FRAMEWORK },
          { installName: '/System/Library/Frameworks/Later.framework/Later', weak: true },
        ],
        fixupImports: [
          { symbol: '_os_sync_wait_on_address', ordinal: 1 },
          { symbol: '_os_sync_wake_by_address_any', ordinal: 1, weak: true },
          { symbol: '_FreshThing', ordinal: 2 },
          { symbol: '_LaterThing', ordinal: 3 },
        ],
      }),
    )
    const report = await checkFileAgainstSdk(file, 'binary', stubs, ['arm64', 'x64'])
    expect(report.violations).toEqual([
      `binary (x64) links ${NEW_FRAMEWORK}, which the SDK does not have`,
      `binary (x64) imports _os_sync_wait_on_address from ${LIBSYSTEM}, which the SDK does not export`,
    ])
  })

  it('skips slices for architectures it was not asked about', async () => {
    const stubs = new SdkStubs(await sdk())
    const file = await binary(
      machOImportImage({
        libraries: [{ installName: LIBSYSTEM }],
        fixupImports: [{ symbol: '_missing', ordinal: 1 }],
      }),
    )
    expect(await checkFileAgainstSdk(file, 'binary', stubs, ['x64'])).toEqual({
      slices: 0,
      violations: [],
    })
  })
})
