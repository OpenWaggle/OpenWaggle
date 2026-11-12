/**
 * Starts the installed app for scripts/electrobun/ci/smoke.ts the way automation does
 * (scripts/support/electrobun-app-launch.ts), waits for its renderer and startup status `ready`, and
 * runs its CLI against the same profile.
 */
import os from 'node:os'
import {
  buildElectrobunAppEnvironment,
  type ConnectedElectrobunApp,
  connectElectrobunApp,
  electrobunAppHome,
  freePort,
  startElectrobunApp,
  stopElectrobunApp,
} from '../../support/electrobun-app-launch'
import { runAppCli, waitForStartupReady } from './app-proof'
import { type InstalledApp, stopProcessesUnder } from './installed-app'

const CLI_TIMEOUT_MS = 180_000

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

/** Starts the installed app hidden on a free CDP port and waits for its renderer and `ready`. */
export async function startApp(context: LaunchContext) {
  const cdpPort = await freePort()
  const started = await startElectrobunApp({
    launcher: context.app.launcher,
    cdpPort,
    userDataDir: context.profile,
    ...homeOptions(context),
    ...(context.environment === undefined ? {} : { environment: context.environment }),
    ...(context.appArguments === undefined ? {} : { appArguments: context.appArguments }),
    onLine: (line) => console.log(`[app] ${line}`),
  })
  try {
    const app = await connectElectrobunApp(started, context.timeoutMs)
    const rendererAt = Date.now()
    await waitForStartupReady(app.page, context.timeoutMs)
    return {
      app,
      spawnToRendererMs: rendererAt - app.spawnedAt,
      spawnToReadyMs: Date.now() - app.spawnedAt,
    }
  } catch (error) {
    await stopElectrobunApp(started)
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
