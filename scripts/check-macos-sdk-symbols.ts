/**
 * Proves that native binaries only bind to symbols an older macOS provides. For every Mach-O slice
 * it lists the non-weak imports from system libraries (/System/Library, /usr/lib) and looks each one
 * up in that macOS SDK's text stubs (.tbd), following re-exported libraries. A symbol or library the
 * SDK does not have would make dyld refuse to load the binary on that release, so it fails the check.
 * Weak imports (an `@available` guard, or a weakly linked library) are allowed.
 *
 * Together with the deployment-target check (scripts/check-native-platform-floor.ts) and compiling
 * with -Werror=unguarded-availability, this covers the floor without a macOS 13 machine: the
 * deployment target bounds what the binary declares, the SDK stubs bound what it binds to, and the
 * compiler flag bounds Objective-C messages, which bind at run time and have no symbol.
 *
 *   bun scripts/check-macos-sdk-symbols.ts --sdk <MacOSX13.3.sdk> [--arch arm64|x64] <paths...>
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { type MachOImportArchitecture, readMachOImports } from './macho-imports'

interface StubLibrary {
  readonly installName: string
  /** Exported symbols per tbd target, such as `arm64-macos`. */
  readonly symbols: ReadonlyMap<string, ReadonlySet<string>>
  readonly reexports: ReadonlyMap<string, readonly string[]>
}

const SYSTEM_PREFIXES = ['/System/Library/', '/usr/lib/'] as const
const TBD_SUFFIX = '.tbd'
const DOCUMENT_START = /^--- !tapi-tbd/mu
const FIRST_CLI_ARGUMENT = 2
const MACH_O_MAGICS: ReadonlySet<number> = new Set([0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf])
const MAGIC_BYTES = 4
const SYMBOL_KEYS: Readonly<Record<string, (name: string) => readonly string[]>> = {
  symbols: (name) => [name],
  'weak-symbols': (name) => [name],
  'thread-local-symbols': (name) => [name],
  'objc-classes': (name) => [`_OBJC_CLASS_$_${name}`, `_OBJC_METACLASS_$_${name}`],
  'objc-eh-types': (name) => [`_OBJC_EHTYPE_$_${name}`],
  'objc-ivars': (name) => [`_OBJC_IVAR_$_${name}`],
}

/** Newer SDKs list only arm64e for system libraries; arm64 code binds to the same exports. */
export function tbdTargets(architecture: MachOImportArchitecture) {
  return architecture === 'arm64' ? ['arm64-macos', 'arm64e-macos'] : ['x86_64-macos']
}

/** `[ a, 'b', "c" ]` (possibly spanning lines) into its items. */
function listItems(text: string) {
  const open = text.indexOf('[')
  const close = text.lastIndexOf(']')
  if (open === -1 || close === -1) return []
  return text
    .slice(open + 1, close)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/gu, ''))
    .filter((item) => item !== '')
}

/** Joins a YAML flow list that continues over several lines into one logical line. */
function logicalLines(document: string) {
  const lines: string[] = []
  let pending = ''
  for (const line of document.split('\n')) {
    pending = pending === '' ? line : `${pending} ${line.trim()}`
    const opens = (pending.match(/\[/gu) ?? []).length
    const closes = (pending.match(/\]/gu) ?? []).length
    if (opens <= closes) {
      lines.push(pending)
      pending = ''
    }
  }
  if (pending !== '') lines.push(pending)
  return lines
}

const TOP_LEVEL_KEY = /^([a-z-]+):/u
const NESTED_KEY = /^\s*(?:-\s+)?([a-z-]+):\s*(.*)$/u
const INSTALL_NAME = /^install-name:\s*['"]?([^'"\n]+)['"]?/mu
const SYMBOL_SECTIONS: ReadonlySet<string> = new Set(['exports', 'reexports'])
const REEXPORT_SECTION = 'reexported-libraries'

/** Accumulates one tbd document's exports and re-exported libraries, keyed by target. */
class TbdDocument {
  readonly symbols = new Map<string, Set<string>>()
  readonly reexports = new Map<string, string[]>()
  private section = ''
  private targets: readonly string[] = []

  line(line: string) {
    const top = TOP_LEVEL_KEY.exec(line)?.[1]
    if (top !== undefined) {
      this.section = top
      this.targets = []
      return
    }
    const [, key, value] = NESTED_KEY.exec(line) ?? []
    if (key === undefined) return
    const items = listItems(value ?? '')
    if (key === 'targets') {
      this.targets = items
      return
    }
    if (this.section === REEXPORT_SECTION && key === 'libraries') {
      this.addReexports(items)
      return
    }
    const expand = SYMBOL_KEYS[key]
    if (SYMBOL_SECTIONS.has(this.section) && expand !== undefined) {
      this.addSymbols(items.flatMap(expand))
    }
  }

  private addReexports(libraries: readonly string[]) {
    for (const target of this.targets) {
      this.reexports.set(target, [...(this.reexports.get(target) ?? []), ...libraries])
    }
  }

  private addSymbols(symbols: readonly string[]) {
    for (const target of this.targets) {
      const set = this.symbols.get(target) ?? new Set<string>()
      for (const symbol of symbols) set.add(symbol)
      this.symbols.set(target, set)
    }
  }
}

/** Parses the YAML (tbd v4) documents of one stub file. */
export function parseTbd(text: string) {
  return text
    .split(DOCUMENT_START)
    .slice(1)
    .flatMap((document) => {
      const installName = INSTALL_NAME.exec(document)?.[1]?.trim()
      if (installName === undefined) return []
      const parsed = new TbdDocument()
      for (const line of logicalLines(document)) parsed.line(line)
      return [{ installName, symbols: parsed.symbols, reexports: parsed.reexports }]
    })
}

export class SdkStubs {
  private readonly libraries = new Map<string, StubLibrary | null>()
  private readonly sdk: string

  constructor(sdk: string) {
    this.sdk = sdk
  }

  /** The SDK keeps `/usr/lib/libz.1.dylib` as `<sdk>/usr/lib/libz.1.tbd`; frameworks drop no suffix. */
  private async load(installName: string) {
    if (this.libraries.has(installName)) return this.libraries.get(installName) ?? null
    const stub = path.join(this.sdk, installName.replace(/\.dylib$/u, '') + TBD_SUFFIX)
    const text = await fs.readFile(stub, 'utf8').catch(() => null)
    if (text === null) {
      this.libraries.set(installName, null)
      return null
    }
    for (const library of parseTbd(text)) {
      if (!this.libraries.has(library.installName)) this.libraries.set(library.installName, library)
    }
    if (!this.libraries.has(installName)) this.libraries.set(installName, null)
    return this.libraries.get(installName) ?? null
  }

  async hasLibrary(installName: string) {
    return (await this.load(installName)) !== null
  }

  async exports(
    installName: string,
    symbol: string,
    targets: readonly string[],
    seen = new Set<string>(),
  ): Promise<boolean> {
    if (seen.has(installName)) return false
    seen.add(installName)
    const library = await this.load(installName)
    if (library === null) return false
    if (targets.some((target) => library.symbols.get(target)?.has(symbol) === true)) return true
    for (const reexport of targets.flatMap((target) => library.reexports.get(target) ?? [])) {
      if (await this.exports(reexport, symbol, targets, seen)) return true
    }
    return false
  }
}

function isSystemLibrary(installName: string) {
  return SYSTEM_PREFIXES.some((prefix) => installName.startsWith(prefix))
}

export async function checkFileAgainstSdk(
  file: string,
  label: string,
  stubs: SdkStubs,
  architectures: readonly MachOImportArchitecture[],
) {
  const violations: string[] = []
  let slices = 0
  for (const slice of readMachOImports(await fs.readFile(file))) {
    if (!architectures.includes(slice.architecture)) continue
    slices += 1
    const targets = tbdTargets(slice.architecture)
    for (const library of slice.libraries) {
      if (library.weak || !isSystemLibrary(library.installName)) continue
      if (!(await stubs.hasLibrary(library.installName))) {
        violations.push(
          `${label} (${slice.architecture}) links ${library.installName}, which the SDK does not have`,
        )
      }
    }
    for (const entry of slice.imports) {
      if (entry.weak || entry.library === null || !isSystemLibrary(entry.library)) continue
      if (!(await stubs.hasLibrary(entry.library))) continue
      if (!(await stubs.exports(entry.library, entry.symbol, targets))) {
        violations.push(
          `${label} (${slice.architecture}) imports ${entry.symbol} from ${entry.library}, which the SDK does not export`,
        )
      }
    }
  }
  return { slices, violations }
}

async function isMachO(file: string) {
  const handle = await fs.open(file, 'r')
  try {
    const header = Buffer.alloc(MAGIC_BYTES)
    const { bytesRead } = await handle.read(header, 0, MAGIC_BYTES, 0)
    return bytesRead === MAGIC_BYTES && MACH_O_MAGICS.has(header.readUInt32BE(0))
  } finally {
    await handle.close()
  }
}

async function machOFiles(root: string) {
  const stat = await fs.lstat(root)
  if (stat.isFile()) return (await isMachO(root)) ? [root] : []
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    if (await isMachO(file)) files.push(file)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(FIRST_CLI_ARGUMENT),
    allowPositionals: true,
    options: { sdk: { type: 'string' }, arch: { type: 'string', multiple: true } },
  })
  if (values.sdk === undefined || positionals.length === 0) {
    throw new Error('Usage: check-macos-sdk-symbols.ts --sdk <sdk> [--arch arm64|x64] <paths...>')
  }
  const architectures = (values.arch ?? ['arm64', 'x64']).map((arch) => {
    if (arch === 'arm64' || arch === 'x64') return arch satisfies MachOImportArchitecture
    throw new Error(`Unknown architecture ${arch}`)
  })
  const stubs = new SdkStubs(path.resolve(values.sdk))
  const violations: string[] = []
  let checked = 0
  for (const root of positionals) {
    for (const file of await machOFiles(root)) {
      const report = await checkFileAgainstSdk(
        file,
        path.relative(root, file) || path.basename(file),
        stubs,
        architectures,
      )
      if (report.slices > 0) checked += 1
      violations.push(...report.violations)
    }
  }
  console.log(`macOS SDK symbols (${path.basename(values.sdk)}): checked ${checked} Mach-O files`)
  for (const violation of violations) console.log(`  FAIL ${violation}`)
  if (checked === 0) throw new Error('No Mach-O files for the requested architectures.')
  if (violations.length > 0) {
    throw new Error(`${violations.length} imports are missing from ${values.sdk}.`)
  }
  console.log('PASS')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
