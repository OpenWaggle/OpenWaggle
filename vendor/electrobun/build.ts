/**
 * Builds OpenWaggle's Electrobun native layer: the pinned upstream release (sources.ts) plus
 * patches/*.patch, compiled for the supported-platform floor (scripts/supported-platform-floor.ts).
 * The output directory holds a devkit that `HUTCH_ELECTROBUN_DEVKIT_ROOT` points app builds at, the
 * release tarballs Electrobun's own pipeline would publish, and a manifest of what went in.
 *
 *   bun vendor/electrobun/build.ts [--out <dir>] [--work <dir>] [--arch arm64|x64]
 *   bun vendor/electrobun/build.ts --linux-container   # Linux: build inside Ubuntu 22.04
 *
 * Per OS:
 * - macOS: every binary targets macOS 13.4; the launcher and self-extractor target 12.0, the launch
 *   version, so an older Mac opens the app and is told it needs 13.4.
 * - Linux: run on Ubuntu 22.04 (glibc 2.35, GCC 12's libstdc++); `--linux-container` does that in
 *   Docker from any Linux host. Zig binaries target x86_64-linux-gnu.2.35 explicitly.
 * - Windows: the upstream build unchanged, plus the WebView2 Evergreen bootstrapper, whose
 *   Microsoft signature is checked.
 *
 * Needs git, curl, tar, xz, Node (npm), and Hutch HUTCH_VERSION on PATH (Bun instead on Linux);
 * Xcode on macOS, MSVC on Windows. Re-runs reuse the checkout, toolchains and dependency builds under --work.
 */
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { SUPPORTED_PLATFORM_FLOOR } from '../../scripts/supported-platform-floor'
import {
  DAWN_SOURCE,
  ELECTROBUN_SOURCE,
  HUTCH_VERSION,
  OWNED_DEPENDENCY_SOURCES,
  type OwnedDependency,
  type PinnedSource,
  WEBVIEW2_BOOTSTRAPPER,
  ZIG,
} from './sources'

type Architecture = 'arm64' | 'x64'
type HostPlatform = 'darwin' | 'linux' | 'win32'
type ElectrobunOs = 'macos' | 'linux' | 'win'

const VENDOR_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.resolve(VENDOR_DIRECTORY, '..', '..')
const PATCHES_DIRECTORY = path.join(VENDOR_DIRECTORY, 'patches')
const VERSION_FILE = path.join(VENDOR_DIRECTORY, 'VERSION')
const LINUX_CONTAINER_DIRECTORY = path.join(VENDOR_DIRECTORY, 'linux')
const LINUX_CONTAINER_IMAGE = 'openwaggle-electrobun-native:22.04'
const PATCH_AUTHOR = [
  '-c',
  'user.name=OpenWaggle native layer',
  '-c',
  'user.email=native@openwaggle.invalid',
]
const MAX_BUFFER_BYTES = 256 * 1024 * 1024
const HUTCH_INSTALLER_URL = 'https://hutch.blackboard.sh/hutch/install.sh'
const ELECTROBUN_OS: Readonly<Record<HostPlatform, ElectrobunOs>> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'win',
}

function fail(message: string): never {
  throw new Error(message)
}

function run(command: string, args: readonly string[], options: ExecFileSyncOptions = {}) {
  console.log(
    `$ ${[command, ...args].join(' ')}${options.cwd ? `   (in ${String(options.cwd)})` : ''}`,
  )
  execFileSync(command, args, { stdio: 'inherit', maxBuffer: MAX_BUFFER_BYTES, ...options })
}

function capture(command: string, args: readonly string[], options: ExecFileSyncOptions = {}) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES, ...options })
    .toString()
    .trim()
}

function hostPlatform(): HostPlatform {
  const platform = process.platform
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform
  return fail(`Unsupported build host ${platform}`)
}

function architecture(requested: string | undefined): Architecture {
  const value = requested ?? process.arch
  if (value === 'arm64' || value === 'x64') return value
  return fail(`Unsupported architecture ${value}`)
}

/** The environment that moves every Electrobun binary to OpenWaggle's floor (patch 0001). */
export function floorEnvironment(platform: HostPlatform): Record<string, string> {
  const floor = SUPPORTED_PLATFORM_FLOOR
  if (platform === 'darwin') {
    return {
      ELECTROBUN_MACOS_DEPLOYMENT_TARGET: floor.macos.supportedVersion,
      ELECTROBUN_MACOS_LAUNCHER_DEPLOYMENT_TARGET: floor.macos.launchVersion,
      ELECTROBUN_MACOS_REQUIRED_VERSION: floor.macos.supportedVersion,
      MACOSX_DEPLOYMENT_TARGET: floor.macos.supportedVersion,
    }
  }
  if (platform === 'linux') {
    const { glibc, glibcxx, cxxabi } = floor.linux
    return {
      ELECTROBUN_LINUX_GLIBC_VERSION: glibc,
      ELECTROBUN_LINUX_ABI_BASELINE: `GLIBC=${glibc},GLIBCXX=${glibcxx},CXXABI=${cxxabi}`,
    }
  }
  return {}
}

/** Zig target for Electrobun's own Zig dependencies, matching patch 0001's targets. */
export function dependencyZigTarget(platform: HostPlatform, arch: Architecture) {
  const cpu = arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (platform === 'darwin')
    return `${cpu}-macos.${SUPPORTED_PLATFORM_FLOOR.macos.supportedVersion}`
  if (platform === 'linux') return `${cpu}-linux-gnu.${SUPPORTED_PLATFORM_FLOOR.linux.glibc}`
  return fail('Windows keeps the upstream prebuilt dependencies.')
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function download(url: string, destination: string) {
  run('curl', [
    '-fL',
    '--retry',
    '5',
    '--retry-all-errors',
    '--connect-timeout',
    '30',
    '-o',
    destination,
    url,
  ])
}

function currentCommit(directory: string) {
  try {
    return capture('git', ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], {
      cwd: directory,
      stdio: 'pipe',
    })
  } catch {
    return null
  }
}

/** Shallow-fetches exactly the pinned commit, so a moved tag can never change what is built. */
function checkout(source: PinnedSource, directory: string, submodules = false) {
  if (!fs.existsSync(path.join(directory, '.git'))) {
    fs.mkdirSync(directory, { recursive: true })
    run('git', ['init', '-q'], { cwd: directory })
    // Upstream's bytes as committed: Windows' autocrlf would otherwise make the patches miss.
    run('git', ['config', 'core.autocrlf', 'false'], { cwd: directory })
    run('git', ['remote', 'add', 'origin', source.repository], { cwd: directory })
  }
  if (currentCommit(directory) !== source.commit) {
    run('git', ['fetch', '-q', '--depth', '1', 'origin', source.commit], { cwd: directory })
    run('git', ['checkout', '-q', '--detach', 'FETCH_HEAD'], { cwd: directory })
  }
  const actual = capture('git', ['rev-parse', 'HEAD'], { cwd: directory })
  if (actual !== source.commit)
    fail(`${source.repository} resolved to ${actual}, not ${source.commit}`)
  if (submodules)
    run('git', ['submodule', 'update', '--init', '--recursive', '--depth', '1'], { cwd: directory })
}

/** `<upstream version>-openwaggle.<n>`; bump `n` whenever the patches or build inputs change. */
function nativeLayerVersion() {
  const version = fs.readFileSync(VERSION_FILE, 'utf8').trim()
  if (!version.startsWith(`${ELECTROBUN_SOURCE.tag.slice(1)}-openwaggle.`)) {
    fail(`VERSION ${version} does not name Electrobun ${ELECTROBUN_SOURCE.tag}`)
  }
  return version
}

function patchFiles() {
  return fs
    .readdirSync(PATCHES_DIRECTORY)
    .filter((name) => name.endsWith('.patch'))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => path.join(PATCHES_DIRECTORY, name))
}

/** Resets the checkout to the pinned commit and applies every patch as a commit. */
function applyPatches(directory: string) {
  run('git', ['reset', '-q', '--hard', ELECTROBUN_SOURCE.commit], { cwd: directory })
  run('git', ['clean', '-q', '-fdx', '-e', 'package/vendors/', '-e', 'package/node_modules/'], {
    cwd: directory,
  })
  const patches = patchFiles()
  if (patches.length > 0)
    run('git', [...PATCH_AUTHOR, 'am', '-q', '--keep-cr', ...patches], { cwd: directory })
  return patches.map((file) => ({ file: path.basename(file), sha256: sha256File(file) }))
}

function zigArchive(platform: HostPlatform, arch: Architecture) {
  const key = `${platform}-${arch}`
  if (key === 'darwin-arm64') return ZIG.archives['darwin-arm64']
  if (key === 'darwin-x64') return ZIG.archives['darwin-x64']
  if (key === 'linux-x64') return ZIG.archives['linux-x64']
  return fail(`No pinned Zig archive for ${key}`)
}

/** Installs the pinned Zig where Electrobun's build looks for it (package/vendors/zig). */
function vendorZig(
  packageDirectory: string,
  platform: HostPlatform,
  arch: Architecture,
  work: string,
) {
  const zigDirectory = path.join(packageDirectory, 'vendors', 'zig')
  const zig = path.join(zigDirectory, 'zig')
  if (fs.existsSync(zig) && capture(zig, ['version']) === ZIG.version) return zig
  const archive = zigArchive(platform, arch)
  const tarball = path.join(work, path.basename(archive.url))
  if (!fs.existsSync(tarball) || sha256File(tarball) !== archive.sha256)
    download(archive.url, tarball)
  if (sha256File(tarball) !== archive.sha256) fail(`${tarball} does not match its pinned sha256`)
  fs.rmSync(zigDirectory, { recursive: true, force: true })
  fs.mkdirSync(zigDirectory, { recursive: true })
  run('tar', ['-xJf', tarball, '--strip-components=1', '-C', zigDirectory])
  fs.writeFileSync(path.join(zigDirectory, '.zig-version'), ZIG.version)
  return zig
}

interface DependencyBuild {
  readonly outputs: readonly { readonly from: string; readonly to: string }[]
}

function dependencyOutputs(dependency: OwnedDependency, platform: HostPlatform): DependencyBuild {
  const library = platform === 'darwin' ? 'libasar.dylib' : 'libasar.so'
  if (dependency === 'zig-bsdiff') {
    return {
      outputs: [
        { from: 'zig-out/bin/bsdiff', to: 'bsdiff' },
        { from: 'zig-out/bin/bspatch', to: 'bspatch' },
      ],
    }
  }
  if (dependency === 'zig-zstd')
    return { outputs: [{ from: 'zig-out/bin/zig-zstd', to: 'zig-zstd' }] }
  return {
    outputs: [
      { from: 'zig-out/bin/zig-asar', to: 'zig-asar' },
      { from: `zig-out/lib/${library}`, to: library },
    ],
  }
}

/** Electrobun's vendor step skips a download when `.version` names this key (build.ts vendor*()). */
function dependencyBuildKey(
  dependency: OwnedDependency,
  platform: HostPlatform,
  arch: Architecture,
) {
  return `${OWNED_DEPENDENCY_SOURCES[dependency].tag.replace(/^v/u, '')}-${ELECTROBUN_OS[platform]}-${arch}`
}

/**
 * Rebuilds zig-bsdiff, zig-zstd and zig-asar from source for the floor and stages them in
 * package/vendors/<name> with the `.version` key Electrobun checks, so it uses them as they are.
 */
function buildOwnedDependencies(
  packageDirectory: string,
  zig: string,
  platform: HostPlatform,
  arch: Architecture,
  work: string,
) {
  const target = dependencyZigTarget(platform, arch)
  const zigDirectory = path.dirname(zig)
  for (const dependency of Object.keys(OWNED_DEPENDENCY_SOURCES).filter(isOwnedDependency)) {
    const source = OWNED_DEPENDENCY_SOURCES[dependency]
    const sourceDirectory = path.join(work, dependency)
    const vendorDirectory = path.join(packageDirectory, 'vendors', dependency)
    const key = dependencyBuildKey(dependency, platform, arch)
    const stamp = path.join(vendorDirectory, '.version')
    const stampContent = `${key}`
    const builtFor = path.join(vendorDirectory, '.openwaggle-target')
    if (
      fs.existsSync(stamp) &&
      fs.readFileSync(stamp, 'utf8').trim() === stampContent &&
      fs.existsSync(builtFor) &&
      fs.readFileSync(builtFor, 'utf8').trim() === `${source.commit} ${target}`
    ) {
      continue
    }
    checkout(source, sourceDirectory, dependency !== 'zig-asar')
    const sourceZig = path.join(sourceDirectory, 'vendors', 'zig')
    fs.rmSync(sourceZig, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(sourceZig), { recursive: true })
    fs.symlinkSync(zigDirectory, sourceZig, 'dir')
    const environment = { ...process.env, ZIG_TARGET: target }
    if (dependency === 'zig-bsdiff') {
      run('node', ['scripts/setup.js', `--target=${target}`], {
        cwd: sourceDirectory,
        env: environment,
      })
    }
    run(zig, ['build', '-Doptimize=ReleaseFast', '-Dcpu=baseline', `-Dtarget=${target}`], {
      cwd: sourceDirectory,
      env: environment,
    })
    if (dependency === 'zig-asar' && platform === 'darwin')
      relinkAsarWithAppleLinker(sourceDirectory, arch)
    fs.rmSync(vendorDirectory, { recursive: true, force: true })
    fs.mkdirSync(vendorDirectory, { recursive: true })
    for (const output of dependencyOutputs(dependency, platform).outputs) {
      fs.copyFileSync(
        path.join(sourceDirectory, output.from),
        path.join(vendorDirectory, output.to),
      )
      fs.chmodSync(path.join(vendorDirectory, output.to), 0o755)
    }
    fs.writeFileSync(stamp, stampContent)
    fs.writeFileSync(builtFor, `${source.commit} ${target}`)
  }
}

/** electrobun-dawn's scripts/build-dawn.js configuration, apart from the macOS deployment target. */
const DAWN_CMAKE_OPTIONS = [
  '-G',
  'Ninja',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DDAWN_FETCH_DEPENDENCIES=ON',
  '-DDAWN_ENABLE_INSTALL=ON',
  '-DDAWN_BUILD_MONOLITHIC_LIBRARY=SHARED',
  '-DBUILD_SHARED_LIBS=OFF',
  '-DDAWN_BUILD_SAMPLES=OFF',
  '-DDAWN_BUILD_TESTS=OFF',
  '-DDAWN_BUILD_PROTOBUF=OFF',
  '-DTINT_BUILD_CMD_TOOLS=OFF',
  '-DTINT_BUILD_TESTS=OFF',
  '-DTINT_BUILD_IR_BINARY=OFF',
] as const
/** build-dawn.js creates these before configuring; DAWN_FETCH_DEPENDENCIES fills them. */
const DAWN_DEPENDENCY_DIRECTORIES = [
  'third_party/abseil-cpp',
  'third_party/dxc',
  'third_party/dxheaders',
  'third_party/glfw',
  'third_party/jinja2',
  'third_party/khronos/EGL-Registry',
  'third_party/khronos/OpenGL-Registry',
  'third_party/libprotobuf-mutator/src',
  'third_party/protobuf',
  'third_party/markupsafe',
  'third_party/glslang/src',
  'third_party/google_benchmark/src',
  'third_party/googletest',
  'third_party/spirv-headers/src',
  'third_party/spirv-tools/src',
  'third_party/vulkan-headers/src',
  'third_party/vulkan-loader/src',
  'third_party/vulkan-utility-libraries/src',
  'third_party/webgpu-headers/src',
] as const

function dawnTarget(platform: HostPlatform, arch: Architecture) {
  const floor = SUPPORTED_PLATFORM_FLOOR
  return platform === 'darwin'
    ? `macos-${arch}-${floor.macos.supportedVersion}`
    : `linux-${arch}-glibc-${floor.linux.glibc}`
}

/**
 * Rebuilds electrobun-dawn for the floor and installs it where Electrobun's vendorWGPU() looks,
 * with the `.wgpu-version` it checks, so the devkit keeps upstream's layout and manifest.
 */
function buildDawn(
  packageDirectory: string,
  platform: HostPlatform,
  arch: Architecture,
  work: string,
) {
  const vendorDirectory = path.join(
    packageDirectory,
    'vendors',
    'wgpu',
    `${ELECTROBUN_OS[platform]}-${arch}`,
  )
  const version = DAWN_SOURCE.tag.replace(/^v/u, '')
  const stamp = path.join(vendorDirectory, '.wgpu-version')
  const builtFor = path.join(vendorDirectory, '.openwaggle-target')
  const expected = `${DAWN_SOURCE.commit} ${dawnTarget(platform, arch)}`
  const current = (file: string) =>
    fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null
  if (current(stamp) === version && current(builtFor) === expected) return

  const sourceDirectory = path.join(work, 'electrobun-dawn')
  checkout(DAWN_SOURCE, sourceDirectory)
  const dawn = path.join(sourceDirectory, 'dawn')
  run('git', ['submodule', 'update', '--init', '--depth', '1', 'dawn'], { cwd: sourceDirectory })
  const dawnCommit = capture('git', ['rev-parse', 'HEAD'], { cwd: dawn })
  if (dawnCommit !== DAWN_SOURCE.dawn)
    fail(`Dawn resolved to ${dawnCommit}, not ${DAWN_SOURCE.dawn}`)
  for (const directory of DAWN_DEPENDENCY_DIRECTORIES) {
    fs.mkdirSync(path.join(dawn, directory), { recursive: true })
  }
  const buildDirectory = path.join(work, 'dawn-build')
  const macos =
    platform === 'darwin'
      ? [
          `-DCMAKE_OSX_DEPLOYMENT_TARGET=${SUPPORTED_PLATFORM_FLOOR.macos.supportedVersion}`,
          `-DCMAKE_OSX_ARCHITECTURES=${arch === 'arm64' ? 'arm64' : 'x86_64'}`,
        ]
      : []
  run('cmake', ['-S', dawn, '-B', buildDirectory, ...DAWN_CMAKE_OPTIONS, ...macos])
  run('cmake', ['--build', buildDirectory, '--config', 'Release'])
  fs.rmSync(vendorDirectory, { recursive: true, force: true })
  run('cmake', ['--install', buildDirectory, '--config', 'Release', '--prefix', vendorDirectory])
  fs.writeFileSync(stamp, version)
  fs.writeFileSync(builtFor, expected)
}

function isOwnedDependency(value: string): value is OwnedDependency {
  return value in OWNED_DEPENDENCY_SOURCES
}

/** As zig-asar's own release does: Zig's Mach-O linker exports ___dso_handle, which Apple ld rejects. */
function relinkAsarWithAppleLinker(sourceDirectory: string, arch: Architecture) {
  run(
    'xcrun',
    [
      'clang',
      '-dynamiclib',
      '-arch',
      arch === 'arm64' ? 'arm64' : 'x86_64',
      `-mmacosx-version-min=${SUPPORTED_PLATFORM_FLOOR.macos.supportedVersion}`,
      '-o',
      'zig-out/lib/libasar.dylib',
      '-Wl,-force_load,zig-out/lib/libasar-static.a',
      '-exported_symbols_list',
      'scripts/asar-exported-symbols.txt',
      '-Wl,-headerpad,0x1000',
      '-install_name',
      '@rpath/libasar.dylib',
    ],
    { cwd: sourceDirectory },
  )
}

function hutchVersion() {
  try {
    return capture('hutch', ['--version'], { stdio: 'pipe' }).replace(/^hutch\s+/u, '')
  } catch {
    return null
  }
}

/**
 * Uses the Hutch on PATH when it is HUTCH_VERSION; otherwise installs that exact version under
 * --work with Hutch's own installer (which checks the archive's sha256) and puts it first on PATH.
 */
function ensureHutch(work: string, platform: HostPlatform) {
  if (hutchVersion() === HUTCH_VERSION) return
  if (platform === 'win32')
    fail(`Install Hutch ${HUTCH_VERSION} first (install.ps1 -Version ${HUTCH_VERSION}).`)
  const hutchHome = path.join(work, 'hutch-home')
  const installer = path.join(work, 'install-hutch.sh')
  download(HUTCH_INSTALLER_URL, installer)
  run('sh', [installer, '--version', HUTCH_VERSION, '--no-modify-path'], {
    env: { ...process.env, HUTCH_HOME: hutchHome },
  })
  process.env['HUTCH_HOME'] = hutchHome
  process.env['PATH'] =
    `${path.join(hutchHome, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`
  const installed = hutchVersion()
  if (installed !== HUTCH_VERSION)
    fail(`Installed Hutch reports ${installed}, not ${HUTCH_VERSION}`)
}

/**
 * How upstream's build scripts run. They are Bun-compatible TypeScript that Electrobun runs with
 * Hutch. On Linux Hutch's cottontail runtime needs glibc 2.38, which the Ubuntu 22.04 build host
 * lacks, so Linux runs them with Bun (package-release.js honours HUTCH_BINARY) and installs with
 * npm, which is what `hutch run install` (`hutch pm ci`, packageManager npm) does.
 * On Windows, Bun's shell finds `tar` on PATH, and the GNU tar of Git for Windows reads `C:\...`
 * as a remote host, so Windows' own bsdtar goes first.
 */
const HUTCH_INSTALL = { command: 'hutch', args: ['run', 'install'] } as const

function buildRuntime(platform: HostPlatform, environment: NodeJS.ProcessEnv) {
  if (platform === 'linux') {
    return {
      install: { command: 'npm', args: ['ci'] },
      env: { ...environment, HUTCH_BINARY: 'bun' },
    }
  }
  if (platform === 'win32') {
    const system32 = path.join(environment['SystemRoot'] ?? 'C:\\Windows', 'System32')
    const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
    const searchPath = `${system32}${path.delimiter}${environment[pathKey] ?? ''}`
    return { install: HUTCH_INSTALL, env: { ...environment, [pathKey]: searchPath } }
  }
  return { install: HUTCH_INSTALL, env: environment }
}

/** Linux must compile against Ubuntu 22.04's glibc and libstdc++; refuse any other host. */
function requireLinuxFloorHost() {
  const glibc = capture('getconf', ['GNU_LIBC_VERSION']).replace(/^glibc\s+/u, '')
  if (glibc !== SUPPORTED_PLATFORM_FLOOR.linux.glibc) {
    fail(
      `Linux builds must run on glibc ${SUPPORTED_PLATFORM_FLOOR.linux.glibc} (Ubuntu 22.04), not ${glibc}. Use --linux-container.`,
    )
  }
}

function fetchWebview2Bootstrapper(outDirectory: string) {
  const directory = path.join(outDirectory, 'webview2')
  fs.mkdirSync(directory, { recursive: true })
  const installer = path.join(directory, WEBVIEW2_BOOTSTRAPPER.fileName)
  download(WEBVIEW2_BOOTSTRAPPER.url, installer)
  const script = `$s = Get-AuthenticodeSignature -LiteralPath '${installer.replaceAll("'", "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`
  const [status, subject] = capture('powershell', ['-NoProfile', '-Command', script]).split('|')
  if (status !== 'Valid' || !subject?.includes(WEBVIEW2_BOOTSTRAPPER.signer)) {
    fail(`${installer} is not validly signed by Microsoft (${status}, ${subject})`)
  }
  return {
    file: path.relative(outDirectory, installer),
    sha256: sha256File(installer),
    signer: subject,
  }
}

function copyOutputs(
  packageDirectory: string,
  outDirectory: string,
  platform: HostPlatform,
  arch: Architecture,
) {
  const devkit = path.join(outDirectory, 'devkit')
  fs.rmSync(devkit, { recursive: true, force: true })
  fs.cpSync(path.join(packageDirectory, 'dist'), devkit, {
    recursive: true,
    verbatimSymlinks: true,
  })
  const suffix = `${platform === 'win32' ? 'win' : platform}-${arch}`
  const tarballs = [`electrobun-core-${suffix}.tar.gz`, `electrobun-cef-${suffix}.tar.gz`].filter(
    (name) => fs.existsSync(path.join(packageDirectory, name)),
  )
  for (const name of tarballs)
    fs.copyFileSync(path.join(packageDirectory, name), path.join(outDirectory, name))
  return tarballs.map((name) => ({ file: name, sha256: sha256File(path.join(outDirectory, name)) }))
}

function buildInLinuxContainer(argv: readonly string[]) {
  run('docker', ['build', '-t', LINUX_CONTAINER_IMAGE, LINUX_CONTAINER_DIRECTORY])
  const passthrough = argv.filter((argument) => argument !== '--linux-container')
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  const gid = typeof process.getgid === 'function' ? process.getgid() : 0
  run('docker', [
    'run',
    '--rm',
    '--user',
    `${uid}:${gid}`,
    '-v',
    `${REPOSITORY_ROOT}:${REPOSITORY_ROOT}`,
    '-w',
    REPOSITORY_ROOT,
    '-e',
    'GITHUB_ACTIONS',
    '-e',
    'CI',
    LINUX_CONTAINER_IMAGE,
    'bun',
    'vendor/electrobun/build.ts',
    ...passthrough,
  ])
}

function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      work: { type: 'string' },
      arch: { type: 'string' },
      'linux-container': { type: 'boolean', default: false },
    },
  })
  const platform = hostPlatform()
  const arch = architecture(values.arch)
  console.log(`OpenWaggle Electrobun native layer ${nativeLayerVersion()}`)
  const out = path.resolve(
    values.out ?? path.join(REPOSITORY_ROOT, 'out', 'electrobun-native', `${platform}-${arch}`),
  )
  const work = path.resolve(
    values.work ??
      path.join(REPOSITORY_ROOT, 'out', 'electrobun-native', 'work', `${platform}-${arch}`),
  )
  if (values['linux-container']) {
    if (platform !== 'linux') fail('--linux-container runs on a Linux host (Docker).')
    if (!out.startsWith(REPOSITORY_ROOT) || !work.startsWith(REPOSITORY_ROOT)) {
      fail(
        '--linux-container needs --out and --work inside the repository, which is the only mount.',
      )
    }
    buildInLinuxContainer(process.argv.slice(2))
    return
  }
  if (platform === 'linux') requireLinuxFloorHost()
  if (platform !== 'win32' && arch !== process.arch) fail(`Build ${arch} on a native ${arch} host.`)
  fs.mkdirSync(work, { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  if (platform !== 'linux') ensureHutch(work, platform)

  const checkoutDirectory = path.join(work, 'electrobun')
  checkout(ELECTROBUN_SOURCE, checkoutDirectory)
  const patches = applyPatches(checkoutDirectory)
  const packageDirectory = path.join(checkoutDirectory, 'package')
  if (platform !== 'win32') {
    const zig = vendorZig(packageDirectory, platform, arch, work)
    buildOwnedDependencies(packageDirectory, zig, platform, arch, work)
    buildDawn(packageDirectory, platform, arch, work)
  }
  const environment = {
    ...process.env,
    ...floorEnvironment(platform),
    ELECTROBUN_BUILD_ARCH: arch,
    ELECTROBUN_TELEMETRY: '0',
  }
  const runtime = buildRuntime(platform, environment)
  run(runtime.install.command, runtime.install.args, { cwd: packageDirectory, env: runtime.env })
  run('node', ['scripts/package-release.js'], { cwd: packageDirectory, env: runtime.env })

  const tarballs = copyOutputs(packageDirectory, out, platform, arch)
  const webview2 = platform === 'win32' ? fetchWebview2Bootstrapper(out) : null
  const manifest = {
    version: nativeLayerVersion(),
    electrobun: ELECTROBUN_SOURCE,
    dependencies:
      platform === 'win32'
        ? 'upstream prebuilt'
        : { ...OWNED_DEPENDENCY_SOURCES, dawn: DAWN_SOURCE },
    zig: ZIG.version,
    hutch: HUTCH_VERSION,
    platform,
    arch,
    floor: floorEnvironment(platform),
    patches,
    tarballs,
    webview2,
    builtOn: `${os.type()} ${os.release()}`,
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Electrobun native layer for ${platform}-${arch}: ${out}`)
}

main()
