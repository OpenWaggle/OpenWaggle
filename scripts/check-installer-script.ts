/**
 * Compile-checks the Windows transition installer (build/electrobun-transition/windows-transition.nsi),
 * the NSIS wrapper electron-updater runs on existing Electron installs to move them to Electrobun
 * (docs/electrobun-transition.md). It is only built when the release packages Windows, so a syntax
 * or context error there would otherwise stay invisible until a release is in flight: an NSIS error
 * in the old Electron installer script broke two consecutive releases over six days before anyone
 * saw it.
 *
 * It compiles the real script with the defines release packaging passes
 * (scripts/electrobun-transition/windows-transition-installer.ts `nsisDefines`), a placeholder
 * Setup payload, and warnings as errors (`-WX`), so an unreferenced function or a bad variable
 * fails here too.
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { nsisDefines } from './electrobun-transition/windows-transition-installer'
import { scriptEnv } from './support/env'

const execFileAsync = promisify(execFile)

const INSTALLER_SCRIPT = 'build/electrobun-transition/windows-transition.nsi'
const ICON = 'build/icon.ico'
const SETUP_EXECUTABLE = 'OpenWaggle-Setup.exe'
const CHECK_VERSION = '1.0.0-rc.1'
const MAKENSIS_MISSING_EXIT_CODES = new Set(['ENOENT'])

function isMissingMakensis(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    MAKENSIS_MISSING_EXIT_CODES.has(error.code)
  )
}

function reportMissingMakensis() {
  /*
   * CI installs NSIS and sets REQUIRE_NSIS=1, so a missing toolchain there is a failure
   * rather than a silent pass. Locally it degrades to a notice, because most contributors
   * never touch the Windows installer.
   */
  if (scriptEnv().REQUIRE_NSIS === '1') {
    console.error(
      'makensis is required but was not found. Install NSIS (ubuntu: `apt-get install -y nsis`, macOS: `brew install makensis`).',
    )
    process.exitCode = 1
    return
  }
  console.log(
    `Installer script check skipped: makensis not installed. ${INSTALLER_SCRIPT} is compile-checked in CI.`,
  )
}

/*
 * `in` + `typeof` narrowing rather than a cast: execFile rejects with an Error carrying
 * stdout/stderr, but that shape is not in the standard Error type.
 */
function commandStream(error: Error, stream: 'stdout' | 'stderr') {
  const value: unknown = stream in error ? Reflect.get(error, stream) : undefined
  return typeof value === 'string' ? value.trim() : ''
}

function commandOutput(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const parts = [commandStream(error, 'stdout'), commandStream(error, 'stderr')].filter(
    (part) => part.length > 0,
  )
  return parts.length > 0 ? parts.join('\n') : error.message
}

async function main() {
  const root = process.cwd()
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'openwaggle-nsis-check-'))
  try {
    const setupDirectory = path.join(workingDirectory, 'setup')
    await mkdir(setupDirectory)
    await writeFile(path.join(setupDirectory, SETUP_EXECUTABLE), 'placeholder Setup')
    const defines = nsisDefines({
      outFile: path.join(workingDirectory, 'transition-check.exe'),
      version: CHECK_VERSION,
      setupDirectory,
      setupExecutable: SETUP_EXECUTABLE,
      electrobunChannel: 'stable',
      icon: path.join(root, ICON),
    })
    await execFileAsync(
      'makensis',
      [
        '-WX',
        '-V2',
        ...Object.entries(defines).map(([key, value]) => `-D${key}=${value}`),
        path.join(root, INSTALLER_SCRIPT),
      ],
      { cwd: workingDirectory },
    )
    console.log(`Installer script check passed: ${INSTALLER_SCRIPT} compiles.`)
  } catch (error) {
    if (isMissingMakensis(error)) {
      reportMissingMakensis()
      return
    }
    console.error(`Installer script check failed: ${INSTALLER_SCRIPT} does not compile.\n`)
    console.error(commandOutput(error))
    process.exitCode = 1
  } finally {
    await rm(workingDirectory, { force: true, recursive: true })
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
