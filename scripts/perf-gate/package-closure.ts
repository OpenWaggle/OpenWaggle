/**
 * The installed files the packaged app ships from `node_modules`, measured the same way on every
 * host: the runtime package closure (scripts/packaged-runtime-packages.ts) as electron-builder packs
 * it for linux-x64, with the generic exclusions of electron-builder.ts, the files the app never loads
 * (`PACKAGE_UNLOADED_FILES`) and the assets bundled packages read (`BUNDLED_PACKAGE_ASSETS`).
 *
 * What differs by host is left out so macOS, Linux and Windows count the same: packages that
 * declare `os` or `cpu` (a host installs only its own), and native build output (`build/` of a
 * package with a `binding.gyp`, rebuilt per Electron ABI). Prebuilds for every platform stay out
 * except linux-x64, as the Linux pack keeps them. The `electron` package is not shipped at all.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  BUNDLED_PACKAGE_ASSETS,
  PACKAGE_UNLOADED_FILES,
  readManifest,
  RUNTIME_RESOLVED_PACKAGES,
  resolvePackageDirectory,
  runtimeDependencyNames,
  UNLOADED_PACKAGES,
} from '../packaged-runtime-packages'
import { mainExternalPackages } from '../vite/main-externals'

export interface PackageClosureSize {
  readonly packages: number
  readonly files: number
  readonly bytes: number
}

/** electron-builder.ts `files`: names excluded at any depth of `node_modules`. */
const EXCLUDED_NAMES = [
  /^@types$/u,
  /\.d\.m?ts$/u,
  /\.map$/u,
  /^README/u,
  /^CHANGELOG/u,
  /^LICENSE/u,
  /^\.github$/u,
  /^docs$/u,
  /^tests?$/u,
  /^__tests__$/u,
  /^examples$/u,
  /^\.eslintrc/u,
  /^\.prettierrc/u,
  /^tsconfig\.json$/u,
]
const LINUX_TARGET = 'linux-x64'
/** electron-builder packs Electron itself, never the `electron` package and its download. */
const ELECTRON = 'electron'

/** Package-relative paths the Linux pack leaves out (electron-builder-native-prebuilds.ts). */
const PACK_EXCLUSIONS: readonly RegExp[] = [
  /^better-sqlite3\/(?:deps|src)(?:\/|$)/u,
  /^tesseract\.js-core\/tesseract-core-simd-lstm\.(?:js|wasm)$/u,
  new RegExp(`^better-sqlite3/prebuilds/(?!${LINUX_TARGET}\\.node$)`, 'u'),
  new RegExp(`^node-pty/prebuilds/(?!${LINUX_TARGET}(?:/|$))`, 'u'),
  /^node-pty\/third_party\/conpty(?:\/|$)/u,
  /^onnxruntime-node\/bin\/napi-v6\/(?!linux(?:\/|$))/u,
  /^onnxruntime-node\/bin\/napi-v6\/linux\/(?!x64(?:\/|$))/u,
  /^onnxruntime-node\/bin\/napi-v6\/linux\/x64\/libonnxruntime_providers_(?:cuda|tensorrt)\.so$/u,
]

function globExpression(glob: string) {
  const source = glob
    .replaceAll('.', String.raw`\.`)
    .replace(/\{([^}]*)\}/gu, (_match, body: string) => `(?:${body.split(',').join('|')})`)
    .replace(/!\(([^)]*)\)/gu, (_match, body: string) => `(?!(?:${body})$)[^/]*`)
    .replaceAll('*', '[^/]*')
  return new RegExp(`^${source}(?:/|$)`, 'u')
}

const UNLOADED = new Map(
  Object.entries(PACKAGE_UNLOADED_FILES).map(([name, globs]) => [name, globs.map(globExpression)]),
)

function readJson(file: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  return typeof parsed === 'object' && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {}
}

function hostBound(directory: string) {
  const manifest = readJson(path.join(directory, 'package.json'))
  return manifest['os'] !== undefined || manifest['cpu'] !== undefined
}

function walk(root: string, relative: string, keep: (entry: string) => boolean): string[] {
  const directory = path.join(root, relative)
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((dirent) => {
    const entry = relative === '' ? dirent.name : `${relative}/${dirent.name}`
    if (EXCLUDED_NAMES.some((pattern) => pattern.test(dirent.name)) || !keep(entry)) return []
    if (dirent.name === 'node_modules') return []
    if (dirent.isDirectory()) return walk(root, entry, keep)
    return dirent.isFile() ? [entry] : []
  })
}

function shippedFiles(name: string, directory: string) {
  const unloaded = UNLOADED.get(name) ?? []
  const native = fs.existsSync(path.join(directory, 'binding.gyp'))
  return walk(directory, '', (entry) => {
    if (native && (entry === 'build' || entry.startsWith('build/'))) return false
    if (unloaded.some((pattern) => pattern.test(entry))) return false
    return !PACK_EXCLUSIONS.some((pattern) => pattern.test(`${name}/${entry}`))
  })
}

function assetFiles(name: string, directory: string) {
  return (BUNDLED_PACKAGE_ASSETS[name] ?? []).flatMap((asset) => {
    const target = path.join(directory, asset)
    if (!fs.existsSync(target)) return []
    if (fs.statSync(target).isFile()) return [asset]
    return walk(target, '', () => true).map((entry) => `${asset}/${entry}`)
  })
}

function sizeOf(directory: string, files: readonly string[]) {
  return files.reduce((total, file) => total + fs.statSync(path.join(directory, file)).size, 0)
}

/**
 * The runtime closure as installed directories (packagedRuntimePackages names the same packages):
 * the isolated linker keeps each package's dependencies beside it, so each is resolved from its
 * dependent's directory, and one name can be two directories.
 */
function runtimeDirectories(projectRoot: string) {
  const directories = new Map<string, string>()
  const roots = [...mainExternalPackages(), ...RUNTIME_RESOLVED_PACKAGES].filter(
    (name) => name !== ELECTRON,
  )
  const pending = roots.map((name) => ({
    name,
    from: projectRoot,
  }))
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (UNLOADED_PACKAGES.has(next.name)) continue
    const directory = resolvePackageDirectory(next.name, next.from)
    if (directory === undefined || directories.has(directory)) continue
    directories.set(directory, next.name)
    for (const dependency of runtimeDependencyNames(readManifest(directory))) {
      pending.push({ name: dependency, from: directory })
    }
  }
  return [...directories].sort(([left], [right]) => left.localeCompare(right))
}

/** The files and bytes the packaged app ships from `node_modules`, the same on every host. */
export function measurePackageClosure(projectRoot = process.cwd()): PackageClosureSize {
  let packages = 0
  let files = 0
  let bytes = 0
  for (const [directory, name] of runtimeDirectories(projectRoot)) {
    if (hostBound(directory)) continue
    const list = shippedFiles(name, directory)
    packages += 1
    files += list.length
    bytes += sizeOf(directory, list)
  }
  for (const name of Object.keys(BUNDLED_PACKAGE_ASSETS)) {
    const directory = resolvePackageDirectory(name, projectRoot)
    if (directory === undefined) continue
    const list = assetFiles(name, directory)
    files += list.length
    bytes += sizeOf(directory, list)
  }
  return { packages, files, bytes }
}
