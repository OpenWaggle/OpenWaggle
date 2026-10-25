/**
 * Reads the OS-version requirements recorded in native binaries: the symbol versions an ELF needs
 * (`.gnu.version_r`), the minimum macOS version of each Mach-O slice, and the Windows version a PE
 * image declares. Parsing reads only headers and the sections it needs, so multi-hundred-megabyte
 * libraries cost a few small reads. Malformed headers throw, so the release guard fails closed.
 */
import type { FileHandle } from 'node:fs/promises'

export type BinaryArchitecture = 'x64' | 'arm64' | 'x86' | 'other'

export interface ElfVersionNeed {
  readonly file: string
  readonly version: string
}

export interface MachOSliceInfo {
  readonly architecture: BinaryArchitecture
  /** `unknown` when the slice has no version load command. */
  readonly platform: 'macos' | 'other' | 'unknown'
  readonly minimumVersion: string | null
}

export type NativeBinary =
  | { readonly format: 'elf'; readonly architecture: BinaryArchitecture; readonly versionNeeds: readonly ElfVersionNeed[] }
  | { readonly format: 'mach-o'; readonly slices: readonly MachOSliceInfo[] }
  | { readonly format: 'pe'; readonly architecture: BinaryArchitecture; readonly minimumVersion: string }

export interface ByteSource {
  readonly size: number
  read(offset: number, length: number): Promise<Buffer>
}

const MAGIC_BYTES = 4
const MAX_HEADER_BYTES = 16 * 1024 * 1024
const ELF_MAGIC = 0x7f454c46
const ELF = {
  CLASS_64: 2,
  DATA_BIG_ENDIAN: 2,
  CLASS_OFFSET: 4,
  DATA_OFFSET: 5,
  MACHINE_OFFSET: 18,
  MACHINE_BYTES: 2,
  SHT_GNU_VERNEED: 0x6ffffffe,
  VERNEED_SIZE: 16,
} as const
const ELF_MACHINES: ReadonlyMap<number, BinaryArchitecture> = new Map([
  [62, 'x64'],
  [183, 'arm64'],
  [3, 'x86'],
])
const ELF_LAYOUT = {
  elf64: { headerSize: 64, shoff: 0x28, shentsize: 0x3a, shnum: 0x3c, type: 4, offset: 24, size: 32, link: 40, info: 44 },
  elf32: { headerSize: 52, shoff: 0x20, shentsize: 0x2e, shnum: 0x30, type: 4, offset: 16, size: 20, link: 24, info: 28 },
} as const
const MACHO = {
  MAGIC_64: 0xfeedfacf,
  MAGIC_32: 0xfeedface,
  FAT_MAGIC: 0xcafebabe,
  FAT_MAGIC_64: 0xcafebabf,
  HEADER_64: 32,
  HEADER_32: 28,
  FAT_HEADER: 8,
  FAT_ARCH: 20,
  FAT_ARCH_64: 32,
  MAX_FAT_ARCHS: 16,
  LC_BUILD_VERSION: 0x32,
  LC_VERSION_MIN_MACOSX: 0x24,
  PLATFORM_MACOS: 1,
  LOAD_COMMAND_HEADER: 8,
} as const
const MACHO_CPUS: ReadonlyMap<number, BinaryArchitecture> = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
  [7, 'x86'],
])
const MACHO_VERSION = { MAJOR_SHIFT: 16, MINOR_SHIFT: 8, BYTE_MASK: 0xff } as const
const PE = {
  DOS_MAGIC: 0x4d5a,
  LFANEW_OFFSET: 0x3c,
  SIGNATURE: 0x50450000,
  COFF_MACHINE: 4,
  OPTIONAL_HEADER: 24,
  OS_MAJOR: 40,
  OS_MINOR: 42,
  SUBSYSTEM_MAJOR: 48,
  SUBSYSTEM_MINOR: 50,
  OPTIONAL_FIELDS_END: 52,
} as const
const PE_MACHINES: ReadonlyMap<number, BinaryArchitecture> = new Map([
  [0x8664, 'x64'],
  [0xaa64, 'arm64'],
  [0x14c, 'x86'],
])

export function bufferByteSource(buffer: Buffer): ByteSource {
  return {
    size: buffer.length,
    read: async (offset, length) => buffer.subarray(offset, offset + length),
  }
}

export function fileByteSource(handle: FileHandle, size: number): ByteSource {
  return {
    size,
    async read(offset, length) {
      const bytes = Buffer.alloc(Math.max(0, Math.min(length, size - offset)))
      if (bytes.length > 0) await handle.read(bytes, 0, bytes.length, offset)
      return bytes
    },
  }
}

/** Compares dotted numeric versions; missing parts count as zero. */
export function compareVersions(left: string, right: string) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

async function readExactly(source: ByteSource, offset: number, length: number, what: string) {
  if (offset < 0 || length < 0 || length > MAX_HEADER_BYTES || offset + length > source.size) {
    throw new Error(`Truncated or malformed binary: cannot read ${what}.`)
  }
  return source.read(offset, length)
}

function readCString(table: Buffer, offset: number) {
  const end = table.indexOf(0, offset)
  if (offset >= table.length || end < 0) throw new Error('Malformed ELF string table reference.')
  return table.toString('latin1', offset, end)
}

async function readElf(source: ByteSource): Promise<NativeBinary> {
  const ident = await readExactly(source, 0, ELF.MACHINE_OFFSET + ELF.MACHINE_BYTES, 'the ELF identification')
  const bigEndian = ident[ELF.DATA_OFFSET] === ELF.DATA_BIG_ENDIAN
  const is64 = ident[ELF.CLASS_OFFSET] === ELF.CLASS_64
  const layout = is64 ? ELF_LAYOUT.elf64 : ELF_LAYOUT.elf32
  const u16 = (bytes: Buffer, at: number) => (bigEndian ? bytes.readUInt16BE(at) : bytes.readUInt16LE(at))
  const u32 = (bytes: Buffer, at: number) => (bigEndian ? bytes.readUInt32BE(at) : bytes.readUInt32LE(at))
  const word = (bytes: Buffer, at: number) =>
    is64 ? Number(bigEndian ? bytes.readBigUInt64BE(at) : bytes.readBigUInt64LE(at)) : u32(bytes, at)
  const architecture = ELF_MACHINES.get(u16(ident, ELF.MACHINE_OFFSET)) ?? 'other'

  const header = await readExactly(source, 0, layout.headerSize, 'the ELF header')
  const sectionsOffset = word(header, layout.shoff)
  const entrySize = u16(header, layout.shentsize)
  const count = u16(header, layout.shnum)
  if (sectionsOffset === 0 || count === 0) {
    throw new Error('ELF has no section headers, so its symbol version needs cannot be read.')
  }
  const table = await readExactly(source, sectionsOffset, entrySize * count, 'the ELF section headers')
  const section = (index: number) => {
    const at = index * entrySize
    return {
      type: u32(table, at + layout.type),
      offset: word(table, at + layout.offset),
      size: word(table, at + layout.size),
      link: u32(table, at + layout.link),
      info: u32(table, at + layout.info),
    }
  }

  const versionNeeds: ElfVersionNeed[] = []
  for (let index = 0; index < count; index += 1) {
    const verneed = section(index)
    if (verneed.type !== ELF.SHT_GNU_VERNEED) continue
    if (verneed.link >= count) throw new Error('ELF version needs point at a missing string table.')
    const strings = section(verneed.link)
    const stringTable = await readExactly(source, strings.offset, strings.size, 'the ELF string table')
    const needs = await readExactly(source, verneed.offset, verneed.size, 'the ELF version needs')
    versionNeeds.push(...parseVerneed(needs, verneed.info, stringTable, u16, u32))
  }
  return { format: 'elf', architecture, versionNeeds }
}

function parseVerneed(
  needs: Buffer,
  entryCount: number,
  strings: Buffer,
  u16: (bytes: Buffer, at: number) => number,
  u32: (bytes: Buffer, at: number) => number,
) {
  const VERNEED = { COUNT: 2, FILE: 4, AUX: 8, NEXT: 12 } as const
  const VERNAUX = { NAME: 8, NEXT: 12 } as const
  const result: ElfVersionNeed[] = []
  let entry = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (entry + ELF.VERNEED_SIZE > needs.length) throw new Error('Malformed ELF version needs.')
    const file = readCString(strings, u32(needs, entry + VERNEED.FILE))
    let aux = entry + u32(needs, entry + VERNEED.AUX)
    for (let auxIndex = 0; auxIndex < u16(needs, entry + VERNEED.COUNT); auxIndex += 1) {
      if (aux + ELF.VERNEED_SIZE > needs.length) throw new Error('Malformed ELF version needs.')
      result.push({ file, version: readCString(strings, u32(needs, aux + VERNAUX.NAME)) })
      aux += u32(needs, aux + VERNAUX.NEXT)
    }
    entry += u32(needs, entry + VERNEED.NEXT)
  }
  return result
}

function formatMachOVersion(encoded: number) {
  const major = encoded >>> MACHO_VERSION.MAJOR_SHIFT
  const minor = (encoded >>> MACHO_VERSION.MINOR_SHIFT) & MACHO_VERSION.BYTE_MASK
  const patch = encoded & MACHO_VERSION.BYTE_MASK
  return patch === 0 ? `${major}.${minor}` : `${major}.${minor}.${patch}`
}

async function readMachOSlice(source: ByteSource, base: number): Promise<MachOSliceInfo> {
  const magic = (await readExactly(source, base, MAGIC_BYTES, 'the Mach-O magic')).readUInt32LE(0)
  if (magic !== MACHO.MAGIC_64 && magic !== MACHO.MAGIC_32) {
    throw new Error('Universal Mach-O slice is not a little-endian Mach-O image.')
  }
  const headerSize = magic === MACHO.MAGIC_64 ? MACHO.HEADER_64 : MACHO.HEADER_32
  const HEADER = { CPU: 4, NCMDS: 16, SIZEOFCMDS: 20 } as const
  const header = await readExactly(source, base, headerSize, 'the Mach-O header')
  const architecture = MACHO_CPUS.get(header.readUInt32LE(HEADER.CPU)) ?? 'other'
  const commands = await readExactly(
    source,
    base + headerSize,
    header.readUInt32LE(HEADER.SIZEOFCMDS),
    'the Mach-O load commands',
  )
  const COMMAND = { SIZE: 4, BUILD_PLATFORM: 8, BUILD_MINOS: 12, VERSION_MIN: 8 } as const
  let offset = 0
  for (let index = 0; index < header.readUInt32LE(HEADER.NCMDS); index += 1) {
    if (offset + MACHO.LOAD_COMMAND_HEADER > commands.length) throw new Error('Malformed Mach-O load commands.')
    const command = commands.readUInt32LE(offset)
    const size = commands.readUInt32LE(offset + COMMAND.SIZE)
    if (size < MACHO.LOAD_COMMAND_HEADER) throw new Error('Malformed Mach-O load command size.')
    if (command === MACHO.LC_BUILD_VERSION) {
      const platform = commands.readUInt32LE(offset + COMMAND.BUILD_PLATFORM)
      return {
        architecture,
        platform: platform === MACHO.PLATFORM_MACOS ? 'macos' : 'other',
        minimumVersion: formatMachOVersion(commands.readUInt32LE(offset + COMMAND.BUILD_MINOS)),
      }
    }
    if (command === MACHO.LC_VERSION_MIN_MACOSX) {
      const minimumVersion = formatMachOVersion(commands.readUInt32LE(offset + COMMAND.VERSION_MIN))
      return { architecture, platform: 'macos', minimumVersion }
    }
    offset += size
  }
  return { architecture, platform: 'unknown', minimumVersion: null }
}

async function readFatMachO(source: ByteSource, magic: number): Promise<NativeBinary | null> {
  const FAT = { COUNT: 4, OFFSET: 8, OFFSET_64: 8 } as const
  const header = await readExactly(source, 0, MACHO.FAT_HEADER, 'the universal Mach-O header')
  const count = header.readUInt32BE(FAT.COUNT)
  // Java class files share 0xcafebabe; their version field reads as a much larger count.
  if (count === 0 || count > MACHO.MAX_FAT_ARCHS) return null
  const entrySize = magic === MACHO.FAT_MAGIC_64 ? MACHO.FAT_ARCH_64 : MACHO.FAT_ARCH
  const entries = await readExactly(source, MACHO.FAT_HEADER, count * entrySize, 'the universal Mach-O slices')
  const slices: MachOSliceInfo[] = []
  for (let index = 0; index < count; index += 1) {
    const at = index * entrySize
    const offset =
      magic === MACHO.FAT_MAGIC_64
        ? Number(entries.readBigUInt64BE(at + FAT.OFFSET_64))
        : entries.readUInt32BE(at + FAT.OFFSET)
    slices.push(await readMachOSlice(source, offset))
  }
  return { format: 'mach-o', slices }
}

async function readPe(source: ByteSource): Promise<NativeBinary | null> {
  if (source.size < PE.LFANEW_OFFSET + MAGIC_BYTES) return null
  const dosHeader = await readExactly(source, 0, PE.LFANEW_OFFSET + MAGIC_BYTES, 'the DOS header')
  const peOffset = dosHeader.readUInt32LE(PE.LFANEW_OFFSET)
  if (peOffset + PE.OPTIONAL_HEADER + PE.OPTIONAL_FIELDS_END > source.size) return null
  const header = await readExactly(source, peOffset, PE.OPTIONAL_HEADER + PE.OPTIONAL_FIELDS_END, 'the PE header')
  if (header.readUInt32BE(0) !== PE.SIGNATURE) return null
  const optional = PE.OPTIONAL_HEADER
  const osVersion = `${header.readUInt16LE(optional + PE.OS_MAJOR)}.${header.readUInt16LE(optional + PE.OS_MINOR)}`
  const subsystemVersion = `${header.readUInt16LE(optional + PE.SUBSYSTEM_MAJOR)}.${header.readUInt16LE(optional + PE.SUBSYSTEM_MINOR)}`
  return {
    format: 'pe',
    architecture: PE_MACHINES.get(header.readUInt16LE(PE.COFF_MACHINE)) ?? 'other',
    minimumVersion: compareVersions(osVersion, subsystemVersion) >= 0 ? osVersion : subsystemVersion,
  }
}

/** Returns `null` for anything that is not an ELF, Mach-O or PE image. */
export async function readNativeBinary(source: ByteSource): Promise<NativeBinary | null> {
  if (source.size < MAGIC_BYTES) return null
  const magicBytes = await source.read(0, MAGIC_BYTES)
  const bigEndianMagic = magicBytes.readUInt32BE(0)
  const littleEndianMagic = magicBytes.readUInt32LE(0)
  if (bigEndianMagic === ELF_MAGIC) return readElf(source)
  if (littleEndianMagic === MACHO.MAGIC_64 || littleEndianMagic === MACHO.MAGIC_32) {
    return { format: 'mach-o', slices: [await readMachOSlice(source, 0)] }
  }
  if (bigEndianMagic === MACHO.FAT_MAGIC || bigEndianMagic === MACHO.FAT_MAGIC_64) {
    return readFatMachO(source, bigEndianMagic)
  }
  if (magicBytes.readUInt16BE(0) === PE.DOS_MAGIC) return readPe(source)
  return null
}
