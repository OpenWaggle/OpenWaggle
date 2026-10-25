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
}

const PLATFORMS: readonly FloorTargetPlatform[] = ['darwin', 'linux', 'win32']
const PLATFORM_FLAG = '--platform'
const DIST_DIR = 'dist'
const APPIMAGE_SUFFIX = '.AppImage'
const APPIMAGE_EXTRACT_TIMEOUT_MS = 300_000
const EXECUTABLE_MODE = 0o755
const EXEC_MAX_BUFFER_BYTES = 64 * 1024 * 1024

function isFloorPlatform(value: string | undefined): value is FloorTargetPlatform {
  return PLATFORMS.some((platform) => platform === value)
}

export function parseFloorArguments(args: readonly string[], hostPlatform: string = process.platform) {
  const paths: string[] = []
  let platform: string | undefined = hostPlatform
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === PLATFORM_FLAG) {
      index += 1
      platform = args[index]
      continue
    }
    if (argument !== undefined) paths.push(argument)
  }
  if (!isFloorPlatform(platform)) {
    throw new Error(`Usage: check-native-platform-floor.ts [${PLATFORM_FLAG} darwin|linux|win32] [app paths...]`)
  }
  return { platform, paths }
}

async function directoryEntries(directory: string) {
  return fs.readdir(directory, { withFileTypes: true }).catch(() => [])
}

/** The packaged outputs electron-builder leaves in `dist` for one platform. */
export async function discoverPackagedApps(platform: FloorTargetPlatform, distDirectory: string = DIST_DIR) {
  const entries = await directoryEntries(distDirectory)
  const found: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(distDirectory, entry.name)
    if (platform === 'linux' && entry.isFile() && entry.name.endsWith(APPIMAGE_SUFFIX)) found.push(entryPath)
    if (platform === 'win32' && entry.isDirectory() && entry.name === 'win-unpacked') found.push(entryPath)
    if (platform === 'darwin' && entry.isDirectory()) {
      for (const child of await directoryEntries(entryPath)) {
        if (child.isDirectory() && child.name.endsWith('.app')) found.push(path.join(entryPath, child.name))
      }
    }
  }
  if (found.length === 0) throw new Error(`No packaged ${platform} app found under ${distDirectory}.`)
  return found.sort((left, right) => left.localeCompare(right))
}

/**
 * Unpacks an AppImage with its own runtime, so the guard reads the exact bytes users download.
 * That runtime only runs on Linux x64; elsewhere, extract it first (`unsquashfs -o <offset>`).
 */
async function extractAppImage(appImagePath: string) {
  if (process.platform !== 'linux') {
    throw new Error(`Extract ${appImagePath} first and pass the extracted directory; its runtime needs Linux.`)
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

export async function resolveFloorTargets(args: readonly string[]): Promise<readonly FloorTarget[]> {
  const { platform, paths } = parseFloorArguments(args)
  const appPaths = paths.length > 0 ? paths : await discoverPackagedApps(platform)
  const targets: FloorTarget[] = []
  for (const appPath of appPaths) {
    const root = appPath.endsWith(APPIMAGE_SUFFIX) ? await extractAppImage(appPath) : path.resolve(appPath)
    targets.push({ root, platform })
  }
  return targets
}
