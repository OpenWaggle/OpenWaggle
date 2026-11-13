/**
 * The installed packages the packaged app loads at run time, for every desktop shell's packaging.
 *
 * The main build bundles every dependency it can (`BUNDLED_DEPS`, scripts/vite/main-externals.ts),
 * so the app needs from `node_modules` only the externals the build leaves to it (native modules,
 * WASM readers, packages that locate files beside themselves), the bundled packages a worker
 * resolves by path, and everything those depend on at run time. The rest, such as Effect, Pi and
 * the provider SDKs, is inside the main bundle; shipping their installed copies too added about
 * 80 MB to the installed app and every update.
 *
 * A package outside that closure may still be read for a few files: Pi resolves its README, docs,
 * examples, themes and HTML export templates from its package directory
 * (src/main/adapters/pi/pi-package-directory.ts). Inside the closure, some packages ship builds for
 * other runtimes that Node never resolves (`PACKAGE_UNLOADED_FILES`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodeUnknownOrThrow, parseJsonUnknown, Schema } from '@shared/schema'

/**
 * Bundled packages the attachment parser worker resolves from `node_modules` when it loads
 * (src/main/utils/attachment-parser-worker.ts), so a package without them fails to parse.
 */
export const RUNTIME_RESOLVED_PACKAGES = ['jszip', 'mammoth', 'unpdf'] as const

/** Files of bundled packages that their bundled code reads from the package directory. */
export const BUNDLED_PACKAGE_ASSETS: Readonly<Record<string, readonly string[]>> = {
  '@earendil-works/pi-coding-agent': [
    'package.json',
    'README.md',
    'docs',
    'examples',
    'dist/core/export-html',
    'dist/modes/interactive/theme',
    'dist/modes/interactive/assets',
  ],
}

/**
 * Packages the app installs but never loads, so neither they nor what only they depend on ship:
 * transformers.js's Node build runs inference through onnxruntime-node, not the web runtime.
 */
export const UNLOADED_PACKAGES: ReadonlySet<string> = new Set(['onnxruntime-web'])

/**
 * Files of shipped packages that the app never loads, as globs relative to the package directory.
 * Each package's entry points are what Node resolves from a CommonJS `require` or a dynamic
 * `import()` of the bare name; the rest are builds for browsers, bundlers or other module systems.
 *
 * - lucide: `main` is the CommonJS build. The UMD build is inlined into the main bundle at build
 *   time (src/main/inline-visualization-protocol.ts) and Node ignores the ESM `module` field.
 * - transformers.js: the embedding process loads the file `require.resolve` returns
 *   (`transformers.node.cjs`, src/main/adapters/session-embedding-process.ts); the rest are web
 *   and minified builds, the ONNX web runtime's loader and the TypeScript sources.
 * - underscore: mammoth requires the package, whose Node `require` export is `underscore-node.cjs`.
 * - zlibjs: only tesseract.js's browser worker requires it (`bin/node-zlib.js` is its `main`).
 * - tesseract.js-core: the attachment parser asks for the LSTM engine (`OEM.LSTM_ONLY`,
 *   src/main/utils/attachment-parser-worker.ts), so tesseract.js loads one of the `*-lstm` cores; the
 *   legacy-engine cores and the browser builds with their WASM inlined (`*.wasm.js`) never load.
 * - playwright-core: Browser preview attaches over CDP; `lib/vite` holds the trace viewer,
 *   recorder and HTML report web apps of Playwright's own tooling.
 */
export const PACKAGE_UNLOADED_FILES: Readonly<Record<string, readonly string[]>> = {
  lucide: ['dist/esm', 'dist/umd'],
  '@huggingface/transformers': ['src', 'types', 'dist/!(transformers.node.cjs)'],
  underscore: ['!(package.json|underscore-node.cjs|underscore-node-f.cjs)'],
  zlibjs: ['bin/!(node-zlib.js)'],
  'tesseract.js-core': ['*.wasm.js', 'tesseract-core{,-simd,-relaxedsimd}.{js,wasm}'],
  'playwright-core': ['lib/vite'],
}

export interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
}

const dependencyMap = Schema.optionalWith(
  Schema.Record({ key: Schema.String, value: Schema.String }),
  { exact: true },
)
/** The dependency fields of a `package.json`; the rest is not read. */
const packageManifestSchema = Schema.Struct({
  dependencies: dependencyMap,
  optionalDependencies: dependencyMap,
  peerDependencies: dependencyMap,
  peerDependenciesMeta: Schema.optionalWith(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        optional: Schema.optionalWith(Schema.Boolean, { exact: true }),
      }),
    }),
    { exact: true },
  ),
})

export function readManifest(directory: string) {
  const file = path.join(directory, 'package.json')
  try {
    const manifest: PackageManifest = decodeUnknownOrThrow(
      packageManifestSchema,
      parseJsonUnknown(fs.readFileSync(file, 'utf8')),
    )
    return manifest
  } catch (error) {
    throw new Error(`${file} has no readable dependency fields`, { cause: error })
  }
}

/** What a package needs at run time: dependencies, optional ones and required peers. */
export function runtimeDependencyNames(manifest: PackageManifest) {
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (name) => manifest.peerDependenciesMeta?.[name]?.optional !== true,
  )
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...peers,
  ]
}

/**
 * Node's lookup of `name` from a package directory: `<ancestor>/node_modules/<name>` from the
 * directory up. Works for the isolated linker's store (`node_modules/.bun/<id>/node_modules`) and a
 * hoisted tree alike. An optional dependency for another platform is simply not installed.
 */
export function resolvePackageDirectory(name: string, fromDirectory: string) {
  let directory = fromDirectory
  let parent = path.dirname(directory)
  while (directory !== parent) {
    if (path.basename(directory) !== 'node_modules') {
      const candidate = path.join(directory, 'node_modules', name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    }
    directory = parent
    parent = path.dirname(directory)
  }
  return undefined
}

/** The names of every package reachable from `roots` without passing `skip`, from `projectRoot`. */
export function packageClosure(
  roots: readonly string[],
  projectRoot: string,
  skip: ReadonlySet<string> = new Set(),
) {
  const names = new Set<string>()
  const visited = new Set<string>()
  const pending = roots.map((name) => ({ name, from: projectRoot }))
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (skip.has(next.name)) continue
    const directory = resolvePackageDirectory(next.name, next.from)
    if (!directory) continue
    names.add(next.name)
    if (visited.has(directory)) continue
    visited.add(directory)
    for (const dependency of runtimeDependencyNames(readManifest(directory))) {
      pending.push({ name: dependency, from: directory })
    }
  }
  return names
}

export interface PackagedRuntimePackages {
  /** Packages whose installed files the app loads. */
  readonly runtime: ReadonlySet<string>
  /**
   * Installed production packages the app never loads from `node_modules`, apart from the assets
   * of bundled ones (`BUNDLED_PACKAGE_ASSETS`).
   */
  readonly unshipped: readonly string[]
}

/**
 * Splits the production dependency tree of `projectRoot` into the packages the app loads and the
 * ones it does not: those only the bundle contains and `UNLOADED_PACKAGES` with what only they
 * need. `externals` are the main build's externals.
 */
export function packagedRuntimePackages(projectRoot: string, externals: readonly string[]) {
  const manifest = readManifest(projectRoot)
  const production = packageClosure(
    [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ],
    projectRoot,
  )
  const runtime = packageClosure(
    [...externals, ...RUNTIME_RESOLVED_PACKAGES],
    projectRoot,
    UNLOADED_PACKAGES,
  )
  const unshipped = [...production]
    .filter((name) => !runtime.has(name))
    .sort((left, right) => left.localeCompare(right))
  const packages: PackagedRuntimePackages = { runtime, unshipped }
  return packages
}
