/**
 * The files that import a changed module, so the gate's type check also sees a signature change
 * that breaks a caller. `git grep` narrows the candidates by the module's file name; each
 * candidate's import specifiers are then resolved (relative paths and the tsconfig aliases) and
 * kept only when one resolves to a changed file.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { type RunProcess, git } from './run-process'

const TYPE_CHECKED = /\.(?:[cm]?tsx?)$/u
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](?<specifier>[^'"]+)['"]/gu
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx']
const GREP_TIMEOUT_MS = 10_000
export const MAX_IMPORTERS = 40

/** tsconfig.json `paths`, as prefixes: `@shared/x` reads `src/shared/x`. */
const ALIASES: readonly (readonly [string, string])[] = [
  ['@/', 'src/renderer/src/'],
  ['@shared/', 'src/shared/'],
  ['@openwaggle/extension-sdk', 'packages/extension-sdk/src'],
  ['@openwaggle/extension-react', 'packages/extension-react/src'],
  ['@openwaggle/pi-waggle', 'packages/pi-waggle/src'],
  ['@openwaggle/waggle-core', 'packages/waggle-core/src'],
]

function moduleStem(file: string) {
  const base = path.posix.basename(file).replace(SOURCE_EXTENSION, '')
  return base === 'index' ? path.posix.basename(path.posix.dirname(file)) : base
}

/** Repository-relative candidates a specifier written in `importer` may name. */
export function resolveSpecifier(importer: string, specifier: string): string[] {
  let target: string | undefined
  if (specifier.startsWith('.')) {
    target = path.posix.join(path.posix.dirname(importer), specifier)
  } else {
    const alias = ALIASES.find(([prefix]) => specifier === prefix || specifier.startsWith(prefix))
    if (alias !== undefined) {
      const rest = specifier.slice(alias[0].length)
      target = path.posix.join(alias[1], rest === '' ? 'index' : rest)
    }
  }
  if (target === undefined) return []
  const stripped = target.replace(SOURCE_EXTENSION, '')
  return RESOLVE_SUFFIXES.map((suffix) => `${stripped}${suffix}`)
}

export function importsAny(importer: string, text: string, targets: ReadonlySet<string>) {
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match.groups?.['specifier'] ?? ''
    if (resolveSpecifier(importer, specifier).some((candidate) => targets.has(candidate)))
      return true
  }
  return false
}

/** Files that import one of `changed`, not counting `changed` itself; at most MAX_IMPORTERS. */
export async function importersOf(run: RunProcess, root: string, changed: readonly string[]) {
  const modules = changed.filter((file) => TYPE_CHECKED.test(file))
  if (modules.length === 0) return []
  const stems = [...new Set(modules.map(moduleStem))]
  const patterns = stems.flatMap((stem) => [
    '-e',
    `/${stem}'`,
    '-e',
    `/${stem}.js'`,
    '-e',
    `/${stem}.ts'`,
    '-e',
    `/${stem}"`,
  ])
  const output = await git(
    run,
    root,
    ['grep', '-l', '-F', '--untracked', ...patterns, '--', '*.ts', '*.tsx', '*.mts'],
    GREP_TIMEOUT_MS,
  )
  const targets = new Set(modules)
  const candidates = (output ?? '').split('\n').filter((file) => file !== '' && !targets.has(file))
  const importers: string[] = []
  for (const candidate of candidates) {
    if (importers.length >= MAX_IMPORTERS) break
    const text = await readFile(path.join(root, candidate), 'utf8').catch(() => '')
    if (importsAny(candidate, text, targets)) importers.push(candidate)
  }
  return importers
}
