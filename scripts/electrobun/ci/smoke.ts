/**
 * Proves a packaged Electrobun build on a CI runner (.github/workflows/electrobun-package.yml):
 * installs it the way a user does, launches it, and runs OpenWaggle's update engine against a
 * newer build on a local feed. Throwaway machines only: it writes to `/Applications`, the user's
 * local app data and the default userData directory.
 *
 *   bun scripts/electrobun/ci/smoke.ts install <release dir>
 *     macOS: the DMG's app into /Applications; Windows: the NSIS installer, silently; Linux: the
 *     AppImage, whose AppRun runs Electrobun's installer. Prints the installed launcher.
 *   bun scripts/electrobun/ci/smoke.ts launch <launcher> --expect <version> --out <json>
 *     [--feed <url>] [--timeout <s>] [--screenshot <png>]
 *     Starts the launcher and waits until the stand-in main's report (scripts/electrobun/stand-in)
 *     shows `<version>` with its window loaded. Records spawn-to-window time and, after the app
 *     idled, the resident memory of its process tree. With --feed the app updates itself to the
 *     build on that feed and relaunches; `--expect` is then the newer version.
 *   bun scripts/electrobun/ci/smoke.ts serve <directory> <port>
 *     Serves a release directory over loopback HTTP, which Electrobun's updater allows.
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { isRecord } from '../../../src/shared/utils/validation'
import { appRss, directoryBytes, killTree, screenshot } from '../../electrobun-probe-host'

const FIRST_CLI_ARGUMENT = 2
const POLL_MS = 500
const IDLE_MS = 10_000
const DEFAULT_TIMEOUT_S = 240
const MS_PER_SECOND = 1000
const JSON_INDENT = 2
const ELECTROBUN_INSTALL = ['com.openwaggle.app', 'stable', 'app', 'bin']
const REPORT_NAME = 'electrobun-stand-in-report.json'
const EXECUTABLE_MODE = 0o755
const HTTP_OK = 200
const HTTP_NOT_FOUND = 404
const LAUNCH_OPTIONS_OFFSET = 2

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function single(directory: string, pattern: RegExp) {
  const [match, ...rest] = fs.readdirSync(directory).filter((name) => pattern.test(name))
  if (match === undefined || rest.length > 0) {
    throw new Error(`No single ${String(pattern)} in ${directory}`)
  }
  return path.join(directory, match)
}

/** Electron's userData directory, which the stand-in reports into (stand-in/boot.ts). */
function userDataDirectory() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'openwaggle')
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'openwaggle',
    )
  }
  return path.join(
    process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config'),
    'openwaggle',
  )
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
  // The installer starts the app when it finishes; the stand-in quits on its own.
  execFileSync(installer, ['/S'], {
    stdio: 'inherit',
    env: { ...process.env, OPENWAGGLE_STAND_IN_EXIT_AFTER_MS: '5000' },
  })
  const local = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local')
  return path.join(local, ...ELECTROBUN_INSTALL, 'launcher.exe')
}

function installLinux(release: string) {
  const appImage = single(release, /\.AppImage$/u)
  fs.chmodSync(appImage, EXECUTABLE_MODE)
  // The hosted runners have no FUSE; the AppImage runtime then extracts itself and runs AppRun.
  execFileSync(appImage, [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      OPENWAGGLE_STAND_IN_EXIT_AFTER_MS: '5000',
    },
  })
  const data = process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share')
  return path.join(data, ...ELECTROBUN_INSTALL, 'launcher')
}

function install(release: string) {
  const launcher =
    process.platform === 'darwin'
      ? installMacos(release)
      : process.platform === 'win32'
        ? installWindows(release)
        : installLinux(release)
  if (!fs.existsSync(launcher)) throw new Error(`The install created no launcher at ${launcher}`)
  return launcher
}

function readReport(file: string) {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function reportedVersion(report: Readonly<Record<string, unknown>>) {
  const info = report['versionJson']
  return isRecord(info) && typeof info['version'] === 'string' ? info['version'] : null
}

interface LaunchOptions {
  readonly launcher: string
  readonly expect: string
  readonly feed: string | null
  readonly timeoutMs: number
  readonly screenshotFile: string | null
}

async function launch(options: LaunchOptions) {
  const reportFile = path.join(userDataDirectory(), REPORT_NAME)
  fs.rmSync(reportFile, { force: true })
  const spawnedAt = Date.now()
  const child = spawn(options.launcher, [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(options.feed === null ? {} : { OPENWAGGLE_STAND_IN_UPDATE_FEED: options.feed }),
    },
  })
  const deadline = spawnedAt + options.timeoutMs
  while (Date.now() < deadline) {
    const report = readReport(reportFile)
    const domReady = report?.['windowDomReadyMs']
    if (
      report !== null &&
      reportedVersion(report) === options.expect &&
      typeof domReady === 'number'
    ) {
      const startedAt = Date.parse(String(report['startedAt']))
      await delay(IDLE_MS)
      const pid = typeof report['pid'] === 'number' ? report['pid'] : (child.pid ?? 0)
      const idleRssBytes = appRss(pid)
      if (options.screenshotFile !== null) screenshot(options.screenshotFile)
      killTree(pid)
      if (child.pid !== undefined) killTree(child.pid)
      return {
        version: options.expect,
        updated: options.feed !== null,
        spawnToWindowMs: startedAt + domReady - spawnedAt,
        processToWindowMs: domReady,
        idleRssBytes,
        report,
      }
    }
    await delay(POLL_MS)
  }
  if (child.pid !== undefined) killTree(child.pid)
  const update = `${reportFile}.update.jsonl`
  const log = fs.existsSync(update) ? fs.readFileSync(update, 'utf8') : 'no update log'
  throw new Error(`No report of ${options.expect} within ${options.timeoutMs} ms:\n${log}`)
}

function serve(directory: string, port: number) {
  http
    .createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      const file = path.join(directory, path.normalize(name))
      if (!file.startsWith(directory) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(HTTP_NOT_FOUND).end()
        return
      }
      response.writeHead(HTTP_OK, { 'content-length': fs.statSync(file).size })
      fs.createReadStream(file).pipe(response)
    })
    .listen(port, '127.0.0.1')
}

async function main(argv: readonly string[]) {
  const [command, first, second] = argv
  if (command === 'install' && first !== undefined) {
    const launcher = install(path.resolve(first))
    const installed = path.resolve(launcher, process.platform === 'darwin' ? '../../..' : '../..')
    console.log(JSON.stringify({ launcher, installedBytes: directoryBytes(installed) }))
    return
  }
  if (command === 'serve' && first !== undefined && second !== undefined) {
    serve(path.resolve(first), Number(second))
    return
  }
  if (command !== 'launch' || first === undefined) throw new Error('Usage: see the file header.')
  const { values } = parseArgs({
    args: argv.slice(LAUNCH_OPTIONS_OFFSET),
    options: {
      expect: { type: 'string' },
      out: { type: 'string' },
      feed: { type: 'string' },
      timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_S) },
      screenshot: { type: 'string' },
    },
  })
  if (values.expect === undefined || values.out === undefined) {
    throw new Error('launch needs --expect and --out')
  }
  const result = await launch({
    launcher: first,
    expect: values.expect,
    feed: values.feed ?? null,
    timeoutMs: Number(values.timeout) * MS_PER_SECOND,
    screenshotFile: values.screenshot ?? null,
  })
  fs.writeFileSync(values.out, `${JSON.stringify(result, null, JSON_INDENT)}\n`)
  console.log(JSON.stringify({ ...result, report: undefined }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(FIRST_CLI_ARGUMENT)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
