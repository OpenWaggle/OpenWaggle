/** Finds the packaged apps the native platform-floor guard inspects. */
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

type FloorTargetPlatform = 'darwin' | 'linux' | 'win32'

export interface FloorTarget {
  readonly root: string
  readonly platform: FloorTargetPlatform
  /** An Electrobun native-layer devkit (vendor/electrobun/build.ts), not a packaged app. */
  readonly devkit: boolean
}

const PLATFORMS: readonly FloorTargetPlatform[] = ['darwin', 'linux', 'win32']
const PLATFORM_FLAG = '--platform'
const DEVKIT_FLAG = '--devkit'
/** scripts/electrobun/app-config.ts: Hutch's build folder and the macOS app package.ts ships. */
const ELECTROBUN_BUILD_DIR = path.join('out', 'electrobun', 'build')
const ELECTROBUN_INNER_APP_DIR = path.join('out', 'electrobun', 'inner')
const ELECTROBUN_OS: Readonly<Record<FloorTargetPlatform, string>> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'win',
}
const APPIMAGE_SUFFIX = '.AppImage'
const APPIMAGE_EXTRACT_TIMEOUT_MS = 300_000
const EXECUTABLE_MODE = 0o755
const EXEC_MAX_BUFFER_BYTES = 64 * 1024 * 1024

function isFloorPlatform(value: string | undefined): value is FloorTargetPlatform {
  return PLATFORMS.some((platform) => platform === value)
}

export function parseFloorArguments(
  args: readonly string[],
  hostPlatform: string = process.platform,
) {
  const paths: string[] = []
  let platform: string | undefined = hostPlatform
  let devkit = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === DEVKIT_FLAG) {
      devkit = true
      continue
    }
    if (argument === PLATFORM_FLAG) {
      index += 1
      platform = args[index]
      continue
    }
    if (argument !== undefined) paths.push(argument)
  }
  if (!isFloorPlatform(platform)) {
    throw new Error(
      `Usage: check-native-platform-floor.ts [${PLATFORM_FLAG} darwin|linux|win32] [${DEVKIT_FLAG}] [app paths...]`,
    )
  }
  if (devkit && paths.length === 0) throw new Error(`${DEVKIT_FLAG} needs the devkit directory.`)
  return { platform, paths, devkit }
}

async function directoryEntries(directory: string) {
  return fs.readdir(directory, { withFileTypes: true }).catch(() => [])
}

/**
 * The packaged outputs of an Electrobun build (scripts/electrobun/package.ts), one per build
 * target directory: on macOS the signed unwrapped app that the DMG, the transition zip and the
 * update archive carry; on Windows and Linux Hutch's wrapper, whose `.tar.zst` payload the guard
 * unpacks.
 */
export async function discoverElectrobunApps(platform: FloorTargetPlatform, outDirectory = '.') {
  const root = path.join(
    outDirectory,
    platform === 'darwin' ? ELECTROBUN_INNER_APP_DIR : ELECTROBUN_BUILD_DIR,
  )
  const found: string[] = []
  for (const target of await directoryEntries(root)) {
    if (!target.isDirectory() || !target.name.startsWith(`stable-${ELECTROBUN_OS[platform]}-`)) {
      continue
    }
    for (const child of await directoryEntries(path.join(root, target.name))) {
      if (child.isDirectory()) found.push(path.join(root, target.name, child.name))
    }
  }
  if (found.length === 0) {
    throw new Error(`No packaged ${platform} Electrobun app found under ${root}.`)
  }
  return found.sort((left, right) => left.localeCompare(right))
}

/**
 * Unpacks an AppImage (the Linux transition AppImage, scripts/electrobun-transition/) with its own runtime, so the guard reads the exact bytes users download.
 * That runtime only runs on Linux x64; elsewhere, extract it first (`unsquashfs -o <offset>`).
 */
async function extractAppImage(appImagePath: string) {
  if (process.platform !== 'linux') {
    throw new Error(
      `Extract ${appImagePath} first and pass the extracted directory; its runtime needs Linux.`,
    )
  }
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-appimage-'))
  await fs.chmod(appImagePath, EXECUTABLE_MODE)
  await execFile(path.resolve(appImagePath), ['--appimage-extract'], {
    cwd: workDirectory,
    timeout: APPIMAGE_EXTRACT_TIMEOUT_MS,
    maxBuffer: EXEC_MAX_BUFFER_BYTES,
  })
  return path.join(workDirectory, 'squashfs-root')
}

export async function resolveFloorTargets(args: readonly string[]) {
  const { platform, paths, devkit } = parseFloorArguments(args)
  const appPaths = paths.length > 0 ? paths : await discoverElectrobunApps(platform)
  const targets: FloorTarget[] = []
  for (const appPath of appPaths) {
    const root = appPath.endsWith(APPIMAGE_SUFFIX)
      ? await extractAppImage(appPath)
      : path.resolve(appPath)
    targets.push({ root, platform, devkit })
  }
  return targets
}
