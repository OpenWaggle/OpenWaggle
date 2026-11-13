/**
 * The main process build (ADR 0064): `bun build` of `src/main/index.ts` as ES modules for the Bun
 * runtime, plus the boot shim and Pi's worker files beside it, in `out/main/`:
 *
 * - `boot.js`: package.json `main` and the Electrobun entry's import. It is bundled on its own
 *   because it must stay small (scripts/check-main-bundle.ts budgets it) and loads `index.js`.
 * - `index.js` and its `chunk-<hash>.js` files: the GUI main process, the Session Host and every
 *   CLI command, split at each `import()` so each process reads and parses only its own graph.
 *   Under Electron it was one file, because V8's compile cache made one file read from `app.asar`
 *   faster than a hundred chunks (A-F6); Bun caches no compiled ES module and reads flat files.
 * - `codemode-worker.js` and `image-resize-worker.js`: Pi's workers (`PI_WORKER_BUNDLES`).
 * - `.vite/main-chunks.json`: which source modules each output holds, for the startup budgets.
 *
 * External packages (package.json `dependencies` that are not bundled) load where their importer
 * first runs, never at the top of `index.js`: each static import of one goes through a virtual
 * CommonJS module that calls `import.meta.require`, which Bun wraps lazily (`lazyExternals`). A
 * plain `require()` there is miscompiled by Bun 1.4.4's bundler into an empty object.
 *
 *   bun scripts/build-main.ts
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveBuildIdentity } from './build-identity'
import {
  chunkManifest,
  lazyExternals,
  rawImports,
  relativeExternal,
  type SourceAlias,
  sourceAliases,
} from './build-main-plugins'
import { MAIN_CHUNK_MANIFEST_PATH } from './main-bundle-graph'
import { type BunBuildConfig, bunBuild } from './support/bun-build'
import { isObjectValue, uncheckedFields } from '@shared/utils/object-shape'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIRECTORY = path.join(ROOT, 'out/main')
const MAIN_ENTRY = 'src/main/index.ts'
const BOOT_ENTRY = 'src/main/boot.ts'
const JSON_INDENT = 0
const BUN_PRAGMA = '// @bun'
/** What the boot shim imports: the main bundle beside it. */
const MAIN_BUNDLE_SPECIFIER = './index.js'

/** Packages always left to the runtime: optional `ws` speedups, never installed. */
const ALWAYS_EXTERNAL = ['bufferutil', 'utf-8-validate']

/**
 * `dependencies` bundled into `index.js` anyway: ESM-only packages, workspace packages and
 * pure-JS packages made of many small files (resolved and compiled one by one as externals,
 * about 150 ms at startup: startup-main.md, A-F4). Natives, WASM readers and packages that locate
 * files beside themselves stay external, and the packaged app ships them in `node_modules`.
 */
export const BUNDLED_DEPENDENCIES = [
  '@diegogbrisa/ts-match',
  '@openwaggle/extension-sdk',
  '@openwaggle/pi-waggle',
  '@openwaggle/waggle-core',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-mcp',
  '@earendil-works/pi-tui',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/node',
  '@modelcontextprotocol/server',
  'typebox',
  'smol-toml',
  'jszip',
  'mammoth',
  'unpdf',
  'plist',
  'zod',
  'undici',
  'ws',
  'proper-lockfile',
  'ignore',
  'jsonc-parser',
  'remark-parse',
  'unified',
  'yauzl',
  'chokidar',
]

/** Source aliases the TypeScript projects declare (tsconfig.node.json `paths`). */
const SOURCE_ALIASES: readonly SourceAlias[] = [
  { specifier: '@shared', target: 'src/shared' },
  { specifier: '@openwaggle/extension-sdk', target: 'packages/extension-sdk/src/index.ts' },
  { specifier: '@openwaggle/pi-waggle', target: 'packages/pi-waggle/src' },
  { specifier: '@openwaggle/waggle-core', target: 'packages/waggle-core/src' },
]

/**
 * The Electrobun SDK ships as TypeScript source in the Hutch devkit (`bunx electrobun prepare`),
 * not as an npm package; the build bundles it (vendor/electrobun/README.md).
 */
export const ELECTROBUN_SDK_ENTRIES: Readonly<Record<string, string>> = {
  'electrobun/main': '.hutch/devkit/api/sdks/main/index.ts',
  'electrobun/main/events': '.hutch/devkit/api/sdks/main/entries/events.ts',
}

/**
 * Bundled packages whose `main` is a UMD build that loads its own files with a run-time
 * `require()`, which a bundle cannot serve: their ES module build instead.
 */
const PACKAGE_ENTRIES: Readonly<Record<string, string>> = {
  'jsonc-parser': 'node_modules/jsonc-parser/lib/esm/main.js',
}

/** Pi's workers, resolved from `import.meta.url` beside the bundle Pi runs in. */
const PI_CODING_AGENT_DIST = 'node_modules/@earendil-works/pi-coding-agent/dist'
export const PI_WORKERS: readonly {
  readonly entry: string
  readonly fileName: string
  readonly format: 'esm' | 'cjs'
  readonly external: readonly string[]
}[] = [
  // Started from an in-memory `data:` URL copy: one ES module that imports only `node:` builtins.
  {
    entry: `${PI_CODING_AGENT_DIST}/extensions/codemode/worker.js`,
    fileName: 'codemode-worker.js',
    format: 'esm',
    external: [],
  },
  // Photon reads its WASM beside its own entry, so it stays installed.
  {
    entry: `${PI_CODING_AGENT_DIST}/utils/image-resize-worker.js`,
    fileName: 'image-resize-worker.js',
    format: 'cjs',
    external: ['@silvia-odwyer/photon-node'],
  },
]

/** Every package the bundle leaves to `node_modules`. */
export function mainExternalPackages(manifest: unknown) {
  const declared = uncheckedFields<{ dependencies: object }>(manifest).dependencies
  const dependencies = isObjectValue(declared) ? Object.keys(declared) : []
  return new Set([
    ...ALWAYS_EXTERNAL,
    ...dependencies.filter((name) => !BUNDLED_DEPENDENCIES.includes(name)),
  ])
}

function buildDefines() {
  const identity = resolveBuildIdentity()
  return {
    __OW_BUILD_CHANNEL__: JSON.stringify(identity.channel),
    __OW_PRODUCT_NAME__: JSON.stringify(identity.productName),
    __OW_APP_ID__: JSON.stringify(identity.appId),
    // Pi reads its workers beside the bundle (`PI_WORKERS`) instead of from its own `dist`.
    PI_BUNDLED_NODE: 'true',
  }
}

async function build(config: BunBuildConfig) {
  const result = await bunBuild(config).catch((error: unknown) => {
    const logs: unknown =
      typeof error === 'object' && error !== null ? Reflect.get(error, 'errors') : undefined
    throw new Error(
      `bun build of ${config.entrypoints.join(', ')} failed:\n${Array.isArray(logs) ? logs.map(String).join('\n') : String(error)}`,
    )
  })
  if (!result.success) {
    throw new Error(
      `bun build of ${config.entrypoints.join(', ')} failed:\n${result.logs.map(String).join('\n')}`,
    )
  }
  return result
}

export interface MainBuildOptions {
  /** Default `out/main`. */
  readonly outDirectory?: string
  /** The GUI and CLI entry, default `src/main/index.ts`; scripts/pi-main-bundle-smoke.ts swaps it. */
  readonly entry?: string
}

export async function buildMain(options: MainBuildOptions = {}) {
  const outDirectory = options.outDirectory ?? OUT_DIRECTORY
  const manifest: unknown = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const externals = mainExternalPackages(manifest)
  const shared = {
    outdir: outDirectory,
    // `node`, not `bun`: for the `bun` target Bun resolves `undici` and `ws` to its own builtins
    // and bundles nothing of them: Bun's `undici` has no `Dispatcher1Wrapper` or `install`, and its
    // `fetch` ignores a `dispatcher`, which would bypass MCP's pinned DNS lookup. The output runs on Bun all the same,
    // and the `@bun` pragma tells Bun's loader it needs no transpiling.
    target: 'node',
    banner: BUN_PRAGMA,
    format: 'esm',
    define: buildDefines(),
    plugins: [
      rawImports(),
      sourceAliases(ROOT, SOURCE_ALIASES, { ...ELECTROBUN_SDK_ENTRIES, ...PACKAGE_ENTRIES }),
      lazyExternals(externals),
    ],
  } as const
  await rm(outDirectory, { recursive: true, force: true })
  await mkdir(outDirectory, { recursive: true })
  const main = await build({
    ...shared,
    entrypoints: [path.join(ROOT, options.entry ?? MAIN_ENTRY)],
    // Split at every `import()`: each process reads and parses only its own graph. Bun has no
    // compile cache for ES modules, so the one 15.6 MB file cost every process its full parse.
    // The chunks sit beside `index.js`, where `import.meta.dirname` finds the app's files.
    naming: { entry: 'index.js', chunk: 'chunk-[hash].js' },
    splitting: true,
    // Minified with names kept, as before: logs and libraries read function and class names.
    minify: { whitespace: true, syntax: true, identifiers: true, keepNames: true },
    // Hidden maps (no `sourceMappingURL`): never shipped, kept with each release.
    sourcemap: 'external',
    metafile: true,
  })
  await build({
    ...shared,
    entrypoints: [path.join(ROOT, BOOT_ENTRY)],
    naming: 'boot.js',
    // Every process parses it from source first, so it is minified as `index.js` is, with its
    // hidden map beside it.
    minify: { whitespace: true, syntax: true, identifiers: true, keepNames: true },
    sourcemap: 'external',
    // The boot shim imports `./index.js` at run time; it must not bundle it.
    plugins: [...shared.plugins, relativeExternal(MAIN_BUNDLE_SPECIFIER)],
  })
  for (const worker of PI_WORKERS) {
    await build({
      outdir: outDirectory,
      target: 'bun',
      format: worker.format,
      entrypoints: [path.join(ROOT, worker.entry)],
      naming: worker.fileName,
      external: worker.external,
    })
  }
  const outputs = main.metafile?.outputs ?? {}
  const file = path.join(outDirectory, MAIN_CHUNK_MANIFEST_PATH)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(chunkManifest(outputs), null, JSON_INDENT)}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildMain().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
