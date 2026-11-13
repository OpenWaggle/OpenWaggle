/**
 * Starts the installed app for scripts/electrobun/ci/smoke.ts the way automation does
 * (scripts/support/electrobun-app-launch.ts), waits for its renderer and startup status `ready`, and
 * runs its CLI against the same profile.
 */
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import {
  LAUNCHER_CHOSEN_CDP_PORT,
  buildElectrobunAppEnvironment,
  type ConnectedElectrobunApp,
  connectElectrobunApp,
  electrobunAppHome,
  freePort,
  startElectrobunApp,
  stopElectrobunApp,
} from '../../support/electrobun-app-launch'
import { runAppCli, waitForStartupReady, waitUntil } from './app-proof'
import { type InstalledApp, processesUnder, stopProcessesUnder } from './installed-app'

const CLI_TIMEOUT_MS = 180_000
const LOOPBACK_LISTENER = /^n127\.0\.0\.1:(\d+)$/u

export interface LaunchContext {
  readonly app: InstalledApp
  readonly profile: string
  readonly screenshots: string | null
  readonly timeoutMs: number
  readonly environment?: Readonly<Record<string, string>>
  readonly appArguments?: readonly string[]
  /**
   * The user's own HOME instead of the profile's scratch one. Electrobun's updater only updates an
   * app in the directory it manages under HOME (Linux `~/.local/share`, macOS `~/Library`), so the
   * update proof runs the installed app with the runner's HOME; Pi keeps the scratch agent directory.
   */
  readonly realHome?: boolean
  /**
   * The launcher chooses CEF's DevTools port, as in a user's launch (vendor/electrobun patch
   * 0007), instead of the harness passing one; the harness then finds it on the app's processes.
   * macOS and Linux only.
   */
  readonly launcherCdpPort?: boolean
}

function homeOptions(context: LaunchContext) {
  if (context.realHome !== true) return {}
  return {
    homeDir: os.homedir(),
    piAgentDir: electrobunAppHome({ userDataDir: context.profile }).piAgentDir,
  }
}

/** The CLI with the same profile as the window, so it reaches the window's Session Host. */
export function appCli(context: LaunchContext, cdpPort: number) {
  const environment = buildElectrobunAppEnvironment({
    userDataDir: context.profile,
    cdpPort,
    ...homeOptions(context),
  })
  return (args: readonly string[]) =>
    runAppCli({
      bun: context.app.bun,
      appRoot: context.app.appRoot,
      args,
      environment,
      timeoutMs: CLI_TIMEOUT_MS,
    })
}

/** The loopback ports the app's processes listen on (`lsof`, macOS and Linux). */
function listeningPorts(installRoot: string) {
  const pids = processesUnder(installRoot).map((row) => String(row.pid))
  if (pids.length === 0) return []
  try {
    const output = execFileSync(
      'lsof',
      ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', pids.join(','), '-Fn'],
      { encoding: 'utf8' },
    )
    return output.split('\n').flatMap((line) => {
      const port = LOOPBACK_LISTENER.exec(line)?.[1]
      return port === undefined ? [] : [Number(port)]
    })
  } catch {
    // lsof exits 1 when nothing matched yet.
    return []
  }
}

async function servesDevTools(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`)
    if (!response.ok) return false
    const version: unknown = await response.json()
    return typeof version === 'object' && version !== null && 'Browser' in version
  } catch {
    return false
  }
}

/** The DevTools port the launcher chose: the app's loopback listener that answers `/json/version`. */
async function launcherChosenCdpPort(context: LaunchContext) {
  if (process.platform === 'win32') {
    throw new Error('Finding the launcher-chosen DevTools port needs lsof (macOS and Linux).')
  }
  return waitUntil('the launcher-chosen DevTools port', context.timeoutMs, async () => {
    for (const port of new Set(listeningPorts(context.app.installRoot))) {
      if (await servesDevTools(port)) return port
    }
    return null
  })
}

/** Starts the installed app hidden on a free CDP port and waits for its renderer and `ready`. */
export async function startApp(context: LaunchContext) {
  const cdpPort = context.launcherCdpPort === true ? LAUNCHER_CHOSEN_CDP_PORT : await freePort()
  const launched = await startElectrobunApp({
    launcher: context.app.launcher,
    cdpPort,
    userDataDir: context.profile,
    ...homeOptions(context),
    ...(context.environment === undefined ? {} : { environment: context.environment }),
    ...(context.appArguments === undefined ? {} : { appArguments: context.appArguments }),
    onLine: (line) => console.log(`[app] ${line}`),
  })
  try {
    const started =
      cdpPort === LAUNCHER_CHOSEN_CDP_PORT
        ? await launcherChosenCdpPort(context).then((port) => ({
            ...launched,
            cdpPort: port,
            previewCdpPort: port,
          }))
        : launched
    const app = await connectElectrobunApp(started, context.timeoutMs)
    const rendererAt = Date.now()
    await waitForStartupReady(app.page, context.timeoutMs)
    return {
      app,
      spawnToRendererMs: rendererAt - app.spawnedAt,
      spawnToReadyMs: Date.now() - app.spawnedAt,
    }
  } catch (error) {
    await stopElectrobunApp(launched)
    stopProcessesUnder(context.app.installRoot)
    throw error
  }
}

/**
 * Quits the window first, as a user does, then stops the Session Host it leaves running and anything
 * else the install started. Stopping the Host under a running window fails the window's shutdown.
 */
export async function stopApp(context: LaunchContext, app: ConnectedElectrobunApp) {
  await app.close()
  await appCli(context, app.cdpPort)(['host', 'stop']).catch(() => undefined)
  stopProcessesUnder(context.app.installRoot)
}
