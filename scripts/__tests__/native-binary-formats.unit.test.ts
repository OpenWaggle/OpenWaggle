import { describe, expect, it } from 'vitest'
import { bufferByteSource, compareVersions, readNativeBinary } from '../native-binary-formats'
import {
  ELF_MACHINE,
  elfImage,
  fatMachOImage,
  MACHO_CPU,
  MACHO_PLATFORM,
  machOImage,
  PE_MACHINE,
  peImage,
} from './native-binary-fixtures'

function read(bytes: Buffer) {
  return readNativeBinary(bufferByteSource(bytes))
}

describe('compareVersions', () => {
  it('compares dotted versions numerically, treating missing parts as zero', () => {
    expect(compareVersions('2.38', '2.35')).toBeGreaterThan(0)
    expect(compareVersions('3.4.30', '3.4.30')).toBe(0)
    expect(compareVersions('3.4.9', '3.4.30')).toBeLessThan(0)
    expect(compareVersions('13.4', '13.4.0')).toBe(0)
    expect(compareVersions('12', '13.4')).toBeLessThan(0)
  })
})

describe('readNativeBinary', () => {
  it('ignores files that are not native binaries', async () => {
    expect(await read(Buffer.from('#!/bin/sh\necho hi\n'))).toBeNull()
    expect(await read(Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))).toBeNull()
    expect(await read(Buffer.alloc(0))).toBeNull()
  })

  it('reads the symbol versions an ELF needs from each library', async () => {
    const binary = await read(
      elfImage({
        needs: [
          { file: 'libc.so.6', versions: ['GLIBC_2.2.5', 'GLIBC_2.38'] },
          { file: 'libstdc++.so.6', versions: ['GLIBCXX_3.4.31', 'CXXABI_1.3'] },
        ],
      }),
    )
    expect(binary).toEqual({
      format: 'elf',
      architecture: 'x64',
      versionNeeds: [
        { file: 'libc.so.6', version: 'GLIBC_2.2.5' },
        { file: 'libc.so.6', version: 'GLIBC_2.38' },
        { file: 'libstdc++.so.6', version: 'GLIBCXX_3.4.31' },
        { file: 'libstdc++.so.6', version: 'CXXABI_1.3' },
      ],
    })
  })

  it('reports the ELF architecture and an empty need list for an unversioned ELF', async () => {
    expect(await read(elfImage({ machine: ELF_MACHINE.aarch64 }))).toEqual({
      format: 'elf',
      architecture: 'arm64',
      versionNeeds: [],
    })
  })

  it('fails closed when an ELF has no section headers to read version needs from', async () => {
    await expect(read(elfImage({ withoutSectionHeaders: true }))).rejects.toThrow(/section headers/u)
  })

  it('reads the minimum macOS version from LC_BUILD_VERSION', async () => {
    expect(await read(machOImage({ cpu: MACHO_CPU.arm64, minos: '13.4' }))).toEqual({
      format: 'mach-o',
      slices: [{ architecture: 'arm64', platform: 'macos', minimumVersion: '13.4' }],
    })
  })

  it('reads the minimum macOS version from LC_VERSION_MIN_MACOSX', async () => {
    expect(
      await read(machOImage({ cpu: MACHO_CPU.x86_64, minos: '10.15.2', legacyVersionCommand: true })),
    ).toEqual({
      format: 'mach-o',
      slices: [{ architecture: 'x64', platform: 'macos', minimumVersion: '10.15.2' }],
    })
  })

  it('marks a slice without a version command and a slice for another Apple OS', async () => {
    expect(await read(machOImage({ cpu: MACHO_CPU.arm64 }))).toEqual({
      format: 'mach-o',
      slices: [{ architecture: 'arm64', platform: 'unknown', minimumVersion: null }],
    })
    expect(
      await read(machOImage({ cpu: MACHO_CPU.arm64, platform: MACHO_PLATFORM.ios, minos: '17.0' })),
    ).toEqual({
      format: 'mach-o',
      slices: [{ architecture: 'arm64', platform: 'other', minimumVersion: '17.0' }],
    })
  })

  it('reads every slice of a universal Mach-O', async () => {
    expect(
      await read(
        fatMachOImage([
          { cpu: MACHO_CPU.x86_64, minos: '12.0' },
          { cpu: MACHO_CPU.arm64, minos: '14.0' },
        ]),
      ),
    ).toEqual({
      format: 'mach-o',
      slices: [
        { architecture: 'x64', platform: 'macos', minimumVersion: '12.0' },
        { architecture: 'arm64', platform: 'macos', minimumVersion: '14.0' },
      ],
    })
  })

  it('does not mistake a Java class file for a universal Mach-O', async () => {
    const classFile = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0, 0, 0, 0])
    expect(await read(classFile)).toBeNull()
  })

  it('reads the Windows version a PE image requires', async () => {
    expect(
      await read(peImage({ machine: PE_MACHINE.x64, osVersion: [6, 0], subsystemVersion: [10, 0] })),
    ).toEqual({ format: 'pe', architecture: 'x64', minimumVersion: '10.0' })
    expect(await read(peImage({ machine: PE_MACHINE.arm64 }))).toEqual({
      format: 'pe',
      architecture: 'arm64',
      minimumVersion: '6.0',
    })
  })

  it('ignores an MZ file without a PE signature', async () => {
    const dosOnly = Buffer.alloc(0x100)
    dosOnly.write('MZ', 0, 'latin1')
    dosOnly.writeUInt32LE(0x80, 0x3c)
    expect(await read(dosOnly)).toBeNull()
  })
})
