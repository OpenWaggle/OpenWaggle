/**
 * The production `node_modules` the Electrobun app ships (scripts/electrobun/stage.ts). The main
 * build bundles every dependency it can (scripts/build-main.ts `BUNDLED_DEPENDENCIES`), so the
 * app needs only the externals that build leaves to `node_modules` (`mainExternalPackages`): native modules (better-sqlite3, sharp, onnxruntime-node through
 * transformers.js, the keyring), WASM readers and packages that locate files beside themselves, and
 * everything they depend on at run time.
 *
 * Bun installs with the isolated linker (bunfig.toml), where `node_modules/<name>` is a symlink into
 * `node_modules/.bun/`. The app gets a plain, symlink-free tree instead: each package is placed as
 * high as Node's resolution allows, then every placed package's dependencies are resolved through
 * the new tree and checked against what they resolved to in the checkout, so a hoisting conflict
 * fails the build instead of loading the wrong version at run time.
 *
 * It leaves out what the runtime never reads: declarations, maps, docs and tests, native builds for
 * other platforms and architectures, onnxruntime's CUDA providers and the browser-only builds.
 */
import fs from 'node:fs'
import path from 'node:path'
import { mainExternalPackages } from '../build-main'

/**
 * Bundled packages that main also loads from `node_modules` by path: the attachment parser worker
 * resolves them when its module loads (src/main/utils/attachment-parser-worker.ts), so a package
 * without them fails to boot.
 */
export const RUNTIME_RESOLVED_PACKAGES = ['jszip', 'mammoth', 'unpdf'] as const

/** Files of bundled packages they read from their package directory at run time: Pi's docs. */
const BUNDLED_PACKAGE_ASSETS: Readonly<Record<string, readonly string[]>> = {
  '@earendil-works/pi-coding-agent': ['package.json', 'README.md', 'docs', 'examples'],
}

/** Packages nothing in the app loads: transformers.js's Node build runs on onnxruntime-node. */
const EXCLUDED_PACKAGES = new Set(['onnxruntime-web'])
const NODE_PLATFORMS = ['darwin', 'linux', 'win32'] as const
const NODE_ARCHES = ['arm64', 'x64', 'ia32'] as const
const EXCLUDED_DIRECTORIES = new Set([
  '.github',
  'docs',
  'test',
  'tests',
  '__tests__',
  'examples',
  '@types',
])
const EXCLUDED_FILE =
  /(?:\.d\.ts|\.d\.mts|\.map)$|^(?:README|CHANGELOG|LICENSE)|^\.(?:eslintrc|prettierrc)|^tsconfig\.json$/iu

export interface StageTarget {
  readonly platform: NodeJS.Platform
  readonly arch: string
}

interface PackageJson {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
}

interface PlacedPackage {
  readonly name: string
  readonly realDir: string
  /** Directory relative to the shipped `node_modules`' parent, POSIX separators. */
  readonly placement: string
  /** Only the files a bundled package reads at run time, without its dependencies. */
  readonly assetsOnly: boolean
}

function readPackageJson(directory: string): PackageJson {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${directory}: bad package.json`)
  }
  return parsed
}

/** A per-platform package (`@img/sharp-darwin-arm64`, `@napi-rs/keyring-linux-x64-gnu`) for another target. */
export function isForeignPlatformPackage(name: string, target: StageTarget) {
  const base = name.split('/').at(-1) ?? name
  for (const platform of NODE_PLATFORMS) {
    for (const arch of NODE_ARCHES) {
      const marker = `-${platform}-${arch}`
      const at = base.indexOf(marker)
      if (at === -1) continue
      const rest = base.slice(at + marker.length)
      if (rest !== '' && !rest.startsWith('-')) continue
      return platform !== target.platform || arch !== target.arch
    }
  }
  return false
}

/** onnxruntime-node keeps `bin/napi-v<n>/<platform>/<arch>/…`: the target's binaries only. */
const ONNX_ARCH_DEPTH = 4
const ONNX_GPU_PROVIDER = /libonnxruntime_providers_(?:cuda|tensorrt)\.so$/u

type FileRule = (segments: readonly string[], file: string, target: StageTarget) => boolean

/** Per-package pruning of files the target never loads. */
const PACKAGE_FILE_RULES: Readonly<Record<string, FileRule>> = {
  'onnxruntime-node': (segments, file, target) => {
    if (segments[0] !== 'bin') return true
    const [, , platform, arch] = segments
    if (platform !== undefined && platform !== target.platform) return false
    const foreignArch = arch !== undefined && arch !== target.arch
    if (foreignArch && segments.length > ONNX_ARCH_DEPTH) return false
    return !ONNX_GPU_PROVIDER.test(file)
  },
  'better-sqlite3': (segments, file, target) => {
    if (segments[0] === 'deps' || segments[0] === 'src') return false
    if (segments[0] !== 'prebuilds' || segments.length <= 1) return true
    return file === `${target.platform}-${target.arch}.node`
  },
  'tesseract.js-core': (_segments, file) => !file.endsWith('.wasm.js'),
}

/** Whether a file of a package ships, by its path inside the package (POSIX separators). */
export function shipsPackageFile(name: string, relative: string, target: StageTarget) {
  const segments = relative.split('/')
  const file = segments.at(-1) ?? ''
  if (segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false
  if (EXCLUDED_FILE.test(file)) return false
  const rule = PACKAGE_FILE_RULES[name]
  return rule === undefined || rule(segments, file, target)
}

/** Where Node resolves `name` from a package in the checkout (walking up, as Node does). */
function resolveFrom(fromDir: string, name: string) {
  let current = fromDir
  while (true) {
    if (path.basename(current) !== 'node_modules') {
      const candidate = path.join(current, 'node_modules', name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function runtimeDependencies(manifest: PackageJson) {
  return [
    ...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, optional: false })),
    ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => ({ name, optional: true })),
  ]
}

/**
 * The packages main requires from `node_modules` at run time: the build's externals, without the
 * packages it only names as optional (`ws`'s speedups, never installed), and the bundled packages
 * it also resolves by path.
 */
export function externalRoots(rootManifest: PackageJson) {
  const dependencies = rootManifest.dependencies ?? {}
  const roots = new Set([...mainExternalPackages(rootManifest), ...RUNTIME_RESOLVED_PACKAGES])
  return [...roots].filter((name) => name in dependencies)
}

class NodeModulesLayout {
  readonly placed = new Map<string, PlacedPackage>()
  private readonly target: StageTarget

  constructor(target: StageTarget) {
    this.target = target
  }

  /** The placement Node would resolve `name` to from `placement`, nearest first. */
  lookup(placement: string, name: string) {
    let current = placement
    while (true) {
      const found = this.placed.get(path.posix.join(current, 'node_modules', name))
      if (found !== undefined) return found
      if (current === '.') return null
      const parent = path.posix.dirname(path.posix.dirname(current))
      current = parent === '' ? '.' : parent
    }
  }

  add(name: string, realDir: string, parentPlacement: string, assetsOnly = false) {
    if (EXCLUDED_PACKAGES.has(name) || isForeignPlatformPackage(name, this.target)) return
    const nearest = this.lookup(parentPlacement, name)
    if (nearest?.realDir === realDir) return
    const placement =
      nearest === null
        ? path.posix.join('node_modules', name)
        : path.posix.join(parentPlacement, 'node_modules', name)
    this.placed.set(placement, { name, realDir, placement, assetsOnly })
    if (assetsOnly) return
    for (const dependency of runtimeDependencies(readPackageJson(realDir))) {
      const resolved = resolveFrom(realDir, dependency.name)
      if (resolved === null) {
        if (dependency.optional) continue
        throw new Error(`${name} (${realDir}) needs ${dependency.name}, which is not installed.`)
      }
      this.add(dependency.name, resolved, placement)
    }
  }

  /** Every placed package's dependencies resolve, through the new tree, to what they resolved to. */
  verify() {
    const problems: string[] = []
    for (const entry of this.placed.values()) {
      if (entry.assetsOnly) continue
      for (const dependency of runtimeDependencies(readPackageJson(entry.realDir))) {
        const expected = resolveFrom(entry.realDir, dependency.name)
        const shipped =
          !EXCLUDED_PACKAGES.has(dependency.name) &&
          !isForeignPlatformPackage(dependency.name, this.target)
        if (expected === null || !shipped) continue
        const actual = this.lookup(entry.placement, dependency.name)
        if (actual?.realDir !== expected) {
          problems.push(`${entry.placement} -> ${dependency.name}: ${actual?.realDir ?? 'missing'}`)
        }
      }
    }
    return problems
  }
}

function copyPackage(entry: PlacedPackage, destinationRoot: string, target: StageTarget) {
  const destination = path.join(destinationRoot, entry.placement)
  const allowList = entry.assetsOnly ? BUNDLED_PACKAGE_ASSETS[entry.name] : undefined
  const visit = (relative: string) => {
    const source = path.join(entry.realDir, relative)
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue
      const childRelative = relative === '' ? item.name : `${relative}/${item.name}`
      if (relative === '' && allowList !== undefined && !allowList.includes(item.name)) continue
      if (item.isDirectory()) {
        if (allowList === undefined && EXCLUDED_DIRECTORIES.has(item.name)) continue
        visit(childRelative)
        continue
      }
      const keep = allowList !== undefined || shipsPackageFile(entry.name, childRelative, target)
      if (!keep) continue
      const to = path.join(destination, childRelative)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(fs.realpathSync(path.join(source, item.name)), to)
      fs.chmodSync(to, fs.statSync(path.join(source, item.name)).mode)
    }
  }
  visit('')
}

/**
 * Writes `<destination>/node_modules` for `target` from the checkout at `repositoryRoot` and
 * returns the placed packages.
 */
export function stageNodeModules(repositoryRoot: string, destination: string, target: StageTarget) {
  const layout = new NodeModulesLayout(target)
  const rootManifest = readPackageJson(repositoryRoot)
  const roots = [
    ...externalRoots(rootManifest).map((name) => ({ name, assetsOnly: false })),
    ...Object.keys(BUNDLED_PACKAGE_ASSETS).map((name) => ({ name, assetsOnly: true })),
  ]
  for (const root of roots) {
    const resolved = resolveFrom(repositoryRoot, root.name)
    if (resolved === null) throw new Error(`${root.name} is not installed; run bun install first.`)
    layout.add(root.name, resolved, '.', root.assetsOnly)
  }
  const problems = layout.verify()
  if (problems.length > 0) {
    throw new Error(
      `The shipped node_modules would resolve the wrong packages:\n${problems.join('\n')}`,
    )
  }
  fs.rmSync(path.join(destination, 'node_modules'), { recursive: true, force: true })
  const placed = [...layout.placed.values()]
  for (const entry of placed) copyPackage(entry, destination, target)
  return placed
}
