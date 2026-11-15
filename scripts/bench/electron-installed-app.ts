/**
 * The packaged Electron app as a user installs and starts it, for scripts/bench/electron-bench.ts:
 * install the fresh-install artifact electron-builder left in `dist/`, start the installed app
 * hidden (OPENWAGGLE_AUTOMATION=1) on a scratch profile with its DevTools endpoint open, run its CLI
 * against the same profile, and stop everything the install started. Throwaway machines only: the
 * Windows installer writes the user PATH.
 */
import { type ChildProcessByStdio, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { buildSafeElectronEnvironment } from '../safe-electron-environment'
import { listProcesses, selectAppProcesses } from './app-processes'

export interface InstalledElectronApp {
  readonly launcher: string
  /** What precedes the app's own arguments: the app directory of an unpackaged build. */
  readonly leadingArguments?: readonly string[]
  /** The `.app` bundle, the Windows install directory or the AppImage. */
  readonly installRoot: string
  readonly installedBytes: number
  /** What a user downloads: the fresh-install artifact, and the update archive where it differs. */
  readonly downloads: Readonly<Record<string, number>>
}

function isSizeRecord(value: unknown): value is Readonly<Record<string, number>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((size) => typeof size === 'number')
  )
}

/** What `electron-bench.ts install` wrote, read back by `measure`. */
export function isInstalledElectronApp(value: unknown): value is InstalledElectronApp {
  if (typeof value !== 'object' || value === null) return false
  const fields = new Map<string, unknown>(Object.entries(value))
  return (
    typeof fields.get('launcher') === 'string' &&
    typeof fields.get('installRoot') === 'string' &&
    typeof fields.get('installedBytes') === 'number' &&
    isSizeRecord(fields.get('downloads'))
  )
}

export interface ScratchProfile {
  readonly root: string
  readonly userData: string
  readonly home: string
  readonly piAgentDir: string
}

type AppProcess = ChildProcessByStdio<null, Readable, Readable>

export interface StartedApp {
  readonly child: AppProcess
  readonly spawnedAt: number
  readonly cdpPort: number
  readonly logLines: string[]
}

const INSTALLER_STDIO: ['ignore', 'inherit', 'inherit'] = ['ignore', 'inherit', 'inherit']
const EXECUTABLE_MODE = 0o755
const STOP_GRACE_MS = 5_000
const POLL_MS = 100
const CLI_OUTPUT_TAIL = 8_000
const LOCALHOST = '127.0.0.1'
const EPHEMERAL_PORT = 0

export function directoryBytes(target: string): number {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) return 0
  if (!stat.isDirectory()) return stat.size
  return fs
    .readdirSync(target)
    .reduce((total, entry) => total + directoryBytes(path.join(target, entry)), 0)
}

function single(directory: string, pattern: RegExp) {
  const matches = fs.readdirSync(directory).filter((name) => pattern.test(name))
  const [match] = matches
  if (match === undefined || matches.length > 1) {
    throw new Error(`Expected one ${String(pattern)} in ${directory}, found ${matches.join(', ')}`)
  }
  return path.join(directory, match)
}

function sizes(files: readonly string[]) {
  return Object.fromEntries(files.map((file) => [path.basename(file), fs.statSync(file).size]))
}

function installMac(dist: string, installDir: string) {
  const dmg = single(dist, /-arm64\.dmg$|-x64\.dmg$/u)
  const zip = path.join(dist, `${path.basename(dmg, '.dmg')}.zip`)
  const mountPoint = path.join(installDir, 'dmg')
  fs.mkdirSync(mountPoint, { recursive: true })
  execFileSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mountPoint], {
    stdio: INSTALLER_STDIO,
  })
  try {
    const bundle = single(mountPoint, /\.app$/u)
    const target = path.join(installDir, path.basename(bundle))
    execFileSync('ditto', [bundle, target], { stdio: INSTALLER_STDIO })
    const launcher = path.join(target, 'Contents', 'MacOS', 'OpenWaggle')
    return {
      launcher,
      installRoot: target,
      installedBytes: directoryBytes(target),
      downloads: sizes([dmg, zip]),
    }
  } finally {
    execFileSync('hdiutil', ['detach', mountPoint, '-force'], { stdio: INSTALLER_STDIO })
  }
}

function installWindows(dist: string, installDir: string) {
  const installer = single(dist, /^openwaggle-.+-x64\.exe$/u)
  const target = path.join(installDir, 'OpenWaggle')
  execFileSync(installer, ['/S', `/D=${target}`], { stdio: INSTALLER_STDIO })
  const launcher = path.join(target, 'OpenWaggle.exe')
  if (!fs.existsSync(launcher)) throw new Error(`The installer left no ${launcher}`)
  return {
    launcher,
    installRoot: target,
    installedBytes: directoryBytes(target),
    downloads: sizes([installer]),
  }
}

function installLinux(dist: string, installDir: string) {
  const appImage = single(dist, /\.AppImage$/u)
  const target = path.join(installDir, 'openwaggle.AppImage')
  fs.copyFileSync(appImage, target)
  fs.chmodSync(target, EXECUTABLE_MODE)
  return {
    launcher: target,
    installRoot: target,
    installedBytes: fs.statSync(target).size,
    downloads: sizes([appImage]),
  }
}

/** Installs the artifact electron-builder left in `dist` into `installDir`. */
export function installElectronApp(dist: string, installDir: string) {
  fs.mkdirSync(installDir, { recursive: true })
  if (process.platform === 'darwin') return installMac(dist, installDir)
  if (process.platform === 'win32') return installWindows(dist, installDir)
  return installLinux(dist, installDir)
}

export function createScratchProfile(root: string) {
  const home = path.join(root, 'home')
  const piAgentDir = path.join(home, '.pi', 'agent')
  fs.mkdirSync(piAgentDir, { recursive: true })
  return { root, userData: path.join(root, 'user-data'), home, piAgentDir }
}

/**
 * The app's environment: hidden automation, a scratch HOME, userData and compile cache. The
 * single-instance lock stays on, as for a user: Chromium keys it by userData, so it is per profile,
 * and a second launch with a Session link hands the link to the running window.
 */
export function appEnvironment(profile: ScratchProfile) {
  return buildSafeElectronEnvironment({
    HOME: profile.home,
    USERPROFILE: profile.home,
    PI_CODING_AGENT_DIR: profile.piAgentDir,
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_USER_DATA_DIR: profile.userData,
    OPENWAGGLE_COMPILE_CACHE_DIR: path.join(profile.root, 'compile-cache'),
  })
}

/** Keeps the app, and the Host it forwards the switches to, off the runner's credential store. */
export function credentialStoreArguments(platform: NodeJS.Platform = process.platform) {
  return ['--use-mock-keychain', ...(platform === 'linux' ? ['--password-store=basic'] : [])]
}

export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(EPHEMERAL_PORT, LOCALHOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : EPHEMERAL_PORT
      server.close(() => resolve(port))
    })
  })
}

function forwardLines(stream: Readable, onLine: (line: string) => void) {
  createInterface({ input: stream, crlfDelay: Infinity }).on('line', onLine)
}

/** Starts the installed app hidden, in its own process group on macOS and Linux. */
export function startElectronApp(input: {
  readonly app: InstalledElectronApp
  readonly profile: ScratchProfile
  readonly cdpPort: number
  readonly appArguments?: readonly string[]
}) {
  const spawnedAt = Date.now()
  const child = spawn(
    input.app.launcher,
    [
      ...(input.app.leadingArguments ?? []),
      ...credentialStoreArguments(),
      `--remote-debugging-port=${String(input.cdpPort)}`,
      '--openwaggle-startup-timings',
      ...(input.appArguments ?? []),
    ],
    {
      env: appEnvironment(input.profile),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const logLines: string[] = []
  forwardLines(child.stdout, (line) => logLines.push(line))
  forwardLines(child.stderr, (line) => logLines.push(line))
  return { child, spawnedAt, cdpPort: input.cdpPort, logLines }
}

export interface CliResult {
  readonly status: number | null
  readonly output: string
  readonly ms: number
}

/**
 * The installed app's CLI on the same profile, as `openwaggle <args>` runs it (the Windows shim
 * passes `--` first). A Session link (`['--', link]`) is how Windows and Linux open one.
 */
export function runAppCli(
  app: InstalledElectronApp,
  profile: ScratchProfile,
  args: readonly string[],
  timeoutMs: number,
) {
  const started = Date.now()
  const prefix = process.platform === 'win32' || args[0] === '--' ? [] : credentialStoreArguments()
  const separator = process.platform === 'win32' && args[0] !== '--' ? ['--'] : []
  const leading = app.leadingArguments ?? []
  const child = spawn(app.launcher, [...leading, ...prefix, ...separator, ...args], {
    env: appEnvironment(profile),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-CLI_OUTPUT_TAIL)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const timer = setTimeout(() => child.kill(), timeoutMs)
  return new Promise<CliResult>((resolve) => {
    child.once('exit', (status) => {
      clearTimeout(timer)
      resolve({ status, output, ms: Date.now() - started })
    })
  })
}

function hasExited(child: AppProcess) {
  return child.exitCode !== null || child.signalCode !== null
}

function killPid(pid: number) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // Already gone.
  }
}

/** Quits the window process (SIGTERM, then a kill after a grace period). */
export async function stopElectronApp(app: StartedApp) {
  const pid = app.child.pid
  if (pid === undefined || hasExited(app.child)) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore' })
    } else {
      process.kill(-pid, 'SIGTERM')
    }
  } catch {
    // Already gone.
  }
  const deadline = Date.now() + STOP_GRACE_MS
  while (!hasExited(app.child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  if (!hasExited(app.child)) killPid(process.platform === 'win32' ? pid : -pid)
}

/** Kills every process still running from the install (the Host, helpers), and their children. */
export function stopProcessesUnder(installPaths: readonly string[]) {
  const rows = selectAppProcesses(listProcesses(), {
    rootPids: [],
    installPaths,
    excludePids: [process.pid],
  })
  for (const row of rows) killPid(row.pid)
  return rows.length
}
