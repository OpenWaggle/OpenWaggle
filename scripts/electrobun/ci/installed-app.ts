/**
 * The packaged app as a user installs it, for scripts/electrobun/ci/smoke.ts: install a release's
 * fresh-install artifact, find the installed launcher, the bundled `bun` and the app directory the
 * CLI runs, and stop every process started from the install (CEF helpers and the Session Host
 * included). Throwaway CI machines only: it writes to `/Applications` and the user's local app data.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scriptEnv } from '../../support/env'

const ELECTROBUN_INSTALL = ['com.openwaggle.app', 'stable', 'app', 'bin']
const EXECUTABLE_MODE = 0o755
const EXEC_BUFFER_BYTES = 64 * 1024 * 1024
/** Time for an app the installer started to show up, so it can be stopped. */
const INSTALLER_LAUNCH_MS = 15_000
const STDERR_FD = 2
/** The installers' output goes to stderr: stdout carries the smoke command's JSON result. */
const INSTALLER_STDIO: ['ignore', number, number] = ['ignore', STDERR_FD, STDERR_FD]

export interface InstalledApp {
  readonly launcher: string
  /** The bundle (`OpenWaggle.app`) or install directory (`.../stable/app`). */
  readonly installRoot: string
  /** The bundled Bun, which runs the app directory as the `openwaggle` CLI does. */
  readonly bun: string
  readonly appRoot: string
  /** Electrobun's `version.json`, which an update rewrites. */
  readonly versionFile: string
}

/** The installed files around a launcher: macOS `Contents/MacOS`, elsewhere `app/bin`. */
export function installedApp(launcher: string, platform: NodeJS.Platform = process.platform) {
  const bin = path.dirname(launcher)
  const resources = path.join(bin, '..', 'Resources')
  return {
    launcher,
    installRoot: path.resolve(bin, platform === 'darwin' ? '../..' : '..'),
    bun: path.join(bin, platform === 'win32' ? 'bun.exe' : 'bun'),
    appRoot: path.resolve(resources, 'app'),
    versionFile: path.resolve(resources, 'version.json'),
  } satisfies InstalledApp
}

export function installedVersion(app: InstalledApp) {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(app.versionFile, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? String(parsed.version)
      : null
  } catch {
    return null
  }
}

function single(directory: string, pattern: RegExp) {
  const [match, ...rest] = fs.readdirSync(directory).filter((name) => pattern.test(name))
  if (match === undefined || rest.length > 0) {
    throw new Error(`No single ${String(pattern)} in ${directory}`)
  }
  return path.join(directory, match)
}

function windowsProcessCommands() {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: EXEC_BUFFER_BYTES,
  })
  const rows: unknown[] = [JSON.parse(raw)].flat()
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const fields = new Map(Object.entries(row))
    const command = `${String(fields.get('ExecutablePath') ?? '')} ${String(fields.get('CommandLine') ?? '')}`
    return [{ pid: Number(fields.get('ProcessId')), command }]
  })
}

function posixProcessCommands() {
  const raw = execFileSync('ps', ['-A', '-o', 'pid=,args='], {
    encoding: 'utf8',
    maxBuffer: EXEC_BUFFER_BYTES,
  })
  return raw.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line)
    const [, pid, command] = match ?? []
    return pid === undefined ? [] : [{ pid: Number(pid), command: command ?? '' }]
  })
}

/** The directory Electrobun's updater manages for the app (its `appDataFolderFor`). */
export function electrobunChannelRoot(platform: NodeJS.Platform = process.platform) {
  const data =
    platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : platform === 'win32'
        ? (scriptEnv().LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
        : (scriptEnv().XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'))
  return path.join(data, 'com.openwaggle.app', 'stable')
}

/** Every process whose command line contains one of `needles`, for a failure report. */
export function processesNaming(needles: readonly string[]) {
  const rows = process.platform === 'win32' ? windowsProcessCommands() : posixProcessCommands()
  return rows.filter((row) => needles.some((needle) => row.command.includes(needle)))
}

/** The processes whose executable or command line names a path inside `directory`. */
export function processesUnder(directory: string) {
  const rows = process.platform === 'win32' ? windowsProcessCommands() : posixProcessCommands()
  const needle = path.resolve(directory).toLowerCase()
  return rows.filter((row) => row.pid !== process.pid && row.command.toLowerCase().includes(needle))
}

/** Kills every process started from the install: the app, its CEF helpers and its Host. */
export function stopProcessesUnder(directory: string) {
  const stopped = processesUnder(directory)
  for (const row of stopped) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(row.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        process.kill(row.pid, 'SIGKILL')
      }
    } catch {
      // Already gone.
    }
  }
  return stopped.length
}

/**
 * Starts nothing visible: an installer that opens the app when it finishes gets the automation
 * variable and a throwaway userData, and the app is stopped once it shows up.
 */
function installerEnvironment() {
  return {
    ...process.env,
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_USER_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-installer-')),
  }
}

function installMacos(release: string) {
  const dmg = single(release, /\.dmg$/u)
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-dmg-'))
  execFileSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount])
  try {
    const app = single(mount, /\.app$/u)
    const installed = path.join('/Applications', path.basename(app))
    fs.rmSync(installed, { recursive: true, force: true })
    execFileSync('ditto', [app, installed])
    execFileSync('codesign', ['--verify', '--deep', '--strict', installed])
    return path.join(installed, 'Contents', 'MacOS', 'launcher')
  } finally {
    execFileSync('hdiutil', ['detach', mount, '-force'])
  }
}

function installWindows(release: string) {
  const installer = single(release, /^openwaggle-.+-x64\.exe$/u)
  execFileSync(installer, ['/S'], { stdio: INSTALLER_STDIO, env: installerEnvironment() })
  const local = scriptEnv().LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  return path.join(local, ...ELECTROBUN_INSTALL, 'launcher.exe')
}

function installLinux(release: string) {
  const appImage = single(release, /\.AppImage$/u)
  fs.chmodSync(appImage, EXECUTABLE_MODE)
  // The hosted runners have no FUSE; the AppImage runtime then extracts itself and runs AppRun,
  // which runs Electrobun's installer.
  execFileSync(appImage, [], {
    stdio: INSTALLER_STDIO,
    env: { ...installerEnvironment(), APPIMAGE_EXTRACT_AND_RUN: '1' },
  })
  const data = scriptEnv().XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  return path.join(data, ...ELECTROBUN_INSTALL, 'launcher')
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Installs the release's fresh-install artifact and stops an app the installer started. */
export async function install(release: string) {
  const launcher =
    process.platform === 'darwin'
      ? installMacos(release)
      : process.platform === 'win32'
        ? installWindows(release)
        : installLinux(release)
  if (!fs.existsSync(launcher)) throw new Error(`The install created no launcher at ${launcher}`)
  const app = installedApp(launcher)
  if (process.platform !== 'darwin') await delay(INSTALLER_LAUNCH_MS)
  return { app, stoppedAfterInstall: stopProcessesUnder(app.installRoot) }
}
