/**
 * Release guard for the v1 supported-platform minimums (docs/release-and-versioning.md,
 * "v1 compatibility promise"). It reads every native binary in a packaged app and fails when one
 * needs a newer OS than SUPPORTED_PLATFORM_FLOOR states:
 *
 * - Linux: no x64 ELF may need a GLIBC, GLIBCXX or CXXABI symbol version newer than Ubuntu 22.04's.
 * - macOS: no Mach-O slice for the app's architecture may need a macOS newer than the supported
 *   version, and the main executable and `LSMinimumSystemVersion` must keep the launch version.
 * - Windows: no x64 PE may declare an OS or subsystem version newer than Windows 10.
 *
 * Binaries for another platform or architecture can never load, so they are listed and skipped.
 * Run it after packaging and before upload: `pnpm exec tsx scripts/check-native-platform-floor.ts`.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type BinaryArchitecture,
  compareVersions,
  fileByteSource,
  type NativeBinary,
  readNativeBinary,
} from './native-binary-formats'
import { resolveFloorTargets } from './native-platform-floor-targets'
import { SUPPORTED_PLATFORM_FLOOR } from './supported-platform-floor'

export type FloorPlatform = 'darwin' | 'linux' | 'win32'

export interface FloorReport {
  readonly root: string
  readonly platform: FloorPlatform
  readonly architectures: readonly BinaryArchitecture[]
  readonly checked: number
  readonly skipped: readonly string[]
  readonly violations: readonly string[]
}

type Floor = typeof SUPPORTED_PLATFORM_FLOOR
type Evaluation = { readonly kind: 'checked'; readonly violations: readonly string[] } | { readonly kind: 'skipped'; readonly label: string }

const MAIN_EXECUTABLE: Readonly<Record<FloorPlatform, string>> = {
  darwin: 'Contents/MacOS/OpenWaggle',
  linux: 'openwaggle',
  win32: 'OpenWaggle.exe',
}
const INFO_PLIST = 'Contents/Info.plist'
const LS_MINIMUM_SYSTEM_VERSION = /<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]*)<\/string>/u
const FORMAT_LABEL = { elf: 'ELF', 'mach-o': 'Mach-O', pe: 'PE' } as const
const LINUX_SYMBOL_FLOORS = [
  { prefix: 'GLIBC_', key: 'glibc' },
  { prefix: 'GLIBCXX_', key: 'glibcxx' },
  { prefix: 'CXXABI_', key: 'cxxabi' },
] as const
const NUMERIC_VERSION = /^\d+(?:\.\d+)*$/u
const FIRST_CLI_ARGUMENT = 2

function binaryArchitectures(binary: NativeBinary) {
  return binary.format === 'mach-o' ? binary.slices.map((slice) => slice.architecture) : [binary.architecture]
}

function skippedLabel(binary: NativeBinary) {
  return `${FORMAT_LABEL[binary.format]} ${[...new Set(binaryArchitectures(binary))].join('+')}`
}

function evaluateLinux(file: string, binary: NativeBinary, architectures: readonly BinaryArchitecture[], floor: Floor) {
  if (binary.format !== 'elf' || !architectures.includes(binary.architecture)) {
    return { kind: 'skipped', label: skippedLabel(binary) } satisfies Evaluation
  }
  const violations: string[] = []
  for (const need of binary.versionNeeds) {
    for (const symbolFloor of LINUX_SYMBOL_FLOORS) {
      if (!need.version.startsWith(symbolFloor.prefix)) continue
      const version = need.version.slice(symbolFloor.prefix.length)
      const supported = floor.linux[symbolFloor.key]
      if (NUMERIC_VERSION.test(version) && compareVersions(version, supported) > 0) {
        violations.push(
          `${file} needs ${need.version} (${need.file}), above the supported ${symbolFloor.prefix}${supported}`,
        )
      }
    }
  }
  return { kind: 'checked', violations } satisfies Evaluation
}

function evaluateMacos(file: string, binary: NativeBinary, architectures: readonly BinaryArchitecture[], floor: Floor) {
  const slices =
    binary.format === 'mach-o'
      ? binary.slices.filter((slice) => architectures.includes(slice.architecture) && slice.platform !== 'other')
      : []
  if (slices.length === 0) return { kind: 'skipped', label: skippedLabel(binary) } satisfies Evaluation
  const supported = floor.macos.supportedVersion
  const violations = slices.flatMap((slice) => {
    if (slice.minimumVersion === null) return [`${file} (${slice.architecture}) declares no minimum macOS version`]
    if (compareVersions(slice.minimumVersion, supported) <= 0) return []
    return [`${file} (${slice.architecture}) needs macOS ${slice.minimumVersion}, above the supported ${supported}`]
  })
  return { kind: 'checked', violations } satisfies Evaluation
}

/** x64 Windows runs x86 images too (electron-builder's `elevate.exe` is one), so they are checked. */
function runsOnWindows(binary: NativeBinary, architectures: readonly BinaryArchitecture[]) {
  if (binary.format !== 'pe') return false
  return architectures.includes(binary.architecture) || (binary.architecture === 'x86' && architectures.includes('x64'))
}

function evaluateWindows(file: string, binary: NativeBinary, architectures: readonly BinaryArchitecture[], floor: Floor) {
  if (binary.format !== 'pe' || !runsOnWindows(binary, architectures)) {
    return { kind: 'skipped', label: skippedLabel(binary) } satisfies Evaluation
  }
  const supported = floor.windows.supportedVersion
  const violations =
    compareVersions(binary.minimumVersion, supported) > 0
      ? [`${file} needs Windows ${binary.minimumVersion}, above the supported ${supported}`]
      : []
  return { kind: 'checked', violations } satisfies Evaluation
}

const EVALUATORS = { darwin: evaluateMacos, linux: evaluateLinux, win32: evaluateWindows } as const

async function readBinaryAt(filePath: string) {
  const handle = await fs.open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    return await readNativeBinary(fileByteSource(handle, size))
  } catch (error) {
    throw new Error(`${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await handle.close()
  }
}

async function listFiles(root: string) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort((left, right) => left.localeCompare(right))
}

async function mainExecutable(root: string, platform: FloorPlatform) {
  const relative = MAIN_EXECUTABLE[platform]
  const binary = await readBinaryAt(path.join(root, relative)).catch(() => null)
  if (binary === null) throw new Error(`${root} has no readable main executable at ${relative}.`)
  return { relative, binary, architectures: [...new Set(binaryArchitectures(binary))] }
}

async function macosLaunchViolations(root: string, executable: string, binary: NativeBinary, floor: Floor) {
  const launch = floor.macos.launchVersion
  const violations =
    binary.format === 'mach-o'
      ? binary.slices
          .filter((slice) => slice.minimumVersion !== null && compareVersions(slice.minimumVersion, launch) > 0)
          .map(
            (slice) =>
              `${executable} (${slice.architecture}) needs macOS ${slice.minimumVersion}, so macOS ${launch} could not launch the app`,
          )
      : []
  // electron-builder writes an XML plist; a binary or missing value reads as unset and fails.
  const infoPlist = await fs.readFile(path.join(root, INFO_PLIST), 'utf8')
  const minimum = LS_MINIMUM_SYSTEM_VERSION.exec(infoPlist)?.[1]?.trim() ?? 'unset'
  if (minimum !== launch) {
    violations.push(`${INFO_PLIST} sets LSMinimumSystemVersion ${minimum}; it must stay ${launch}`)
  }
  return violations
}

export async function checkNativePlatformFloor(
  root: string,
  platform: FloorPlatform,
  floor: Floor = SUPPORTED_PLATFORM_FLOOR,
): Promise<FloorReport> {
  const executable = await mainExecutable(root, platform)
  const skipped: string[] = []
  const violations: string[] = []
  let checked = 0
  for (const file of await listFiles(root)) {
    const binary = await readBinaryAt(path.join(root, file))
    if (binary === null) continue
    const evaluation = EVALUATORS[platform](file, binary, executable.architectures, floor)
    if (evaluation.kind === 'skipped') {
      skipped.push(`${file} (${evaluation.label})`)
      continue
    }
    checked += 1
    violations.push(...evaluation.violations)
  }
  if (platform === 'darwin') {
    violations.push(...(await macosLaunchViolations(root, executable.relative, executable.binary, floor)))
  }
  return { root, platform, architectures: executable.architectures, checked, skipped, violations }
}

export function formatFloorReport(report: FloorReport) {
  return [
    `${report.platform} native floor (${report.architectures.join('+')}): ${report.root}`,
    `checked ${report.checked} native binaries, skipped ${report.skipped.length} for other platforms or architectures`,
    ...report.skipped.map((entry) => `  skipped ${entry}`),
    ...report.violations.map((violation) => `  FAIL ${violation}`),
    report.violations.length === 0 ? 'PASS' : `FAIL: ${report.violations.length} floor violations`,
  ].join('\n')
}

async function main() {
  const targets = await resolveFloorTargets(process.argv.slice(FIRST_CLI_ARGUMENT))
  let failed = false
  for (const target of targets) {
    const report = await checkNativePlatformFloor(target.root, target.platform)
    console.log(formatFloorReport(report))
    failed ||= report.violations.length > 0 || report.checked === 0
  }
  if (failed) {
    throw new Error('Native binaries exceed the supported platform floor (scripts/supported-platform-floor.ts).')
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
