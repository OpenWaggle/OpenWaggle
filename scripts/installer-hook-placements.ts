import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import fg from 'fast-glob'

/**
 * Where electron-builder inserts a customisation hook, derived from its own templates.
 *
 * The compile check has to exercise every hook the script defines, in the place *and pass* that
 * electron-builder uses, or it inverts its own verdict. A hand-written table got this wrong: an
 * independent review proved with real makensis that `customUnInstallCheck` was compiled in the
 * uninstaller pass while electron-builder compiles it in the installer pass (it lives in
 * `include/installUtil.nsh`, included under `!ifndef BUILD_UNINSTALLER`), so a hook calling the
 * wrong StrFunc variant passed the check and would have died during a release - the exact failure
 * the check exists to prevent. Four more hooks were placed at top level although they are inserted
 * inside functions, where their instructions are legal.
 *
 * So the table is not written by hand any more. It is read out of the vendored
 * `app-builder-lib/templates/nsis/**`, which is the only authority on the question.
 */
export type HookContext = 'top-level' | 'section' | 'function'

/** The compilations electron-builder performs: the installer, and the uninstaller separately. */
export type CompilePassName = 'installer' | 'uninstaller'

export interface HookPlacement {
  /**
   * Every pass that compiles this hook.
   *
   * A set, not a boolean. `installer.nsi` is compiled twice - once plainly, once with
   * `-DBUILD_UNINSTALLER` - so a hook inserted there with no pass guard is compiled in *both*, and
   * modelling the pass as a single flag silently checked `customHeader` and `preInit` in the installer
   * pass only. A helper those hooks rely on is declared per pass, so the unchecked pass is exactly
   * where a release would fail.
   */
  readonly passes: readonly CompilePassName[]
  readonly context: HookContext
  /** Where the placement was observed, for the error message. */
  readonly source: string
}

const TEMPLATE_GLOB = 'node_modules/.pnpm/app-builder-lib@*/node_modules/app-builder-lib/templates/nsis'
const UNINSTALLER_DEFINE = 'BUILD_UNINSTALLER'
const ALL_PASSES: readonly CompilePassName[] = ['installer', 'uninstaller']
/** Templates the installer entry point includes only for one pass. */
const PASS_BY_TEMPLATE: Readonly<Record<string, boolean>> = {
  'uninstaller.nsh': true,
  'installUtil.nsh': false,
  'installSection.nsh': false,
}

/**
 * Templates that are `!include`d *inside* a block, so their own top level is not top level.
 *
 * `installSection.nsh` is included inside `Section "install"`, and the `include/*.nsh` helpers are
 * macro bodies invoked from functions. Reading context only within a file would call these top
 * level and compile their hooks where instructions are illegal.
 */
const CONTEXT_BY_TEMPLATE: Readonly<Record<string, HookContext>> = {
  'installSection.nsh': 'section',
}

/**
 * Resolve the vendored templates directory, or null when the dependency is absent.
 *
 * Resolved through Node rather than by globbing the pnpm store: the store can hold several
 * `app-builder-lib` versions at once, and taking the first glob hit would read templates from a copy
 * electron-builder does not use - which is the opposite of this module's contract that the vendored
 * templates are the authority. The glob remains only as a fallback for an unusual layout.
 */
export async function findNsisTemplates(repositoryRoot: string): Promise<string | null> {
  const resolved = resolveTemplatesThroughNode(repositoryRoot)
  if (resolved !== null) return resolved

  const matches = await fg(TEMPLATE_GLOB, {
    cwd: repositoryRoot,
    onlyDirectories: true,
    absolute: true,
  })
  return matches[0] ?? null
}

function resolveTemplatesThroughNode(repositoryRoot: string): string | null {
  try {
    const require = createRequire(path.join(repositoryRoot, 'package.json'))
    const manifest = require.resolve('app-builder-lib/package.json')
    return path.join(path.dirname(manifest), 'templates', 'nsis')
  } catch {
    return null
  }
}

const MACRO_DEFINITION = /^!macro\s+(?<name>\S+)/u

/** Every macro the installer script defines, in file order. */
export function parseDefinedMacros(scriptSource: string): readonly string[] {
  const names: string[] = []
  for (const line of scriptSource.split('\n')) {
    const name = MACRO_DEFINITION.exec(line.trim())?.groups?.['name']
    if (name !== undefined) names.push(name)
  }
  return names
}

const BLOCK_END = /^(?:SectionEnd|FunctionEnd|!macroend)\b/iu
const SECTION_START = /^Section\b/iu
const FUNCTION_START = /^Function\b/iu
const MACRO_START = /^!macro\b/iu

/**
 * The NSIS block a line sits inside: a section, a function, or neither.
 *
 * A hook inside a template's own `!macro` is inserted wherever that macro is, and every such macro
 * in these templates is invoked from a function or section, so it is treated as a function - the
 * stricter of the two for StrFunc purposes.
 */
function contextAt(lines: readonly string[], index: number): HookContext {
  let closed = 0
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const line = (lines[cursor] ?? '').trim()
    if (BLOCK_END.test(line)) {
      closed += 1
      continue
    }
    const opensSection = SECTION_START.test(line)
    const opensCallable = FUNCTION_START.test(line) || MACRO_START.test(line)
    if (!opensSection && !opensCallable) continue
    if (closed > 0) {
      closed -= 1
      continue
    }
    return opensSection ? 'section' : 'function'
  }
  return 'top-level'
}

/**
 * Whether the insertion sits inside a BUILD_UNINSTALLER region of its own file.
 *
 * `!else` flips the polarity, which is how `customInit` is reached: it sits in the `!else` of an
 * `!ifdef BUILD_UNINSTALLER`, i.e. the installer pass. Ignoring `!else` reported the opposite.
 */
function guardedForUninstaller(lines: readonly string[], index: number): boolean | null {
  const stack: (boolean | null)[] = []
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const line = (lines[cursor] ?? '').trim()
    const mentionsDefine = line.includes(UNINSTALLER_DEFINE)
    if (line.startsWith('!ifdef ') && mentionsDefine) {
      stack.push(true)
      continue
    }
    if (line.startsWith('!ifndef ') && mentionsDefine) {
      stack.push(false)
      continue
    }
    if (line.startsWith('!else')) {
      const current = stack.pop()
      stack.push(typeof current === 'boolean' ? !current : null)
      continue
    }
    if (line.startsWith('!endif')) {
      stack.pop()
      continue
    }
    if (line.startsWith('!if')) stack.push(null)
  }
  // The innermost decided guard wins.
  for (const entry of [...stack].reverse()) if (entry !== null) return entry
  return null
}

/**
 * Find where electron-builder inserts each hook.
 *
 * Returns `null` for a hook that appears in no template: that is a hook this version of
 * electron-builder does not support, which must fail the check rather than be skipped.
 */
export async function derivePlacements(
  templatesDir: string,
  hooks: readonly string[],
): Promise<ReadonlyMap<string, HookPlacement | null>> {
  const files = await fg('**/*.{nsh,nsi}', { cwd: templatesDir, absolute: true })
  const sources = await Promise.all(
    files.map(async (file) => ({ file, lines: (await readFile(file, 'utf8')).split('\n') })),
  )

  const placements = new Map<string, HookPlacement | null>()
  for (const hook of hooks) {
    placements.set(hook, findPlacement(sources, templatesDir, hook))
  }
  return placements
}

function findPlacement(
  sources: readonly { readonly file: string; readonly lines: readonly string[] }[],
  templatesDir: string,
  hook: string,
): HookPlacement | null {
  const insertion = new RegExp(`!insertmacro\\s+${hook}\\b`, 'u')
  for (const { file, lines } of sources) {
    const index = lines.findIndex((line) => insertion.test(line))
    if (index === -1) continue

    const relative = path.relative(templatesDir, file)
    const guarded = guardedForUninstaller(lines, index)
    const byTemplate = PASS_BY_TEMPLATE[path.basename(relative)]
    const basename = path.basename(relative)
    const withinFile = contextAt(lines, index)
    const pass = guarded ?? byTemplate
    return {
      /*
       * An unguarded insertion in a file that is not pass-specific is compiled in both passes, which
       * is how electron-builder treats `installer.nsi` itself.
       */
      passes: pass === undefined || pass === null ? ALL_PASSES : [pass ? 'uninstaller' : 'installer'],
      context: withinFile === 'top-level' ? (CONTEXT_BY_TEMPLATE[basename] ?? 'top-level') : withinFile,
      source: `${relative}:${String(index + 1)}`,
    }
  }
  return null
}
