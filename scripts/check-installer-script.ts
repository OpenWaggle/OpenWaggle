/**
 * Compile-check the NSIS installer customisations.
 *
 * `build/installer.nsh` is only exercised when electron-builder packages the Windows
 * target, which happens in the release workflow rather than in CI. A syntax or context
 * error there therefore stays invisible until a release is already in flight: an invalid
 * `${StrRep}` call inside `customUnInstall` broke two consecutive releases over six days
 * before anyone saw it, because NSIS only rejects installer-variant StrFunc calls from an
 * uninstall section at compile time.
 *
 * This runs makensis over a harness that inserts the custom macros exactly where
 * electron-builder inserts them, so the same class of error fails a pull request in
 * seconds instead of a release in minutes.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const INSTALLER_SCRIPT = 'build/installer.nsh'
const MAKENSIS_MISSING_EXIT_CODES = new Set(['ENOENT'])

/**
 * Mirrors electron-builder's own usage: it `!include`s the custom script and inserts
 * `customInstall` into the install section and `customUnInstall` into the uninstaller.
 * `WriteUninstaller` is present so the uninstaller is genuinely generated, which is what
 * forces NSIS to validate the uninstall section's function calls.
 */
function harnessScript(installerScriptPath: string) {
  return [
    '!include "WinMessages.nsh"',
    `!include "${installerScriptPath}"`,
    '',
    'Name "installer-script-check"',
    'OutFile "installer-script-check.exe"',
    'InstallDir "$TEMP\\installer-script-check"',
    '',
    'Section "Install"',
    '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
    '  !insertmacro customInstall',
    'SectionEnd',
    '',
    'Section "Uninstall"',
    '  !insertmacro customUnInstall',
    'SectionEnd',
    '',
  ].join('\n')
}

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
  if (process.env.REQUIRE_NSIS === '1') {
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
  if (stream === 'stdout') {
    return 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : ''
  }
  return 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : ''
}

function commandOutput(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const parts = [commandStream(error, 'stdout'), commandStream(error, 'stderr')].filter(
    (part) => part.length > 0,
  )
  return parts.length > 0 ? parts.join('\n') : error.message
}

async function main() {
  const repositoryRoot = process.cwd()
  const installerScriptPath = path.join(repositoryRoot, INSTALLER_SCRIPT)
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'openwaggle-nsis-check-'))

  try {
    const harnessPath = path.join(workingDirectory, 'harness.nsi')
    await writeFile(harnessPath, harnessScript(installerScriptPath), 'utf8')
    await execFileAsync('makensis', [harnessPath], { cwd: workingDirectory })
    console.log(`Installer script check passed: ${INSTALLER_SCRIPT} compiles.`)
  } catch (error) {
    if (isMissingMakensis(error)) {
      reportMissingMakensis()
      return
    }

    const detail = commandOutput(error)
    console.error(`Installer script check failed: ${INSTALLER_SCRIPT} does not compile.\n`)
    console.error(detail)
    console.error(
      '\nNSIS only allows `un.`-prefixed functions inside an uninstall section, so StrFunc helpers used by customUnInstall must be declared as their `Un` variant (for example `${UnStrRep}`) and called that way.',
    )
    process.exitCode = 1
  } finally {
    await rm(workingDirectory, { force: true, recursive: true })
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
