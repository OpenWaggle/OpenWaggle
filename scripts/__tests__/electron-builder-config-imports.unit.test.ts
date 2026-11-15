import fs from 'node:fs'
import path from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

// electron-builder loads electron-builder.ts through jiti, which resolves imports the way Node
// does and ignores tsconfig `paths`. An `@shared/schema` import in scripts/packaged-runtime-packages.ts
// once broke `bun install` (its postinstall runs `electron-builder install-app-deps`) and every
// packaged build, while Vite and Vitest, which know the aliases, stayed green.

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const RESOLVABLE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.cts', '/index.ts']

function tsconfigAliasPrefixes() {
  const prefixes = new Set<string>()
  for (const file of ['tsconfig.json', 'tsconfig.node.json']) {
    const config: unknown = parseJsonc(fs.readFileSync(path.join(repositoryRoot, file), 'utf8'))
    const paths = Object(Object(Object(config).compilerOptions).paths)
    for (const key of Object.keys(paths)) prefixes.add(key.replace(/\*$/, ''))
  }
  return [...prefixes]
}

function resolveRelative(importer: string, specifier: string) {
  const base = path.resolve(path.dirname(importer), specifier)
  const resolved = RESOLVABLE_EXTENSIONS.map((extension) => `${base}${extension}`).find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  )
  if (resolved === undefined) throw new Error(`cannot resolve ${specifier} from ${importer}`)
  return resolved
}

/** The specifiers a file loads at run time: type-only imports and exports are erased. */
function runtimeSpecifiers(file: string) {
  const { module } = parseSync(file, fs.readFileSync(file, 'utf8'))
  const imports = module.staticImports
    .filter((entry) => entry.entries.length === 0 || entry.entries.some((item) => !item.isType))
    .map((entry) => entry.moduleRequest.value)
  const reexports = module.staticExports.flatMap((entry) =>
    entry.entries.flatMap((item) =>
      item.moduleRequest !== null && !item.isType ? [item.moduleRequest.value] : [],
    ),
  )
  return [...imports, ...reexports]
}

function aliasedImports(entry: string, aliases: readonly string[]) {
  const visited = new Set<string>()
  const found: string[] = []
  const pending = [entry]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (visited.has(file)) continue
    visited.add(file)
    for (const specifier of runtimeSpecifiers(file)) {
      if (specifier.startsWith('.')) {
        pending.push(resolveRelative(file, specifier))
        continue
      }
      if (aliases.some((alias) => specifier.startsWith(alias))) {
        found.push(`${path.relative(repositoryRoot, file)} imports ${specifier}`)
      }
    }
  }
  return found
}

describe('electron-builder.ts import graph', () => {
  it('loads every module through plain Node resolution, without a tsconfig path alias', () => {
    const aliases = tsconfigAliasPrefixes()
    expect(aliases).toContain('@shared/')

    expect(aliasedImports(path.join(repositoryRoot, 'electron-builder.ts'), aliases)).toEqual([])
  })
})
