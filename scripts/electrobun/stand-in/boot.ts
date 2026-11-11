/**
 * Stand-in main process for packaging the Electrobun app until the main bundle (`out/main`,
 * scripts/build-main.ts) boots under Electrobun, which it does once the desktop shell binds the
 * Electrobun adapters (`bun scripts/electrobun/package.ts --stand-in`). It opens one
 * window and writes a launch report, so CI can prove that a packaged, signed and installed app
 * starts, and measure when its window shows, on every OS:
 *
 * - `<userData>/electrobun-stand-in-report.json` (or OPENWAGGLE_STAND_IN_REPORT): version, paths,
 *   the installed `version.json`, argv, and when the window's page loaded. userData is Electron's
 *   canonical `openwaggle` directory, which the shell keeps (ADR 0064), so an install that came
 *   through the transition artifact shows the old data is still there.
 * - OPENWAGGLE_STAND_IN_HIDDEN=1 keeps the window hidden (local runs never show a window).
 * - OPENWAGGLE_STAND_IN_EXIT_AFTER_MS quits after that long.
 * - OPENWAGGLE_STAND_IN_UPDATE_FEED=<release download URL> runs OpenWaggle's Electrobun
 *   UpdateEngine against that release: check, download, then install and relaunch.
 *
 * Never shipped by a release: release.yml packages without `--stand-in`, which builds `out/main`.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadElectrobun } from '../../../src/main/adapters/electrobun/electrobun-sdk'
import { electrobunUpdateEngine } from '../../../src/main/adapters/electrobun/electrobun-update-engine'

const startedAt = Date.now()
const environment = process.env
const WINDOW_WIDTH = 960
const WINDOW_HEIGHT = 640
const WINDOW_OFFSET = 80

function canonicalUserData() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'openwaggle')
  }
  if (process.platform === 'win32') {
    return path.join(
      environment['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'openwaggle',
    )
  }
  return path.join(
    environment['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config'),
    'openwaggle',
  )
}

const REPORT_INDENT = 2
const userData = canonicalUserData()
const reportFile =
  environment['OPENWAGGLE_STAND_IN_REPORT'] ??
  path.join(userData, 'electrobun-stand-in-report.json')
const updateLog = `${reportFile}.update.jsonl`
const report: Record<string, unknown> = {
  startedAt: new Date(startedAt).toISOString(),
  pid: process.pid,
  execPath: process.execPath,
  argv: process.argv,
  platform: process.platform,
  arch: process.arch,
  bun: process.versions['bun'],
  userData,
  userDataEntries: existsSync(userData) ? readdirSync(userData).sort() : [],
}

function writeReport() {
  mkdirSync(path.dirname(reportFile), { recursive: true })
  writeFileSync(reportFile, `${JSON.stringify(report, null, REPORT_INDENT)}\n`)
}

function logUpdate(event: string, detail: unknown = null) {
  mkdirSync(path.dirname(updateLog), { recursive: true })
  appendFileSync(updateLog, `${JSON.stringify({ event, detail, atMs: Date.now() - startedAt })}\n`)
}

const page = `<!doctype html><html><head><meta charset="utf-8"><title>OpenWaggle</title></head>
<body style="margin:0;font:16px system-ui,sans-serif;background:#16181d;color:#f4f4f5">
<main style="padding:32px"><h1 style="margin:0 0 12px">OpenWaggle</h1>
<p id="info">Electrobun packaging stand-in</p></main></body></html>`

const { BrowserWindow, Updater } = await loadElectrobun()
const window = new BrowserWindow({
  title: 'OpenWaggle',
  html: page,
  hidden: environment['OPENWAGGLE_STAND_IN_HIDDEN'] === '1',
  frame: { x: WINDOW_OFFSET, y: WINDOW_OFFSET, width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
})

window.webview.on('dom-ready', () => {
  report['windowDomReadyMs'] = Date.now() - startedAt
  writeReport()
})

const localInfo = await Updater.getLocalInfo()
report['versionJson'] = localInfo
writeReport()

const exitAfter = Number(environment['OPENWAGGLE_STAND_IN_EXIT_AFTER_MS'] ?? '0')
if (exitAfter > 0) setTimeout(() => process.exit(0), exitAfter)

const feed = environment['OPENWAGGLE_STAND_IN_UPDATE_FEED']
if (feed !== undefined && feed !== '') {
  const engine = electrobunUpdateEngine
  engine.onCheckingForUpdate(() => logUpdate('checking'))
  engine.onUpdateAvailable((version) => logUpdate('available', version))
  engine.onUpdateNotAvailable(() => logUpdate('not-available'))
  engine.onDownloadProgress((percent) => logUpdate('progress', percent))
  engine.onError((error) => logUpdate('error', error.message))
  engine.onUpdateDownloaded((version) => {
    logUpdate('downloaded', version)
    engine.quitAndInstall({ silent: true, relaunch: true })
  })
  engine.configure({ feedChannel: 'beta', allowPrerelease: true })
  engine.setAutoDownload(true)
  engine.setFeed({ releaseUrl: feed })
  logUpdate('start', { version: localInfo.version, feed })
  engine.checkForUpdates().then(
    (check) => logUpdate('checked', check?.version ?? null),
    (error: unknown) => logUpdate('check-failed', String(error)),
  )
}
