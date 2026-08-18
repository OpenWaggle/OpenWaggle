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
 * This must match how electron-builder actually invokes makensis, or it gives false
 * confidence - the first version of this check passed while the release still failed:
 *
 * - **Two passes.** electron-builder compiles the uninstaller separately, with
 *   `BUILD_UNINSTALLER` defined, inserting `customUnInstall`; the installer pass inserts
 *   `customInstall`. A helper declared in the wrong pass is unreferenced there.
 * - **Warnings are errors.** electron-builder passes `-WX`, so `warning 6010: install
 *   function ... not referenced` fails the build. Without `-WX` this check would miss it.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  type HookInsertions,
  parseDefinedMacros,
  planHookInsertions,
} from './installer-hook-placements'

const execFileAsync = promisify(execFile)

const ELECTRON_BUILDER_CONFIG = 'electron-builder.yml'
/** Fallback only for the error message when the config does not declare one. */
const DEFAULT_INSTALLER_SCRIPT = 'build/installer.nsh'
const NSIS_INCLUDE_LINE = /^\s*include:\s*(?<path>\S+)\s*$/mu
const MAKENSIS_MISSING_EXIT_CODES = new Set(['ENOENT'])
/** electron-builder compiles with warnings-as-errors; mirror it or the check is weaker. */
const MAKENSIS_ARGS = ['-WX'] as const

interface CompilePass {
  readonly label: string
  readonly defines: readonly string[]
  readonly script: string
}

/**
 * Mirrors electron-builder's own usage: it `!include`s the custom script, inserts the top-level
 * hooks in both passes, the install-section hooks into the installer, and the uninstall-section
 * hooks into the uninstaller of a separate `BUILD_UNINSTALLER` compilation.
 *
 * Every hook the script defines is inserted, derived from the script itself. Hardcoding
 * `customInstall`/`customUnInstall` meant any other hook was never compiled at all: verified that
 * an undeclared StrFunc call *and* a bogus instruction inside a `customHeader` macro both compiled
 * clean under the old harness.
 */
function compilePasses(
  installerScriptPath: string,
  insertions: HookInsertions,
): readonly CompilePass[] {
  const insertMacros = (macros: readonly string[], indent: string) =>
    macros.map((macro) => `${indent}!insertmacro ${macro}`)

  const include = [
    '!include "WinMessages.nsh"',
    `!include "${installerScriptPath}"`,
    '',
    'Name "installer-script-check"',
    'OutFile "installer-script-check.exe"',
    'InstallDir "$TEMP\\installer-script-check"',
    '',
    ...insertMacros(insertions.topLevel, ''),
    '',
  ]

  return [
    {
      label: 'installer',
      defines: [],
      script: [
        ...include,
        'Section "Install"',
        ...insertMacros(insertions.installSection, '  '),
        'SectionEnd',
        '',
      ].join('\n'),
    },
    {
      label: 'uninstaller',
      defines: ['BUILD_UNINSTALLER'],
      script: [
        ...include,
        'Section "Install"',
        '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
        'SectionEnd',
        '',
        'Section "Uninstall"',
        ...insertMacros(insertions.uninstallSection, '  '),
        'SectionEnd',
        '',
      ].join('\n'),
    },
  ]
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
    `Installer script check skipped: makensis not installed. ${DEFAULT_INSTALLER_SCRIPT} is compile-checked in CI.`,
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

/**
 * The script electron-builder is actually configured to include.
 *
 * Read from the config rather than hardcoded, so renaming or moving the file cannot leave this
 * check compiling a path that no longer ships - it would pass while the real installer went
 * unchecked, or fail for a file nothing uses.
 */
async function resolveInstallerScript(repositoryRoot: string) {
  const config = await readFile(path.join(repositoryRoot, ELECTRON_BUILDER_CONFIG), 'utf8')
  return NSIS_INCLUDE_LINE.exec(config)?.groups?.['path'] ?? null
}

async function main() {
  const repositoryRoot = process.cwd()
  const declaredScript = await resolveInstallerScript(repositoryRoot)
  if (declaredScript === null) {
    console.error(
      `${ELECTRON_BUILDER_CONFIG} declares no nsis.include, so there is no installer script to ` +
        `check. If the customisations were removed, remove this check too; otherwise restore the ` +
        `include (it was ${DEFAULT_INSTALLER_SCRIPT}).`,
    )
    process.exitCode = 1
    return
  }
  const installerScriptPath = path.join(repositoryRoot, declaredScript)
  const macros = parseDefinedMacros(await readFile(installerScriptPath, 'utf8'))
  const insertions = planHookInsertions(macros)

  if (insertions.unmapped.length > 0) {
    console.error(
      `${declaredScript} defines hook(s) this check has no insertion point for: ` +
        `${insertions.unmapped.join(', ')}.\n` +
        'Add them to HOOK_PLACEMENTS in scripts/installer-hook-placements.ts so they are actually ' +
        'compiled. Skipping them silently is how an unguarded hook reaches a release.',
    )
    process.exitCode = 1
    return
  }
  if (macros.length === 0) {
    console.error(
      `${declaredScript} defines no macros, so this check would compile nothing. Refusing to pass.`,
    )
    process.exitCode = 1
    return
  }

  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'openwaggle-nsis-check-'))

  try {
    for (const pass of compilePasses(installerScriptPath, insertions)) {
      const harnessPath = path.join(workingDirectory, `harness-${pass.label}.nsi`)
      await writeFile(harnessPath, pass.script, 'utf8')
      const defineArgs = pass.defines.map((define) => `-D${define}`)
      await execFileAsync('makensis', [...MAKENSIS_ARGS, ...defineArgs, harnessPath], {
        cwd: workingDirectory,
      })
    }
    console.log(
      `Installer script check passed: ${declaredScript} compiles for the installer and uninstaller passes.`,
    )
  } catch (error) {
    if (isMissingMakensis(error)) {
      reportMissingMakensis()
      return
    }

    const detail = commandOutput(error)
    console.error(`Installer script check failed: ${declaredScript} does not compile.\n`)
    console.error(detail)
    console.error(
      '\nNSIS only allows `un.`-prefixed functions inside an uninstall section, so StrFunc helpers used by customUnInstall must be declared as their `Un` variant (for example `${UnStrRep}`) and called that way. Declare each helper only in the pass that uses it (`!ifdef BUILD_UNINSTALLER`): electron-builder compiles with warnings-as-errors, and a declared-but-unreferenced helper is `warning 6010`.',
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
