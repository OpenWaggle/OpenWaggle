/**
 * Synthetic Mach-O images with what scripts/macho-imports.ts reads: dylib load commands, a symbol
 * table with undefined symbols, and chained-fixup imports.
 */
import { MACHO_CPU } from './native-binary-fixtures'

export interface FixtureImport {
  readonly symbol: string
  /** 1-based index into `libraries`. */
  readonly ordinal: number
  readonly weak?: boolean
}

export interface FixtureLibrary {
  readonly installName: string
  readonly weak?: boolean
}

const LC_SYMTAB = 0x2
const LC_DYSYMTAB = 0xb
const LC_LOAD_DYLIB = 0xc
const LC_LOAD_WEAK_DYLIB = 0x80000018
const LC_DYLD_CHAINED_FIXUPS = 0x80000034
const N_UNDF_EXT = 0x01
const N_WEAK_REF = 0x0040

function dylibCommand(library: FixtureLibrary) {
  const name = Buffer.from(`${library.installName}\0`, 'utf8')
  const size = Math.ceil((24 + name.length) / 8) * 8
  const command = Buffer.alloc(size)
  command.writeUInt32LE(library.weak === true ? LC_LOAD_WEAK_DYLIB : LC_LOAD_DYLIB, 0)
  command.writeUInt32LE(size, 4)
  command.writeUInt32LE(24, 8)
  name.copy(command, 24)
  return command
}

function stringTable(symbols: readonly string[]) {
  const offsets: number[] = []
  const parts: Buffer[] = [Buffer.from(' \0')]
  let length = 2
  for (const symbol of symbols) {
    offsets.push(length)
    const bytes = Buffer.from(`${symbol}\0`, 'utf8')
    parts.push(bytes)
    length += bytes.length
  }
  return { table: Buffer.concat(parts), offsets }
}

function chainedFixups(imports: readonly FixtureImport[]) {
  const { table, offsets } = stringTable(imports.map((entry) => entry.symbol))
  const header = Buffer.alloc(28)
  const importsOffset = header.length
  const symbolsOffset = importsOffset + imports.length * 4
  header.writeUInt32LE(0, 0)
  header.writeUInt32LE(0, 4)
  header.writeUInt32LE(importsOffset, 8)
  header.writeUInt32LE(symbolsOffset, 12)
  header.writeUInt32LE(imports.length, 16)
  header.writeUInt32LE(1, 20)
  const entries = Buffer.alloc(imports.length * 4)
  imports.forEach((entry, index) => {
    const weak = entry.weak === true ? 1 : 0
    const word = (entry.ordinal & 0xff) | (weak << 8) | ((offsets[index] ?? 0) << 9)
    entries.writeUInt32LE(word >>> 0, index * 4)
  })
  return Buffer.concat([header, entries, table])
}

function symbolTable(imports: readonly FixtureImport[]) {
  const { table, offsets } = stringTable(imports.map((entry) => entry.symbol))
  const nlists = Buffer.alloc(imports.length * 16)
  imports.forEach((entry, index) => {
    const at = index * 16
    nlists.writeUInt32LE(offsets[index] ?? 0, at)
    nlists.writeUInt8(N_UNDF_EXT, at + 4)
    const description = (entry.ordinal << 8) | (entry.weak === true ? N_WEAK_REF : 0)
    nlists.writeUInt16LE(description, at + 6)
  })
  return { nlists, table }
}

/**
 * A thin Mach-O importing `symbolTableImports` through its symbol table and `fixupImports`
 * through LC_DYLD_CHAINED_FIXUPS.
 */
export function machOImportImage(options: {
  readonly cpu?: number
  readonly libraries: readonly FixtureLibrary[]
  readonly symbolTableImports?: readonly FixtureImport[]
  readonly fixupImports?: readonly FixtureImport[]
}) {
  const symbolImports = options.symbolTableImports ?? []
  const fixupImports = options.fixupImports ?? []
  const dylibs = options.libraries.map(dylibCommand)
  const symtabCommand = Buffer.alloc(24)
  const dysymtabCommand = Buffer.alloc(80)
  const fixupsCommand = Buffer.alloc(16)
  const commands = [...dylibs, symtabCommand, dysymtabCommand, fixupsCommand]
  const commandBytes = commands.reduce((total, command) => total + command.length, 0)
  const { nlists, table } = symbolTable(symbolImports)
  const fixups = chainedFixups(fixupImports)
  const symoff = 32 + commandBytes
  const stroff = symoff + nlists.length
  const fixupsOffset = stroff + table.length

  symtabCommand.writeUInt32LE(LC_SYMTAB, 0)
  symtabCommand.writeUInt32LE(24, 4)
  symtabCommand.writeUInt32LE(symoff, 8)
  symtabCommand.writeUInt32LE(symbolImports.length, 12)
  symtabCommand.writeUInt32LE(stroff, 16)
  symtabCommand.writeUInt32LE(table.length, 20)
  dysymtabCommand.writeUInt32LE(LC_DYSYMTAB, 0)
  dysymtabCommand.writeUInt32LE(80, 4)
  dysymtabCommand.writeUInt32LE(0, 24)
  dysymtabCommand.writeUInt32LE(symbolImports.length, 28)
  fixupsCommand.writeUInt32LE(LC_DYLD_CHAINED_FIXUPS, 0)
  fixupsCommand.writeUInt32LE(16, 4)
  fixupsCommand.writeUInt32LE(fixupsOffset, 8)
  fixupsCommand.writeUInt32LE(fixups.length, 12)

  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(options.cpu ?? MACHO_CPU.arm64, 4)
  header.writeUInt32LE(6, 12)
  header.writeUInt32LE(commands.length, 16)
  header.writeUInt32LE(commandBytes, 20)
  return Buffer.concat([header, ...commands, nlists, table, fixups])
}

/** A universal (fat) Mach-O of whole thin images. */
export function universalImage(
  images: readonly { readonly cpu: number; readonly image: Buffer }[],
) {
  const header = Buffer.alloc(8 + images.length * 20)
  header.writeUInt32BE(0xcafebabe, 0)
  header.writeUInt32BE(images.length, 4)
  const parts: Buffer[] = [header]
  let offset = header.length
  images.forEach(({ cpu, image }, index) => {
    const entry = 8 + index * 20
    header.writeUInt32BE(cpu, entry)
    header.writeUInt32BE(offset, entry + 8)
    header.writeUInt32BE(image.length, entry + 12)
    parts.push(image)
    offset += image.length
  })
  return Buffer.concat(parts)
}
