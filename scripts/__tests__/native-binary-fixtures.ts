/** Builds minimal ELF, Mach-O and PE images for the native platform-floor tests. */

export const ELF_MACHINE = { x86_64: 62, aarch64: 183 } as const
export const MACHO_CPU = { x86_64: 0x01000007, arm64: 0x0100000c } as const
export const MACHO_PLATFORM = { macos: 1, ios: 2 } as const
export const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64, x86: 0x14c } as const

const ELF_HEADER_SIZE = 64
const ELF_SECTION_HEADER_SIZE = 64
const SHT_STRTAB = 3
const SHT_GNU_VERNEED = 0x6ffffffe
const VERNEED_SIZE = 16
const VERNAUX_SIZE = 16

export interface ElfNeed {
  readonly file: string
  readonly versions: readonly string[]
}

function stringTable(strings: readonly string[]) {
  const offsets = new Map<string, number>()
  const parts: Buffer[] = [Buffer.from([0])]
  let size = 1
  for (const value of strings) {
    if (offsets.has(value)) continue
    offsets.set(value, size)
    const encoded = Buffer.from(`${value}\0`, 'latin1')
    parts.push(encoded)
    size += encoded.length
  }
  return { bytes: Buffer.concat(parts), offsetOf: (value: string) => offsets.get(value) ?? 0 }
}

function verneedSection(needs: readonly ElfNeed[], offsetOf: (value: string) => number) {
  const entries: Buffer[] = []
  needs.forEach((need, index) => {
    const entry = Buffer.alloc(VERNEED_SIZE + need.versions.length * VERNAUX_SIZE)
    entry.writeUInt16LE(1, 0)
    entry.writeUInt16LE(need.versions.length, 2)
    entry.writeUInt32LE(offsetOf(need.file), 4)
    entry.writeUInt32LE(VERNEED_SIZE, 8)
    entry.writeUInt32LE(index === needs.length - 1 ? 0 : entry.length, 12)
    need.versions.forEach((version, auxIndex) => {
      const at = VERNEED_SIZE + auxIndex * VERNAUX_SIZE
      entry.writeUInt32LE(offsetOf(version), at + 8)
      entry.writeUInt32LE(auxIndex === need.versions.length - 1 ? 0 : VERNAUX_SIZE, at + 12)
    })
    entries.push(entry)
  })
  return Buffer.concat(entries)
}

function sectionHeader(type: number, offset: number, size: number, link: number, info: number) {
  const header = Buffer.alloc(ELF_SECTION_HEADER_SIZE)
  header.writeUInt32LE(type, 4)
  header.writeBigUInt64LE(BigInt(offset), 24)
  header.writeBigUInt64LE(BigInt(size), 32)
  header.writeUInt32LE(link, 40)
  header.writeUInt32LE(info, 44)
  return header
}

/** A 64-bit little-endian ELF shared object with a `.gnu.version_r` section. */
export function elfImage(options: {
  readonly machine?: number
  readonly needs?: readonly ElfNeed[]
  readonly withoutSectionHeaders?: boolean
}) {
  const needs = options.needs ?? []
  const strings = stringTable(needs.flatMap((need) => [need.file, ...need.versions]))
  const verneed = verneedSection(needs, strings.offsetOf)
  const stringsOffset = ELF_HEADER_SIZE
  const verneedOffset = stringsOffset + strings.bytes.length
  const sectionsOffset = verneedOffset + verneed.length
  const sections = [
    Buffer.alloc(ELF_SECTION_HEADER_SIZE),
    sectionHeader(SHT_STRTAB, stringsOffset, strings.bytes.length, 0, 0),
    ...(needs.length > 0 ? [sectionHeader(SHT_GNU_VERNEED, verneedOffset, verneed.length, 1, needs.length)] : []),
  ]
  const header = Buffer.alloc(ELF_HEADER_SIZE)
  header.write('\x7fELF', 0, 'latin1')
  header[4] = 2
  header[5] = 1
  header[6] = 1
  header.writeUInt16LE(3, 16)
  header.writeUInt16LE(options.machine ?? ELF_MACHINE.x86_64, 18)
  if (!options.withoutSectionHeaders) {
    header.writeBigUInt64LE(BigInt(sectionsOffset), 0x28)
    header.writeUInt16LE(ELF_SECTION_HEADER_SIZE, 0x3a)
    header.writeUInt16LE(sections.length, 0x3c)
  }
  return Buffer.concat([header, strings.bytes, verneed, ...sections])
}

function encodeMachOVersion(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return (major << 16) | (minor << 8) | patch
}

export interface MachOSlice {
  readonly cpu: number
  readonly platform?: number
  readonly minos?: string
  /** `LC_VERSION_MIN_MACOSX` instead of `LC_BUILD_VERSION`. */
  readonly legacyVersionCommand?: boolean
}

function versionCommand(slice: MachOSlice, minos: string) {
  if (slice.legacyVersionCommand) {
    const command = Buffer.alloc(16)
    command.writeUInt32LE(0x24, 0)
    command.writeUInt32LE(16, 4)
    command.writeUInt32LE(encodeMachOVersion(minos), 8)
    return command
  }
  const command = Buffer.alloc(24)
  command.writeUInt32LE(0x32, 0)
  command.writeUInt32LE(24, 4)
  command.writeUInt32LE(slice.platform ?? MACHO_PLATFORM.macos, 8)
  command.writeUInt32LE(encodeMachOVersion(minos), 12)
  return command
}

/** A thin 64-bit little-endian Mach-O with one version load command, or none. */
export function machOImage(slice: MachOSlice) {
  const commands: Buffer[] = []
  if (slice.minos !== undefined) commands.push(versionCommand(slice, slice.minos))
  const unrelated = Buffer.alloc(16)
  unrelated.writeUInt32LE(0x2, 0)
  unrelated.writeUInt32LE(16, 4)
  commands.unshift(unrelated)
  const body = Buffer.concat(commands)
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(slice.cpu, 4)
  header.writeUInt32LE(6, 12)
  header.writeUInt32LE(commands.length, 16)
  header.writeUInt32LE(body.length, 20)
  return Buffer.concat([header, body])
}

/** A universal (fat) Mach-O wrapping thin slices. */
export function fatMachOImage(slices: readonly MachOSlice[]) {
  const images = slices.map(machOImage)
  const alignment = 16
  const header = Buffer.alloc(8 + slices.length * 20)
  header.writeUInt32BE(0xcafebabe, 0)
  header.writeUInt32BE(slices.length, 4)
  const parts: Buffer[] = [header]
  let offset = header.length
  images.forEach((image, index) => {
    const padding = (alignment - (offset % alignment)) % alignment
    parts.push(Buffer.alloc(padding))
    offset += padding
    const entry = 8 + index * 20
    header.writeUInt32BE(slices[index]?.cpu ?? 0, entry)
    header.writeUInt32BE(offset, entry + 8)
    header.writeUInt32BE(image.length, entry + 12)
    header.writeUInt32BE(4, entry + 16)
    parts.push(image)
    offset += image.length
  })
  return Buffer.concat(parts)
}

/** A PE32+ image header with the given OS and subsystem versions. */
export function peImage(options: {
  readonly machine?: number
  readonly osVersion?: readonly [number, number]
  readonly subsystemVersion?: readonly [number, number]
}) {
  const peOffset = 0x80
  const optionalHeaderOffset = peOffset + 24
  const image = Buffer.alloc(optionalHeaderOffset + 240)
  image.write('MZ', 0, 'latin1')
  image.writeUInt32LE(peOffset, 0x3c)
  image.write('PE\0\0', peOffset, 'latin1')
  image.writeUInt16LE(options.machine ?? PE_MACHINE.x64, peOffset + 4)
  image.writeUInt16LE(240, peOffset + 20)
  image.writeUInt16LE(0x20b, optionalHeaderOffset)
  const [osMajor, osMinor] = options.osVersion ?? [6, 0]
  const [subsystemMajor, subsystemMinor] = options.subsystemVersion ?? [6, 0]
  image.writeUInt16LE(osMajor, optionalHeaderOffset + 40)
  image.writeUInt16LE(osMinor, optionalHeaderOffset + 42)
  image.writeUInt16LE(subsystemMajor, optionalHeaderOffset + 48)
  image.writeUInt16LE(subsystemMinor, optionalHeaderOffset + 50)
  return image
}
