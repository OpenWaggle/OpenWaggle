/**
 * The main process build (ADR 0064): `bun build` of `src/main/index.ts` as one ES module for the
 * Bun runtime, plus the boot shim and Pi's worker files beside it, in `out/main/`:
 *
 * - `boot.js`: package.json `main` and the Electrobun entry's import. It is bundled on its own
 *   because it must stay small (scripts/check-main-bundle.ts budgets it) and loads `index.js`.
 * - `index.js`: the GUI main process, the Session Host and every CLI command. One file, as with
 *   Vite before (A-F6): modules reached through `import()` stay behind Bun's lazy `__esm`
 *   initializers, so each process evaluates only its own part.
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
  type SourceAlias,
  sourceAliases,
} from './build-main-plugins'
import { MAIN_CHUNK_MANIFEST_PATH } from './main-bundle-graph'
import { type BunBuildConfig, bunBuild } from './support/bun-build'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_DIRECTORY = path.join(ROOT, 'out/main')
const MAIN_ENTRY = 'src/main/index.ts'
const BOOT_ENTRY = 'src/main/boot.ts'
const JSON_INDENT = 0
const BUN_PRAGMA = '// @bun'

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

/** Pi's workers, resolved from `import.meta.url` beside the bundle Pi runs in. */
const PI_CODING_AGENT_DIST = 'node_modules/@earendil-works/pi-coding-agent/dist'
const PI_WORKERS: readonly {
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every package the bundle leaves to `node_modules`. */
export function mainExternalPackages(manifest: unknown) {
  const dependencies =
    isRecord(manifest) && isRecord(manifest['dependencies'])
      ? Object.keys(manifest['dependencies'])
      : []
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

export async function buildMain() {
  const manifest: unknown = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const externals = mainExternalPackages(manifest)
  const shared = {
    outdir: OUT_DIRECTORY,
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
      sourceAliases(ROOT, SOURCE_ALIASES, ELECTROBUN_SDK_ENTRIES),
      lazyExternals(externals),
    ],
  } as const
  await rm(OUT_DIRECTORY, { recursive: true, force: true })
  await mkdir(OUT_DIRECTORY, { recursive: true })
  const main = await build({
    ...shared,
    entrypoints: [path.join(ROOT, MAIN_ENTRY)],
    naming: 'index.js',
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
    // The boot shim imports `./index.js` at run time; it must not bundle it.
    external: ['./index.js'],
  })
  for (const worker of PI_WORKERS) {
    await build({
      outdir: OUT_DIRECTORY,
      target: 'bun',
      format: worker.format,
      entrypoints: [path.join(ROOT, worker.entry)],
      naming: worker.fileName,
      external: worker.external,
    })
  }
  const outputs = main.metafile?.outputs ?? {}
  const file = path.join(OUT_DIRECTORY, MAIN_CHUNK_MANIFEST_PATH)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(chunkManifest(outputs), null, JSON_INDENT)}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildMain().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
