/**
 * Builds the Windows transition installer (build/electrobun-transition/windows-transition.nsi):
 * an NSIS wrapper around Electrobun's Setup that electron-updater runs like the Electron NSIS
 * installer it replaces (docs/electrobun-transition.md).
 *
 *   bun scripts/electrobun-transition/windows-transition-installer.ts \
 *     <Electrobun Setup.zip> <out openwaggle-<version>-x64.exe> <version> <stable|canary> [makensis]
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ARGUMENT_OFFSET = 2
const MAX_BUFFER_BYTES = 16 * 1024 * 1024
/** electron-builder's namespace for the NSIS app GUID (app-builder-lib NsisTarget). */
export const ELECTRON_BUILDER_GUID_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3'
const UUID_BYTES = 16
const UUID_VERSION_BYTE = 6
const UUID_VARIANT_BYTE = 8
const UUID_VERSION_MASK = 0x0f
const UUID_VERSION_5 = 0x50
const UUID_VARIANT_MASK = 0x3f
const UUID_VARIANT_RFC4122 = 0x80
const UUID_GROUPS = [8, 4, 4, 4, 12] as const
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(?:alpha|beta|rc)\.(\d+))?$/u
const NSIS_SCRIPT = path.join(
  import.meta.dirname,
  '..',
  '..',
  'build',
  'electrobun-transition',
  'windows-transition.nsi',
)

/** RFC 4122 version 5, as electron-builder derives the GUID its NSIS installers register under. */
export function uuidV5(name: string, namespace: string) {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, UUID_BYTES)
  bytes[UUID_VERSION_BYTE] = ((bytes[UUID_VERSION_BYTE] ?? 0) & UUID_VERSION_MASK) | UUID_VERSION_5
  bytes[UUID_VARIANT_BYTE] =
    ((bytes[UUID_VARIANT_BYTE] ?? 0) & UUID_VARIANT_MASK) | UUID_VARIANT_RFC4122
  const hex = bytes.toString('hex')
  const groups: string[] = []
  let offset = 0
  for (const length of UUID_GROUPS) {
    groups.push(hex.slice(offset, offset + length))
    offset += length
  }
  return groups.join('-')
}

/** NSIS's VIProductVersion needs four numbers; a prerelease sequence becomes the fourth. */
export function nsisVersionQuad(version: string) {
  const match = VERSION_PATTERN.exec(version)
  if (!match) throw new Error(`${version} is not a release version.`)
  const [, major, minor, patch, sequence] = match
  return `${major}.${minor}.${patch}.${sequence ?? '0'}`
}

export interface WindowsTransitionDefines {
  readonly outFile: string
  readonly version: string
  readonly setupDirectory: string
  readonly setupExecutable: string
  readonly electrobunChannel: string
  readonly icon: string
  readonly appId?: string
  readonly productName?: string
  readonly electrobunIdentifier?: string
}

export function nsisDefines(input: WindowsTransitionDefines) {
  const appId = input.appId ?? 'com.openwaggle.app'
  return {
    OUTFILE: input.outFile,
    VERSION: input.version,
    VERSION_QUAD: nsisVersionQuad(input.version),
    PRODUCT_NAME: input.productName ?? 'OpenWaggle',
    APP_GUID: uuidV5(appId, ELECTRON_BUILDER_GUID_NAMESPACE),
    SETUP_DIR: input.setupDirectory,
    SETUP_EXE: input.setupExecutable,
    EB_IDENTIFIER: input.electrobunIdentifier ?? appId,
    EB_CHANNEL: input.electrobunChannel,
    ICON: input.icon,
  }
}

function windowsTar() {
  if (process.platform !== 'win32') return 'tar'
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

/** The visible setup executable in Electrobun's Setup zip; its hidden payload sits beside it. */
export function electrobunSetupExecutable(names: readonly string[]) {
  const executables = names.filter((name) => /setup.*\.exe$/iu.test(name))
  if (executables.length !== 1) {
    throw new Error(
      `Expected one setup executable in the Electrobun Setup zip, found ${executables.join(', ') || 'none'}.`,
    )
  }
  return executables[0] ?? ''
}

export async function buildWindowsTransitionInstaller(input: {
  readonly setupZip: string
  readonly outFile: string
  readonly version: string
  readonly electrobunChannel: string
  readonly icon: string
  readonly makensis?: string
}) {
  const staging = await mkdtemp(path.join(tmpdir(), 'openwaggle-transition-'))
  try {
    // Windows 10 and later ship bsdtar, which reads zip archives. Name it: Git's GNU tar, first on
    // PATH in Git Bash, reads `D:\…` as a remote host.
    await run(windowsTar(), ['-xf', input.setupZip, '-C', staging])
    const setupExecutable = electrobunSetupExecutable(await readdir(staging))
    const defines = nsisDefines({ ...input, setupDirectory: staging, setupExecutable })
    const args = [
      ...Object.entries(defines).map(([key, value]) => `-D${key}=${value}`),
      '-V2',
      NSIS_SCRIPT,
    ]
    const { stdout } = await run(input.makensis ?? 'makensis', args, {
      maxBuffer: MAX_BUFFER_BYTES,
      encoding: 'utf8',
    })
    return { outFile: input.outFile, log: stdout }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function main() {
  const [setupZip, outFile, version, electrobunChannel, makensis] =
    process.argv.slice(ARGUMENT_OFFSET)
  if (!setupZip || !outFile || !version || !electrobunChannel) {
    throw new Error(
      'Usage: windows-transition-installer.ts <Setup.zip> <out.exe> <version> <stable|canary> [makensis]',
    )
  }
  const icon = path.join(import.meta.dirname, '..', '..', 'build', 'icon.ico')
  await buildWindowsTransitionInstaller({
    setupZip: path.resolve(setupZip),
    outFile: path.resolve(outFile),
    version,
    electrobunChannel,
    icon,
    ...(makensis ? { makensis } : {}),
  })
  process.stdout.write(`${outFile}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
