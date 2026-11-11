/**
 * The Bun bundler plugins of the main build (scripts/build-main.ts): lazily required externals,
 * Vite's `?raw` imports, and the source aliases the TypeScript projects declare.
 */
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { MainChunkManifestEntry } from './main-bundle-graph'
import type { BunBuildMetafileOutput, BunPlugin } from './support/bun-build'

const LAZY_EXTERNAL_NAMESPACE = 'openwaggle-lazy-external'
const SCOPED_PACKAGE_SEGMENTS = 2

export interface SourceAlias {
  readonly specifier: string
  readonly target: string
}

/** The package name of a bare specifier (`@scope/name/sub` -> `@scope/name`). */
export function packageName(specifier: string) {
  const parts = specifier.split('/')
  return specifier.startsWith('@')
    ? parts.slice(0, SCOPED_PACKAGE_SEGMENTS).join('/')
    : (parts[0] ?? specifier)
}

/** The body of the virtual module standing in for `specifier` until its importer runs. */
export function lazyExternalSource(specifier: string) {
  return `module.exports = import.meta.require(${JSON.stringify(specifier)});\n`
}

export function lazyExternals(externals: ReadonlySet<string>): BunPlugin {
  return {
    name: 'openwaggle:lazy-externals',
    setup(builder) {
      builder.onResolve({ filter: /^[^./]/u }, (args) => {
        if (args.path.startsWith('node:') || !externals.has(packageName(args.path))) {
          return undefined
        }
        if (args.namespace === LAZY_EXTERNAL_NAMESPACE || args.kind !== 'import-statement') {
          return { path: args.path, external: true }
        }
        return { path: args.path, namespace: LAZY_EXTERNAL_NAMESPACE }
      })
      builder.onLoad({ filter: /.*/u, namespace: LAZY_EXTERNAL_NAMESPACE }, (args) => ({
        contents: lazyExternalSource(args.path),
        loader: 'js',
      }))
    },
  }
}

const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx']

/** The file an extensionless source path names, as TypeScript's bundler resolution finds it. */
export function resolveSourceFile(base: string, exists: (file: string) => boolean = isFile) {
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (exists(candidate)) return candidate
  }
  throw new Error(`No source file for ${base}`)
}

function isFile(file: string) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

export function sourceAliases(
  root: string,
  aliases: readonly SourceAlias[],
  modules: Readonly<Record<string, string>>,
): BunPlugin {
  return {
    name: 'openwaggle:source-aliases',
    setup(builder) {
      builder.onResolve({ filter: /^(?:@shared|@openwaggle\/|electrobun\/)/u }, (args) => {
        const module = modules[args.path]
        if (module !== undefined) return { path: path.join(root, module) }
        const alias = aliases.find(
          (candidate) =>
            args.path === candidate.specifier || args.path.startsWith(`${candidate.specifier}/`),
        )
        if (!alias) return undefined
        const rest = args.path.slice(alias.specifier.length)
        return { path: resolveSourceFile(path.join(root, `${alias.target}${rest}`)) }
      })
    },
  }
}

const RAW_NAMESPACE = 'openwaggle-raw'
const RAW_QUERY = '?raw'

/** Vite's `?raw` imports: the file's text as the default export. */
export function rawImports(): BunPlugin {
  return {
    name: 'openwaggle:raw-imports',
    setup(builder) {
      builder.onResolve({ filter: /\?raw$/u }, (args) => {
        const file = args.path.slice(0, -RAW_QUERY.length)
        const resolved = file.startsWith('.')
          ? path.resolve(path.dirname(args.importer), file)
          : createRequire(args.importer).resolve(file)
        return { path: resolved, namespace: RAW_NAMESPACE }
      })
      builder.onLoad({ filter: /.*/u, namespace: RAW_NAMESPACE }, (args) => ({
        contents: `export default ${JSON.stringify(readFileSync(args.path, 'utf8'))};\n`,
        loader: 'js',
      }))
    },
  }
}

/** The chunk manifest scripts/check-main-bundle.ts reads, from Bun's metafile. */
export function chunkManifest(
  outputs: Readonly<Record<string, BunBuildMetafileOutput>>,
): MainChunkManifestEntry[] {
  return Object.entries(outputs).map(([file, output]) => ({
    file: path.posix.normalize(file.split(path.sep).join('/')),
    isEntry: output.entryPoint !== undefined,
    modules: Object.keys(output.inputs).map((input) => input.split(path.sep).join('/')),
    imports: output.imports
      .filter((entry) => entry.kind === 'import-statement')
      .map((entry) => entry.path),
    dynamicImports: output.imports
      .filter((entry) => entry.kind === 'dynamic-import')
      .map((entry) => entry.path),
  }))
}
