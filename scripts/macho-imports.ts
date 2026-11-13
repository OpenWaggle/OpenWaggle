/**
 * Reads what a Mach-O imports: the dylibs it links (and which ones are weak) and every undefined
 * symbol with the library it binds to, from the symbol table and from chained-fixup imports.
 * scripts/check-macos-sdk-symbols.ts compares these against an older macOS SDK.
 */
export type MachOImportArchitecture = 'arm64' | 'x64'

export interface MachOImport {
  readonly symbol: string
  /** Install name of the library the symbol binds to, or null for flat or self lookups. */
  readonly library: string | null
  /** Weak imports may be missing at run time: the symbol, or its whole library, is optional. */
  readonly weak: boolean
}

export interface MachOImports {
  readonly architecture: MachOImportArchitecture
  readonly libraries: readonly { readonly installName: string; readonly weak: boolean }[]
  readonly imports: readonly MachOImport[]
}

const MH_MAGIC_64 = 0xfeedfacf
const FAT_MAGIC = 0xcafebabe
const FAT_MAGIC_64 = 0xcafebabf
const CPU_TYPE_X86_64 = 0x01000007
const CPU_TYPE_ARM64 = 0x0100000c
const HEADER_64_BYTES = 32
const FAT_HEADER_BYTES = 8
const FAT_ARCH_BYTES = 20
const FAT_ARCH_64_BYTES = 32
const NLIST_64_BYTES = 16
const LOAD_COMMAND = {
  SYMTAB: 0x2,
  DYSYMTAB: 0xb,
  LOAD_DYLIB: 0xc,
  LAZY_LOAD_DYLIB: 0x20,
  LOAD_WEAK_DYLIB: 0x80000018,
  REEXPORT_DYLIB: 0x8000001f,
  LOAD_UPWARD_DYLIB: 0x80000023,
  DYLD_CHAINED_FIXUPS: 0x80000034,
} as const
const DYLIB_COMMANDS: ReadonlySet<number> = new Set([
  LOAD_COMMAND.LOAD_DYLIB,
  LOAD_COMMAND.LAZY_LOAD_DYLIB,
  LOAD_COMMAND.LOAD_WEAK_DYLIB,
  LOAD_COMMAND.REEXPORT_DYLIB,
  LOAD_COMMAND.LOAD_UPWARD_DYLIB,
])
const N_TYPE_MASK = 0x0e
const N_UNDF = 0x0
const N_EXT = 0x01
const N_WEAK_REF = 0x0040
const LIBRARY_ORDINAL_SHIFT = 8
const BYTE_MASK = 0xff
/** Ordinals at or above this are special (self, dynamic lookup, main executable). */
const SPECIAL_ORDINAL_MIN = 0xfd
const CHAINED_IMPORT = { PLAIN: 1, ADDEND: 2, ADDEND64: 3 } as const
const CHAINED_IMPORT_BYTES = { 1: 4, 2: 8, 3: 16 } as const
const CHAINED_PLAIN_WEAK_BIT = 8
const CHAINED_PLAIN_NAME_SHIFT = 9
const CHAINED_64_ORDINAL_MASK = 0xffff
const CHAINED_64_WEAK_BIT = 16
const CHAINED_64_SPECIAL_ORDINAL_MIN = 0xfff0
const HEADER_CPU_TYPE = 4

function cString(buffer: Buffer, offset: number) {
  const end = buffer.indexOf(0, offset)
  return buffer.toString('utf8', offset, end === -1 ? buffer.length : end)
}

function architectureOf(cpuType: number) {
  if (cpuType === CPU_TYPE_ARM64) return 'arm64' as const
  if (cpuType === CPU_TYPE_X86_64) return 'x64' as const
  return null
}

function libraryForOrdinal(
  libraries: readonly { readonly installName: string }[],
  ordinal: number,
  special: number,
) {
  if (ordinal === 0 || ordinal >= special) return null
  return libraries[ordinal - 1]?.installName ?? null
}

/** Field byte offsets inside the structures read below. */
const FIELD = {
  headerCommandCount: 16,
  commandSize: 4,
  dylibName: 8,
  symtabSymbolOffset: 8,
  symtabSymbolCount: 12,
  symtabStringOffset: 16,
  dysymtabFirstUndefined: 24,
  dysymtabUndefinedCount: 28,
  linkeditDataOffset: 8,
  fixupsImportsOffset: 8,
  fixupsSymbolsOffset: 12,
  fixupsImportsCount: 16,
  fixupsImportsFormat: 20,
  chained64NameOffset: 4,
  nlistType: 4,
  nlistDescription: 6,
  fatArchCount: 4,
  fatArchOffset: 8,
  fatArchSize: 12,
  fatArch64Offset: 8,
  fatArch64Size: 16,
} as const
const MIN_COMMAND_BYTES = 8

interface Library {
  readonly installName: string
  readonly weak: boolean
}

interface LoadCommands {
  readonly libraries: Library[]
  symtab: { readonly symoff: number; readonly nsyms: number; readonly stroff: number } | null
  undefinedRange: { readonly first: number; readonly count: number } | null
  chainedOffset: number | null
}

function isChainedFormat(format: number): format is 1 | 2 | 3 {
  return (
    format === CHAINED_IMPORT.PLAIN ||
    format === CHAINED_IMPORT.ADDEND ||
    format === CHAINED_IMPORT.ADDEND64
  )
}

function chainedImport(slice: Buffer, entry: number, format: 1 | 2 | 3) {
  const word = slice.readUInt32LE(entry)
  if (format === CHAINED_IMPORT.ADDEND64) {
    const ordinal = word & CHAINED_64_ORDINAL_MASK
    return {
      ordinal: ordinal >= CHAINED_64_SPECIAL_ORDINAL_MIN ? 0 : ordinal,
      weak: ((word >>> CHAINED_64_WEAK_BIT) & 1) === 1,
      nameOffset: slice.readUInt32LE(entry + FIELD.chained64NameOffset),
    }
  }
  return {
    ordinal: word & BYTE_MASK,
    weak: ((word >>> CHAINED_PLAIN_WEAK_BIT) & 1) === 1,
    nameOffset: word >>> CHAINED_PLAIN_NAME_SHIFT,
  }
}

function chainedImports(slice: Buffer, offset: number, libraries: readonly Library[]) {
  const importsOffset = slice.readUInt32LE(offset + FIELD.fixupsImportsOffset)
  const symbolsOffset = slice.readUInt32LE(offset + FIELD.fixupsSymbolsOffset)
  const count = slice.readUInt32LE(offset + FIELD.fixupsImportsCount)
  const format = slice.readUInt32LE(offset + FIELD.fixupsImportsFormat)
  if (!isChainedFormat(format)) throw new Error(`unsupported chained import format ${format}`)
  const stride = CHAINED_IMPORT_BYTES[format]
  const imports: MachOImport[] = []
  for (let index = 0; index < count; index += 1) {
    const { ordinal, weak, nameOffset } = chainedImport(
      slice,
      offset + importsOffset + index * stride,
      format,
    )
    imports.push({
      symbol: cString(slice, offset + symbolsOffset + nameOffset),
      library: libraryForOrdinal(libraries, ordinal, SPECIAL_ORDINAL_MIN),
      weak,
    })
  }
  return imports
}

const COMMAND_READERS: ReadonlyMap<
  number,
  (slice: Buffer, at: number, into: LoadCommands) => void
> = new Map([
  [
    LOAD_COMMAND.SYMTAB,
    (slice: Buffer, at: number, into: LoadCommands) => {
      into.symtab = {
        symoff: slice.readUInt32LE(at + FIELD.symtabSymbolOffset),
        nsyms: slice.readUInt32LE(at + FIELD.symtabSymbolCount),
        stroff: slice.readUInt32LE(at + FIELD.symtabStringOffset),
      }
    },
  ],
  [
    LOAD_COMMAND.DYSYMTAB,
    (slice: Buffer, at: number, into: LoadCommands) => {
      into.undefinedRange = {
        first: slice.readUInt32LE(at + FIELD.dysymtabFirstUndefined),
        count: slice.readUInt32LE(at + FIELD.dysymtabUndefinedCount),
      }
    },
  ],
  [
    LOAD_COMMAND.DYLD_CHAINED_FIXUPS,
    (slice: Buffer, at: number, into: LoadCommands) => {
      into.chainedOffset = slice.readUInt32LE(at + FIELD.linkeditDataOffset)
    },
  ],
])

function readLoadCommands(slice: Buffer) {
  const commands: LoadCommands = {
    libraries: [],
    symtab: null,
    undefinedRange: null,
    chainedOffset: null,
  }
  const commandCount = slice.readUInt32LE(FIELD.headerCommandCount)
  let cursor = HEADER_64_BYTES
  for (let index = 0; index < commandCount; index += 1) {
    const command = slice.readUInt32LE(cursor)
    const size = slice.readUInt32LE(cursor + FIELD.commandSize)
    if (size < MIN_COMMAND_BYTES || cursor + size > slice.length) {
      throw new Error('malformed load command')
    }
    if (DYLIB_COMMANDS.has(command)) {
      commands.libraries.push({
        installName: cString(slice, cursor + slice.readUInt32LE(cursor + FIELD.dylibName)),
        weak: command === LOAD_COMMAND.LOAD_WEAK_DYLIB,
      })
    }
    COMMAND_READERS.get(command)?.(slice, cursor, commands)
    cursor += size
  }
  return commands
}

function symbolTableImports(slice: Buffer, commands: LoadCommands) {
  const { symtab, undefinedRange, libraries } = commands
  if (symtab === null) return []
  const imports: MachOImport[] = []
  const first = undefinedRange?.first ?? 0
  const count = undefinedRange?.count ?? symtab.nsyms
  for (let index = first; index < first + count; index += 1) {
    const entry = symtab.symoff + index * NLIST_64_BYTES
    const type = slice.readUInt8(entry + FIELD.nlistType)
    if ((type & N_TYPE_MASK) !== N_UNDF || (type & N_EXT) === 0) continue
    const description = slice.readUInt16LE(entry + FIELD.nlistDescription)
    const ordinal = (description >>> LIBRARY_ORDINAL_SHIFT) & BYTE_MASK
    imports.push({
      symbol: cString(slice, symtab.stroff + slice.readUInt32LE(entry)),
      library: libraryForOrdinal(libraries, ordinal, SPECIAL_ORDINAL_MIN),
      weak: (description & N_WEAK_REF) !== 0,
    })
  }
  return imports
}

function readThin(slice: Buffer) {
  if (slice.length < HEADER_64_BYTES || slice.readUInt32LE(0) !== MH_MAGIC_64) return null
  const architecture = architectureOf(slice.readUInt32LE(HEADER_CPU_TYPE))
  if (architecture === null) return null
  const commands = readLoadCommands(slice)
  const fixups =
    commands.chainedOffset === null
      ? []
      : chainedImports(slice, commands.chainedOffset, commands.libraries)
  // A symbol imported strongly anywhere is required; it is weak only when every import is weak.
  const imports = new Map<string, MachOImport>()
  for (const entry of [...symbolTableImports(slice, commands), ...fixups]) {
    const key = `${entry.library ?? ''}\u0000${entry.symbol}`
    const existing = imports.get(key)
    imports.set(
      key,
      existing === undefined ? entry : { ...entry, weak: existing.weak && entry.weak },
    )
  }
  const weakLibraries = new Set(
    commands.libraries.filter((library) => library.weak).map((library) => library.installName),
  )
  return {
    architecture,
    libraries: commands.libraries,
    imports: [...imports.values()].map((entry) =>
      entry.library !== null && weakLibraries.has(entry.library) ? { ...entry, weak: true } : entry,
    ),
  }
}

function fatSlice(file: Buffer, entry: number, wide: boolean) {
  const offset = wide
    ? Number(file.readBigUInt64BE(entry + FIELD.fatArch64Offset))
    : file.readUInt32BE(entry + FIELD.fatArchOffset)
  const size = wide
    ? Number(file.readBigUInt64BE(entry + FIELD.fatArch64Size))
    : file.readUInt32BE(entry + FIELD.fatArchSize)
  return file.subarray(offset, offset + size)
}

/** Every 64-bit arm64 or x86_64 slice of a Mach-O file; an empty list for anything else. */
export function readMachOImports(file: Buffer) {
  if (file.length < FAT_HEADER_BYTES) return []
  const magic = file.readUInt32BE(0)
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    const wide = magic === FAT_MAGIC_64
    const count = file.readUInt32BE(FIELD.fatArchCount)
    const slices: MachOImports[] = []
    for (let index = 0; index < count; index += 1) {
      const entry = FAT_HEADER_BYTES + index * (wide ? FAT_ARCH_64_BYTES : FAT_ARCH_BYTES)
      const slice = readThin(fatSlice(file, entry, wide))
      if (slice !== null) slices.push(slice)
    }
    return slices
  }
  const thin = readThin(file)
  return thin === null ? [] : [thin]
}
