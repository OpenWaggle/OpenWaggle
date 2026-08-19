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
  type CompilePassName,
  derivePlacements,
  findNsisTemplates,
  type HookContext,
  type HookPlacement,
  parseDefinedMacros,
} from './installer-hook-placements'

const execFileAsync = promisify(execFile)

const ELECTRON_BUILDER_CONFIG = 'electron-builder.yml'
/** Fallback only for the error message when the config does not declare one. */
const DEFAULT_INSTALLER_SCRIPT = 'build/installer.nsh'
/**
 * The `include:` that belongs to the top-level `nsis:` block.
 *
 * Scoped deliberately: an unanchored search would match an `include:` under any other key - `files`,
 * `dmg`, a linux target - and compile a path that is not the installer script at all.
 */
const NSIS_BLOCK = /^nsis:\s*$/mu
const BLOCK_ENTRY = /^ {2}(?<key>[A-Za-z_][\w-]*):\s*(?<value>\S+)?\s*$/u
const TOP_LEVEL_KEY = /^\S/u
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
  placements: ReadonlyMap<string, HookPlacement>,
): readonly CompilePass[] {
  const forPass = (pass: CompilePassName, context: HookContext) =>
    [...placements.entries()]
      .filter(([, place]) => place.passes.includes(pass) && place.context === context)
      .map(([hook]) => hook)

  const header = (extra: readonly string[]) => [
    '!include "WinMessages.nsh"',
    `!include "${installerScriptPath}"`,
    '',
    'Name "installer-script-check"',
    'OutFile "installer-script-check.exe"',
    'InstallDir "$TEMP\\installer-script-check"',
    '',
    ...extra,
    '',
  ]

  const insert = (macros: readonly string[], indent: string) =>
    macros.map((macro) => `${indent}!insertmacro ${macro}`)

  /*
   * A function wrapper for the hooks electron-builder inserts inside `.onInit`, `un.onInit` or one of
   * its own macro bodies. Their instructions are illegal at top level, and - the reason this matters
   * - whether a StrFunc call is legal depends on the pass and the block it sits in.
   */
  const functionBlock = (name: string, macros: readonly string[]) =>
    macros.length === 0 ? [] : [`Function ${name}`, ...insert(macros, '  '), 'FunctionEnd', '']
  // Only call the wrapper when there is one: an unresolved Call aborts the compile.
  const callIfDefined = (name: string, macros: readonly string[]) =>
    macros.length === 0 ? [] : [`  Call ${name}`]

  return [
    {
      label: 'installer',
      defines: [],
      script: [
        ...header(insert(forPass('installer', 'top-level'), '')),
        ...functionBlock('CheckHooks', forPass('installer', 'function')),
        'Section "Install"',
        ...insert(forPass('installer', 'section'), '  '),
        ...callIfDefined('CheckHooks', forPass('installer', 'function')),
        'SectionEnd',
        '',
      ].join('\n'),
    },
    {
      label: 'uninstaller',
      defines: ['BUILD_UNINSTALLER'],
      script: [
        ...header(insert(forPass('uninstaller', 'top-level'), '')),
        ...functionBlock('un.CheckHooks', forPass('uninstaller', 'function')),
        'Section "Install"',
        '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
        'SectionEnd',
        '',
        'Section "Uninstall"',
        ...insert(forPass('uninstaller', 'section'), '  '),
        ...callIfDefined('un.CheckHooks', forPass('uninstaller', 'function')),
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
  const lines = config.split('\n')
  const start = lines.findIndex((line) => NSIS_BLOCK.test(line))
  if (start === -1) return null

  for (const line of lines.slice(start + 1)) {
    // The block ends at the next top-level key.
    if (TOP_LEVEL_KEY.test(line) && line.trim().length > 0) return null
    const entry = BLOCK_ENTRY.exec(line)
    if (entry?.groups?.['key'] === 'include') return entry.groups['value'] ?? null
  }
  return null
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
  if (macros.length === 0) {
    console.error(
      `${declaredScript} defines no macros, so this check would compile nothing. Refusing to pass.`,
    )
    process.exitCode = 1
    return
  }

  const templatesDir = await findNsisTemplates(repositoryRoot)
  if (templatesDir === null) {
    console.error(
      "electron-builder's NSIS templates were not found, so hook placements cannot be derived. " +
        'Install dependencies before running this check.',
    )
    process.exitCode = 1
    return
  }

  const derived = await derivePlacements(templatesDir, macros)
  const unsupported = [...derived.entries()]
    .filter(([, place]) => place === null)
    .map(([hook]) => hook)
  if (unsupported.length > 0) {
    console.error(
      `${declaredScript} defines hook(s) this electron-builder version never inserts: ` +
        `${unsupported.join(', ')}.\n` +
        'They would never run. Remove them, or correct the macro name.',
    )
    process.exitCode = 1
    return
  }
  const placements = new Map<string, HookPlacement>()
  for (const [hook, place] of derived) if (place !== null) placements.set(hook, place)

  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'openwaggle-nsis-check-'))

  try {
    for (const pass of compilePasses(installerScriptPath, placements)) {
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
