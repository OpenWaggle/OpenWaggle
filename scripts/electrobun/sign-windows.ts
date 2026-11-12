/**
 * Authenticode-signs the Electrobun app's Windows binaries before Hutch archives them
 * (scripts/electrobun/hooks/post-build.ts): `bin/launcher.exe`, `bin/bun.exe`, the CEF and
 * WebView2 DLLs, helper executables and native `.node` addons; and Hutch's Setup executable
 * (scripts/electrobun/hooks/post-wrap.ts). It uses signtool from the Windows SDK with a PFX file;
 * CI signs with a throwaway self-signed certificate made in the job, a release with its own.
 *
 *   bun scripts/electrobun/sign-windows.ts <directory or file...> --pfx <file> [--password-env <NAME>]
 *     [--timestamp-url <url>]
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const run = promisify(execFile)
const FIRST_CLI_ARGUMENT = 2
const MAX_BUFFER_BYTES = 16 * 1024 * 1024
const PE_FILE = /\.(?:exe|dll|node|sys)$/iu
/** signtool takes many files per call; this keeps the command line well under Windows' limit. */
const FILES_PER_CALL = 40
const WINDOWS_KITS = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'

export interface WindowsSigningOptions {
  readonly targets: readonly string[]
  readonly pfx: string
  readonly password: string
  readonly timestampUrl: string | null
  readonly signtool?: string
}

/** The newest x64 signtool.exe of the installed Windows 10/11 SDKs. */
export async function findSigntool(kits: string = WINDOWS_KITS) {
  const versions = (await fs.readdir(kits).catch(() => []))
    .filter((name) => name.startsWith('10.'))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  for (const version of versions) {
    const candidate = path.join(kits, version, 'x64', 'signtool.exe')
    if (
      await fs
        .access(candidate)
        .then(() => true)
        .catch(() => false)
    ) {
      return candidate
    }
  }
  throw new Error(`No signtool.exe under ${kits}; install the Windows SDK.`)
}

/** Every PE file under the targets (a target may be a single file). */
export async function windowsSigningTargets(targets: readonly string[]) {
  const files: string[] = []
  const visit = async (current: string) => {
    const info = await fs.lstat(current)
    if (info.isSymbolicLink()) return
    if (info.isFile()) {
      if (PE_FILE.test(current)) files.push(current)
      return
    }
    for (const entry of await fs.readdir(current)) await visit(path.join(current, entry))
  }
  for (const target of targets) await visit(target)
  return files.sort((left, right) => left.localeCompare(right))
}

const PE_HEADER_OFFSET = 0x3c
const PE_SIGNATURE = 0x00004550
const COFF_SECTION_COUNT = 6
const COFF_OPTIONAL_HEADER_SIZE = 20
const OPTIONAL_HEADER = 24
const PE32_PLUS_MAGIC = 0x20b
const DATA_DIRECTORIES = { pe32: 96, pe32Plus: 112 }
const CERTIFICATE_TABLE_ENTRY = 4
const DATA_DIRECTORY_SIZE = 8
const UINT32_BYTES = 4
const SECTION_HEADER_SIZE = 40
const SECTION_RAW_SIZE = 16
const SECTION_RAW_POINTER = 20

/**
 * Where the certificate table entry of a PE image sits, and whether the table it names is stale:
 * not after every section or past the end of the file. Resource editors (Hutch sets `bun.exe`'s icon)
 * rewrite the sections of Bun's signed `bun.exe` but keep the old entry, and signtool then rejects
 * the file as a bad executable (0x800700C1).
 */
export function staleCertificateTable(image: Buffer) {
  if (image.length < PE_HEADER_OFFSET + UINT32_BYTES) return null
  const pe = image.readUInt32LE(PE_HEADER_OFFSET)
  const headersEnd =
    pe +
    OPTIONAL_HEADER +
    DATA_DIRECTORIES.pe32Plus +
    (CERTIFICATE_TABLE_ENTRY + 1) * DATA_DIRECTORY_SIZE
  if (headersEnd > image.length || image.readUInt32LE(pe) !== PE_SIGNATURE) return null
  const sections = image.readUInt16LE(pe + COFF_SECTION_COUNT)
  const optional = pe + OPTIONAL_HEADER
  const pe32Plus = image.readUInt16LE(optional) === PE32_PLUS_MAGIC
  const directories = optional + (pe32Plus ? DATA_DIRECTORIES.pe32Plus : DATA_DIRECTORIES.pe32)
  const entry = directories + CERTIFICATE_TABLE_ENTRY * DATA_DIRECTORY_SIZE
  const offset = image.readUInt32LE(entry)
  const size = image.readUInt32LE(entry + UINT32_BYTES)
  if (offset === 0 && size === 0) return null
  let endOfSections = 0
  const table = optional + image.readUInt16LE(pe + COFF_OPTIONAL_HEADER_SIZE)
  for (let index = 0; index < sections; index += 1) {
    const header = table + index * SECTION_HEADER_SIZE
    const end =
      image.readUInt32LE(header + SECTION_RAW_POINTER) +
      image.readUInt32LE(header + SECTION_RAW_SIZE)
    endOfSections = Math.max(endOfSections, end)
  }
  return offset < endOfSections || offset + size > image.length ? entry : null
}

/** Clears a stale certificate table entry so signtool signs the image afresh. */
async function dropStaleCertificateTable(file: string) {
  const image = await fs.readFile(file)
  const entry = staleCertificateTable(image)
  if (entry === null) return
  image.fill(0, entry, entry + DATA_DIRECTORY_SIZE)
  await fs.writeFile(file, image)
}

export async function signWindowsBinaries(options: WindowsSigningOptions) {
  const signtool = options.signtool ?? (await findSigntool())
  const files = await windowsSigningTargets(options.targets)
  for (const file of files) await dropStaleCertificateTable(file)
  const timestamp =
    options.timestampUrl === null ? [] : ['/tr', options.timestampUrl, '/td', 'sha256']
  for (let index = 0; index < files.length; index += FILES_PER_CALL) {
    const batch = files.slice(index, index + FILES_PER_CALL)
    await run(
      signtool,
      ['sign', '/fd', 'sha256', '/f', options.pfx, '/p', options.password, ...timestamp, ...batch],
      { maxBuffer: MAX_BUFFER_BYTES },
    )
  }
  return files
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(FIRST_CLI_ARGUMENT),
    allowPositionals: true,
    options: {
      pfx: { type: 'string' },
      'password-env': { type: 'string', default: 'OPENWAGGLE_WINDOWS_SIGN_PASSWORD' },
      'timestamp-url': { type: 'string' },
    },
  })
  if (positionals.length === 0 || values.pfx === undefined) {
    throw new Error('Usage: sign-windows.ts <directory or file...> --pfx <file>')
  }
  const signed = await signWindowsBinaries({
    targets: positionals.map((target) => path.resolve(target)),
    pfx: values.pfx,
    password: process.env[values['password-env']] ?? '',
    timestampUrl: values['timestamp-url'] ?? null,
  })
  console.log(`Signed ${signed.length} Windows binaries`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
