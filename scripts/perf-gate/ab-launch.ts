/**
 * One launch of a built OpenWaggle for the Performance Gate's A/B measurement
 * (scripts/perf-gate/ab-run.ts): spawn it on a scratch profile with its DevTools endpoint and Node
 * inspector open, install the renderer boot probe before the page's scripts run
 * (scripts/perf/lib/perf-page.ts) and an IPC recorder in the main process, and wait until the chat
 * is ready.
 *
 * - window ready: the main process's `window-ready-to-show` startup mark;
 * - backend ready: its `startup-status-ready` mark (the Session Host answered);
 * - chat ready: the renderer's `chatReady` milestone (the shell is up and no longer loading chat);
 * - the IPC calls the renderer made before chat ready.
 *
 * Marks are process uptime and the renderer milestone is the renderer's clock against the spawn
 * time, so each is ms after spawn either way.
 */
import type { Browser, Page } from '@playwright/test'
import {
  type InstalledElectronApp,
  type ScratchProfile,
  type StartedApp,
  freePort,
  startElectronApp,
  stopElectronApp,
} from '../bench/electron-installed-app'
import { connectInspector, type CdpClient } from '../perf/lib/main-inspector'
import { connectRenderer, readRendererBoot, waitForMilestones } from '../perf/lib/perf-page'

const LAUNCH_TIMEOUT_MS = 120_000
const STARTUP_TIMING_PATTERN = /Startup timing at ([0-9.]+) ms uptime.*label: '([^']+)'/u
const LOADING_CHAT_TEXT = 'Loading chat'
const WINDOW_READY_MARK = 'window-ready-to-show'
const BACKEND_READY_MARK = 'startup-status-ready'
const MARK_POLL_MS = 50
const LOG_TAIL_LINES = 30

/**
 * Wraps every `ipcMain.handle` handler, the ones registered already and later ones, so each invoke
 * records its channel and wall-clock start. Installed over the inspector as early as it answers,
 * which is before the window loads its page.
 */
const IPC_RECORDER = `(() => {
  if (globalThis.__owPerfGateIpc) return globalThis.__owPerfGateIpc.handlersAtInstall
  const { ipcMain } = process.mainModule.require('electron')
  const log = { invokes: [], handlersAtInstall: ipcMain._invokeHandlers.size }
  globalThis.__owPerfGateIpc = log
  const wrap = (channel, handler) => (event, ...args) => {
    log.invokes.push({ channel, at: Date.now() })
    return handler(event, ...args)
  }
  for (const [channel, handler] of ipcMain._invokeHandlers) ipcMain._invokeHandlers.set(channel, wrap(channel, handler))
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) => handle(channel, wrap(channel, handler))
  return log.handlersAtInstall
})()`
const MAIN_MODULE_LOADED = "typeof process.mainModule?.require === 'function'"
const PAGE_EXISTS =
  "process.mainModule.require('electron').webContents.getAllWebContents().length > 0"
const IPC_READ = 'JSON.stringify(globalThis.__owPerfGateIpc?.invokes ?? [])'

export interface LaunchTimings {
  readonly windowReadyMs: number | null
  readonly backendReadyMs: number | null
  readonly chatReadyMs: number | null
  /** IPC invokes the renderer made before the chat was ready; null if the recorder was late. */
  readonly ipcCallsUntilChatReady: number | null
  /** The same invokes by channel. */
  readonly ipcChannelsUntilChatReady: Readonly<Record<string, number>> | null
}

export interface Launched {
  readonly started: StartedApp
  readonly browser: Browser
  readonly page: Page
  readonly inspector: CdpClient
  readonly timings: LaunchTimings
}

function marks(started: StartedApp) {
  const found: Record<string, number> = {}
  for (const line of started.logLines) {
    const match = STARTUP_TIMING_PATTERN.exec(line)
    const [, uptime, label] = match ?? []
    if (uptime !== undefined && label !== undefined && found[label] === undefined) {
      found[label] = Number(uptime)
    }
  }
  return found
}

async function waitForMark(started: StartedApp, label: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = marks(started)[label]
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, MARK_POLL_MS))
  }
  return null
}

/** The inspector can answer before Node has loaded the app's entry script. */
async function waitForMainModule(inspector: CdpClient) {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if ((await inspector.evaluate(MAIN_MODULE_LOADED)) === true) return
    await new Promise((resolve) => setTimeout(resolve, MARK_POLL_MS))
  }
  throw new Error('The main process never loaded its entry script.')
}

function isInvoke(value: unknown): value is { channel: string; at: number } {
  return (
    typeof value === 'object' && value !== null && 'at' in value && typeof value.at === 'number'
  )
}

const IPC_READ_ATTEMPTS = 3

/** The recorder's JSON; hosted macOS once answered an evaluate with no value mid-launch. */
async function readIpcLog(inspector: CdpClient) {
  for (let attempt = 0; attempt < IPC_READ_ATTEMPTS; attempt += 1) {
    const value = await inspector.evaluate(IPC_READ).catch(() => undefined)
    if (typeof value === 'string') return value
    await new Promise((resolve) => setTimeout(resolve, MARK_POLL_MS))
  }
  return null
}

async function ipcCallsUntil(inspector: CdpClient, chatReadyAt: number | null) {
  if (chatReadyAt === null) return null
  const raw = await readIpcLog(inspector)
  // A read the inspector never answered leaves this launch's count unknown, not the run failed.
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  const invokes = (Array.isArray(parsed) ? parsed.filter(isInvoke) : []).filter(
    (invoke) => invoke.at <= chatReadyAt,
  )
  const channels: Record<string, number> = {}
  for (const invoke of invokes) channels[invoke.channel] = (channels[invoke.channel] ?? 0) + 1
  return { count: invokes.length, channels }
}

/** Launches the app on `profile` and waits until its chat is ready. */
export async function launchUntilChatReady(
  app: InstalledElectronApp,
  profile: ScratchProfile,
): Promise<Launched> {
  const cdpPort = await freePort()
  const inspectorPort = await freePort()
  const started = startElectronApp({
    app,
    profile,
    cdpPort,
    appArguments: [`--inspect=${String(inspectorPort)}`],
  })
  try {
    const inspector = await connectInspector(inspectorPort, LAUNCH_TIMEOUT_MS)
    await waitForMainModule(inspector)
    // The renderer calls nothing before the page loads, and the page loads after every handler
    // is registered; a recorder installed after that missed calls and counts none.
    const pageExisted = Boolean(await inspector.evaluate(PAGE_EXISTS).catch(() => true))
    await inspector.evaluate(IPC_RECORDER)
    const { browser, page } = await connectRenderer(cdpPort, LAUNCH_TIMEOUT_MS, {
      sessionListText: null,
      loadingText: LOADING_CHAT_TEXT,
    })
    await waitForMilestones(page, ['shell', 'chatReady'], LAUNCH_TIMEOUT_MS)
    const boot = await readRendererBoot(page, true)
    const chatReadyRenderer = boot.milestones['chatReady']
    const chatReadyAt = chatReadyRenderer === undefined ? null : boot.timeOrigin + chatReadyRenderer
    const ipcCalls = pageExisted ? null : await ipcCallsUntil(inspector, chatReadyAt)
    const timings: LaunchTimings = {
      windowReadyMs: await waitForMark(started, WINDOW_READY_MARK, LAUNCH_TIMEOUT_MS),
      backendReadyMs: await waitForMark(started, BACKEND_READY_MARK, LAUNCH_TIMEOUT_MS),
      chatReadyMs: chatReadyAt === null ? null : Math.round(chatReadyAt - started.spawnedAt),
      ipcCallsUntilChatReady: ipcCalls?.count ?? null,
      ipcChannelsUntilChatReady: ipcCalls?.channels ?? null,
    }
    return { started, browser, page, inspector, timings }
  } catch (error) {
    await stopElectronApp(started)
    throw new Error(`${String(error)}\n${started.logLines.slice(-LOG_TAIL_LINES).join('\n')}`, {
      cause: error,
    })
  }
}
