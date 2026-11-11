/**
 * The update step of scripts/electrobun/ci/smoke.ts: the installed app's own updater (the GUI path,
 * src/main/updater.ts, on Electrobun's updater) checks a loopback release directory, downloads the
 * newer build and installs it on Restart to update; the installed app then launches as that build.
 */
import { appRss } from '../../electrobun-probe-host'
import { type LaunchContext, startApp, stopApp } from './app-launch'
import { screenshot, waitUntil } from './app-proof'
import { installedVersion, processesUnder, stopProcessesUnder } from './installed-app'

const STATUS_POLL_MS = 2000
/** How long an install may take to hand over to the relaunched app before the next check. */
const RELAUNCH_MS = 20_000

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface UpdateStatusRecord {
  readonly atMs: number
  readonly status: unknown
}

function statusType(status: unknown) {
  return typeof status === 'object' && status !== null && 'type' in status
    ? String(status.type)
    : null
}

async function downloadUpdate(context: LaunchContext, from: string, feed: string) {
  const { app } = await startApp({
    ...context,
    environment: { OPENWAGGLE_AUTOMATION_UPDATE_FEED: feed },
  })
  const statuses: UpdateStatusRecord[] = []
  try {
    const version = await app.page.evaluate(async () => window.api.getAppVersion())
    if (version !== from) throw new Error(`The installed app is ${version}, not ${from}.`)
    await app.page.evaluate(async () => window.api.checkForUpdates())
    const deadline = Date.now() + context.timeoutMs
    let type: string | null = null
    while (Date.now() < deadline && type !== 'downloaded') {
      const status = await app.page.evaluate(async () => window.api.getUpdateStatus())
      type = statusType(status)
      if (JSON.stringify(statuses.at(-1)?.status) !== JSON.stringify(status)) {
        statuses.push({ atMs: Date.now() - app.spawnedAt, status })
      }
      if (type === 'error') throw new Error(`The update failed: ${JSON.stringify(status)}`)
      await delay(STATUS_POLL_MS)
    }
    if (type !== 'downloaded') {
      throw new Error(`No update downloaded: ${JSON.stringify(statuses)}`)
    }
    // The app quits inside this call, so its answer may never come back.
    void app.page.evaluate(async () => window.api.installUpdateNow()).catch(() => undefined)
    const installedAt = Date.now()
    await waitUntil('the app to quit for the update', context.timeoutMs, async () =>
      app.child.exitCode !== null || app.child.signalCode !== null ? true : null,
    )
    return { statuses, quitMs: Date.now() - installedAt }
  } catch (error) {
    await stopApp(context, app)
    throw error
  }
}

export async function proveUpdate(
  context: LaunchContext,
  options: { readonly from: string; readonly expect: string; readonly feed: string },
) {
  if (options.from === '' || options.feed === '') throw new Error('update needs --from and --feed')
  const downloaded = await downloadUpdate(context, options.from, options.feed)
  const installStarted = Date.now()
  await waitUntil(`version.json to read ${options.expect}`, context.timeoutMs, async () =>
    installedVersion(context.app) === options.expect ? true : null,
  )
  const installedMs = Date.now() - installStarted
  // Electrobun's install starts the new build; give it time to appear, then stop it, since CEF lets
  // one process per app identifier run and the check below starts its own.
  await delay(RELAUNCH_MS)
  const relaunched = processesUnder(context.app.installRoot).length
  stopProcessesUnder(context.app.installRoot)
  await delay(STATUS_POLL_MS)
  const { app, spawnToReadyMs } = await startApp(context)
  try {
    const version = await app.page.evaluate(async () => window.api.getAppVersion())
    if (version !== options.expect) {
      throw new Error(`After the update the app is ${version}, not ${options.expect}.`)
    }
    const shot = await screenshot(app.page, context.screenshots, 'updated.png')
    const rssBytes = app.child.pid === undefined ? 0 : appRss(app.child.pid)
    return {
      from: options.from,
      version,
      ...downloaded,
      installedMs,
      relaunchedProcesses: relaunched,
      spawnToReadyMs,
      rssBytes,
      screenshot: shot,
    }
  } finally {
    await stopApp(context, app)
  }
}
