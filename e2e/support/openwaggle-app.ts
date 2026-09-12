import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, type ElectronApplication, type Page, test } from '@playwright/test'
import electronExecutablePath from 'electron'
import { probeLocalSessionHost } from '../../src/main/session-host/local-session-client'
import {
  refreshLocalSessionHostEndpoint,
  resolveLocalSessionHostPaths,
} from '../../src/main/session-host/local-session-paths'
import { shouldUseHiddenElectron } from '../../scripts/electron-launch-mode'
import { applicationCliStdout } from '../../scripts/electron-cli-stdout'
import {
  buildPlaywrightElectronEnvironment,
  launchOpenWaggleElectron,
} from '../../scripts/playwright-electron-launcher'
import {
  captureElectronStartupDiagnostics,
  electronStartupErrorMessage,
} from '../../scripts/qa/electron-startup-diagnostics'
import { cliExitError, cliProcessError } from '../../scripts/qa/cli-exit-diagnostics'
import {
  prepareQaProfileRemoval,
  shutdownSessionHostForQa,
} from '../../scripts/qa/session-host-shutdown'
import { MainWindowPage } from '../page-models/main-window.page'
import { closeElectronApplication } from './electron-process-tree'

const execFileAsync = promisify(execFile)
let evidenceDirectoryPromise: Promise<string> | null = null
let evidenceSequence = 0
const QA_DIAGNOSTIC_TEXT_LIMIT = 1_000
const QA_SCREENSHOT_SETTLE_MS = 250
const CLI_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const CLI_TIMEOUT_MS = 30_000

function runRoutedElectronCli(
  electronArguments: readonly string[],
  environment: Readonly<Record<string, string>>,
) {
  return new Promise<{ readonly stdout: string; readonly stderr: string }>((resolve, reject) => {
    const child = spawn(electronExecutablePath, electronArguments, {
      cwd: process.cwd(),
      env: { ...environment, OPENWAGGLE_CLI_OUTPUT_FD: '3' },
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    const timeout = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS)
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > CLI_MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        return
      }
      target.push(chunk)
    }
    child.stdio[3]?.on('data', collect(stdout))
    child.stderr?.on('data', collect(stderr))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (outputBytes > CLI_MAX_OUTPUT_BYTES) {
        reject(new Error('OpenWaggle CLI exceeded the E2E output limit.'))
        return
      }
      if (code !== 0) {
        reject(
          cliExitError(code, signal, Buffer.concat(stderr).toString(), Buffer.concat(stdout).toString()),
        )
        return
      }
      try {
        resolve({
          stdout: applicationCliStdout(Buffer.concat(stdout).toString(), 'linux'),
          stderr: Buffer.concat(stderr).toString(),
        })
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function runProfileCli(
  profile: { readonly userDataDir: string; readonly hidden: boolean; readonly piAgentDir?: string },
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const electronArguments = [
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-logging', '--log-level=3'] : []),
    '.',
    ...(process.platform === 'win32' ? ['--'] : []),
    ...args,
  ]
  const environment = buildPlaywrightElectronEnvironment(profile)
  if (process.platform === 'linux') {
    return runRoutedElectronCli(electronArguments, environment)
  }
  const result = await execFileAsync(electronExecutablePath, electronArguments, {
    cwd: process.cwd(),
    env: environment,
    maxBuffer: CLI_MAX_OUTPUT_BYTES,
    timeout: CLI_TIMEOUT_MS,
  }).catch((error: unknown) => {
    throw cliProcessError(error)
  })
  return { stdout: applicationCliStdout(result.stdout), stderr: result.stderr }
}

interface OpenWaggleAppLaunchOptions {
  readonly environment?: Readonly<Record<string, string>>
  readonly isolatedPiAgent?: boolean
  readonly startHostViaCli?: boolean
}

function evidenceDirectory() {
  evidenceDirectoryPromise ??= fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-evidence-')).then(
    (directory) => {
      console.info(`[electron-qa] screenshots: ${directory}`)
      return directory
    },
  )
  return evidenceDirectoryPromise
}

function evidenceName(prefix: string) {
  evidenceSequence += 1
  const safePrefix = prefix.replaceAll(/[^a-z0-9-]+/giu, '-').replaceAll(/^-|-$/gu, '')
  return `${String(evidenceSequence).padStart(3, '0')}-${safePrefix || 'electron-qa'}.png`
}

function cleanupFailure(errors: readonly unknown[], message: string) {
  if (errors.length === 0) return undefined
  return new AggregateError(errors, message)
}

function reportRetainedProfile(userDataDir: string) {
  console.error(`[electron-qa] retained profile: ${userDataDir}`)
}

async function hostInstanceId(userDataDir: string) {
  const paths = await refreshLocalSessionHostEndpoint(
    resolveLocalSessionHostPaths({ userDataRoot: userDataDir }),
  )
  const negotiation = await probeLocalSessionHost({
    paths,
    clientKind: 'internal',
    clientVersion: 'qa-cli-host-ownership',
  })
  return negotiation.hostInstanceId
}

export class OpenWaggleApp {
  private constructor(
    readonly userDataDir: string,
    private app: ElectronApplication,
    private currentWindow: Page,
    readonly hidden: boolean,
    private readonly evidencePrefix: string,
    readonly piAgentDir?: string,
    private readonly cliOwnerHostInstanceId?: string,
    private readonly environment?: Readonly<Record<string, string>>,
  ) {}

  static async launch(
    prefix = 'openwaggle-e2e-',
    options: OpenWaggleAppLaunchOptions = {},
  ): Promise<OpenWaggleApp> {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const hidden = shouldUseHiddenElectron(test.info().project.use.headless)
    const piAgentDir = options.isolatedPiAgent ? path.join(userDataDir, 'pi-agent') : undefined
    let app: ElectronApplication | null = null
    let window: Page | null = null
    let startupDiagnostics: ReturnType<typeof captureElectronStartupDiagnostics> | null = null
    let cliOwnerHostInstanceId: string | undefined
    try {
      if (options.startHostViaCli) {
        await runProfileCli({ userDataDir, hidden, piAgentDir }, [
          'sessions',
          'list',
          '--all',
          '--json',
        ])
        cliOwnerHostInstanceId = await hostInstanceId(userDataDir)
      }
      app = await launchOpenWaggleElectron({
        userDataDir,
        hidden,
        piAgentDir,
        ...(options.environment === undefined ? {} : { environment: options.environment }),
      })
      startupDiagnostics = captureElectronStartupDiagnostics(app.process())
      window = await app.firstWindow()
      const instance = new OpenWaggleApp(
        userDataDir,
        app,
        window,
        hidden,
        prefix,
        piAgentDir,
        cliOwnerHostInstanceId,
        options.environment,
      )
      await instance.mainWindow().waitUntilReady()
      await instance.assertCliHostOwnership()
      return instance
    } catch (error) {
      const secondaryErrors: unknown[] = []
      if (window !== null) {
        try {
          const directory = await evidenceDirectory()
          const screenshotPath = path.join(directory, evidenceName(`${prefix}-launch-failure`))
          await window.screenshot({ path: screenshotPath })
          console.error(`[electron-qa] screenshot: ${screenshotPath}`)
        } catch (screenshotError) {
          console.error('[electron-qa] launch screenshot capture failed', screenshotError)
          secondaryErrors.push(screenshotError)
        }
        try {
          const diagnostics = await window.evaluate((textLimit) => ({
            bodyText: document.body.innerText.slice(0, textLimit),
            title: document.title,
            url: location.href,
          }), QA_DIAGNOSTIC_TEXT_LIMIT)
          console.error('[electron-qa] launch diagnostics', diagnostics)
        } catch (diagnosticsError) {
          console.error('[electron-qa] launch diagnostics failed', diagnosticsError)
          secondaryErrors.push(diagnosticsError)
        }
      } else {
        console.error(
          '[electron-qa] launch failed before Electron created a page',
          startupDiagnostics?.snapshot(error) ?? { error: electronStartupErrorMessage(error) },
        )
      }
      let closeSucceeded = true
      try {
        if (app !== null) await closeElectronApplication(app)
      } catch (closeError) {
        closeSucceeded = false
        secondaryErrors.push(closeError)
      }
      try {
        await shutdownSessionHostForQa(
          userDataDir,
          closeSucceeded
            ? (ownership) => prepareQaProfileRemoval(userDataDir, ownership)
            : async () => undefined,
        )
      } catch (shutdownError) {
        secondaryErrors.push(shutdownError)
        closeSucceeded = false
      }
      if (!closeSucceeded) reportRetainedProfile(userDataDir)
      const cleanupError = cleanupFailure(
        secondaryErrors,
        'OpenWaggle launch failed and QA cleanup also failed.',
      )
      if (cleanupError !== undefined) {
        throw new AggregateError(
          [error, cleanupError],
          'OpenWaggle launch failed and QA cleanup also failed.',
        )
      }
      throw error
    } finally {
      startupDiagnostics?.stop()
    }
  }

  /** A fixture callback explicitly cold-starts the Host; ordinary restarts preserve it. */
  async restart(whileHostStopped?: () => Promise<void>): Promise<void> {
    if (whileHostStopped !== undefined && this.cliOwnerHostInstanceId !== undefined) {
      throw new Error('A CLI-owned Host must survive GUI restarts.')
    }
    await closeElectronApplication(this.app)
    if (whileHostStopped !== undefined) {
      await shutdownSessionHostForQa(this.userDataDir, whileHostStopped)
    }
    this.app = await launchOpenWaggleElectron({
      userDataDir: this.userDataDir,
      hidden: this.hidden,
      piAgentDir: this.piAgentDir,
      ...(this.environment === undefined ? {} : { environment: this.environment }),
    })
    this.currentWindow = await this.app.firstWindow()
    await this.mainWindow().waitUntilReady()
    await this.assertCliHostOwnership()
  }

  private async assertCliHostOwnership(): Promise<void> {
    if (this.cliOwnerHostInstanceId !== undefined) {
      expect(await hostInstanceId(this.userDataDir), 'GUI must retain the CLI-started Host').toBe(
        this.cliOwnerHostInstanceId,
      )
    }
  }

  async close(): Promise<void> {
    await closeElectronApplication(this.app)
  }

  async runCli(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string }> {
    return runProfileCli(this, args)
  }

  async confirmNativeDialogs(response = 1): Promise<void> {
    await this.app.evaluate(({ dialog }, dialogResponse) => {
      dialog.showMessageBox = () =>
        Promise.resolve({
          response: dialogResponse,
          checkboxChecked: false,
        })
    }, response)
  }

  async cleanup(): Promise<void> {
    const errors: unknown[] = []
    try {
      await this.captureEvidence(this.evidencePrefix)
    } catch (error) {
      errors.push(error)
    }
    let closeSucceeded = true
    try {
      await this.close()
    } catch (error) {
      closeSucceeded = false
      errors.push(error)
    }
    try {
      await shutdownSessionHostForQa(
        this.userDataDir,
        closeSucceeded
          ? (ownership) => prepareQaProfileRemoval(this.userDataDir, ownership)
          : async () => undefined,
      )
    } catch (error) {
      closeSucceeded = false
      errors.push(error)
    }
    if (!closeSucceeded) reportRetainedProfile(this.userDataDir)
    const error = cleanupFailure(errors, 'Electron QA cleanup failed in multiple stages.')
    if (error !== undefined) {
      console.error('[electron-qa] cleanup failed', error)
      expect.soft(error, 'Electron QA must capture evidence and clean up safely').toBeUndefined()
    }
  }

  async captureEvidence(prefix: string): Promise<string> {
    const directory = await evidenceDirectory()
    const screenshotPath = path.join(directory, evidenceName(prefix))
    await this.currentWindow.waitForTimeout(QA_SCREENSHOT_SETTLE_MS)
    await this.currentWindow.screenshot({ path: screenshotPath })
    console.info(`[electron-qa] screenshot: ${screenshotPath}`)
    return screenshotPath
  }

  async desktopState() {
    return this.app.evaluate(({ app, BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      return {
        active: process.platform === 'darwin' ? app.isActive() : false,
        focused: windows.some((window) => window.isFocused()),
        visible: windows.some((window) => window.isVisible()),
      }
    })
  }

  async desktopPolicyProbe() {
    return this.app.evaluate(({ BaseWindow, BrowserWindow }) => {
      const probeWindow = new BrowserWindow({ show: false })
      // Electron's window classes are non-configurable exports. The repository
      // guard confines production construction to hidden-by-default helpers; this
      // real-runtime probe verifies their reveal methods still fail closed.
      const probeBaseWindow = new BaseWindow({ show: false })
      let focusBlocked = false
      let showBlocked = false
      let baseFocusBlocked = false
      let baseShowBlocked = false
      try {
        probeWindow.focus()
      } catch {
        focusBlocked = true
      }
      try {
        probeWindow.show()
      } catch {
        showBlocked = true
      }
      try {
        probeBaseWindow.focus()
      } catch {
        baseFocusBlocked = true
      }
      try {
        probeBaseWindow.show()
      } catch {
        baseShowBlocked = true
      }
      const constructedVisible = probeWindow.isVisible()
      const baseConstructedVisible = probeBaseWindow.isVisible()
      probeWindow.destroy()
      probeBaseWindow.destroy()
      return {
        baseConstructedVisible,
        baseFocusBlocked,
        baseShowBlocked,
        constructedVisible,
        focusBlocked,
        showBlocked,
      }
    })
  }

  window(): Page {
    return this.currentWindow
  }

  electronApplication(): ElectronApplication {
    return this.app
  }

  async resizeMainWindow(width: number, height: number): Promise<void> {
    await this.app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height),
      { width, height },
    )
  }

  /**
   * Emits a real `agent:event` from the main process.
   *
   * Uses the channel `stream-bridge` uses, so the renderer's own preload listener, stream reducer,
   * and projection all run. A pending authorization request and a live notification only exist
   * in-flight, so seeding the database cannot produce either; this is the only way to see the
   * request ribbon and the notification stack in the real application.
   */
  async emitAgentEvent(payload: { sessionId: string; event: unknown }): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }, eventPayload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('agent:event', eventPayload)
      }
    }, payload)
  }

  async emitWorktreeLaunch(payload: { sessionId: string; launch: unknown }): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }, launchPayload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('agent:worktree-launch', launchPayload)
      }
    }, payload)
  }

  /**
   * Replaces the next classic agent dispatch with a real main-process IPC probe.
   * The renderer still crosses contextBridge and IPC exactly as production does; only the
   * provider run is stubbed so E2E can inspect the payload without network credentials.
   * Restarting the app restores the production handler.
   */
  async installAgentSendProbe(): Promise<void> {
    await this.app.evaluate(({ BrowserWindow, ipcMain }) => {
      const probeGlobal = globalThis as typeof globalThis & {
        __openWaggleAgentSendProbe?: unknown
      }
      probeGlobal.__openWaggleAgentSendProbe = null
      ipcMain.removeHandler('agent:send-message')
      ipcMain.handle('agent:send-message', (_event, sessionId, payload, model) => {
        probeGlobal.__openWaggleAgentSendProbe = { sessionId, payload, model }
        setTimeout(() => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('agent:run-completed', { sessionId })
          }
        }, 25)
        return { outcome: 'delivered' }
      })
      ipcMain.removeHandler('providers:get-models')
      ipcMain.handle('providers:get-models', () => [
        {
          provider: 'e2e-probe',
          displayName: 'E2E Probe',
          auth: { type: 'none' },
          models: [
            {
              id: 'e2e-probe/visualization-context',
              modelId: 'visualization-context',
              name: 'Visualization Context Probe',
              provider: 'e2e-probe',
              available: true,
              availableThinkingLevels: ['off'],
              contextWindow: 32_768,
            },
          ],
        },
      ])
    })
    const settingsResult = await this.currentWindow.evaluate(() =>
      window.api.updateSettings({
        enabledModels: ['e2e-probe/visualization-context'],
        selectedModel: 'e2e-probe/visualization-context',
      }),
    )
    if (!settingsResult.ok) {
      throw new Error(`Failed to configure the agent send probe: ${settingsResult.error}`)
    }
    await this.currentWindow.reload()
    await this.mainWindow().waitUntilReady()
  }

  async readAgentSendProbe(): Promise<unknown> {
    return this.app.evaluate(() => {
      const probeGlobal = globalThis as typeof globalThis & {
        __openWaggleAgentSendProbe?: unknown
      }
      return probeGlobal.__openWaggleAgentSendProbe ?? null
    })
  }

  async installAgentSteerProbe(): Promise<void> {
    await this.app.evaluate(({ ipcMain }) => {
      const probeGlobal = globalThis as typeof globalThis & {
        __openWaggleAgentSteerProbe?: {
          received: unknown[]
          delivered: unknown[]
          release: (() => void) | null
        }
      }
      probeGlobal.__openWaggleAgentSteerProbe = {
        received: [],
        delivered: [],
        release: null,
      }
      ipcMain.removeHandler('agent:steer')
      ipcMain.handle('agent:steer', async (_event, sessionId, payload) => {
        const probe = probeGlobal.__openWaggleAgentSteerProbe
        if (!probe) throw new Error('Steer probe was not installed')
        const delivery = { sessionId, payload }
        probe.received.push(delivery)
        await new Promise<void>((resolve) => {
          probe.release = resolve
        })
        probe.delivered.push(delivery)
        probe.release = null
        return {
          preserved: true,
          delivery: { delivery: 'queued', durableText: payload.text },
        }
      })
    })
  }

  async releaseAgentSteerProbe(): Promise<void> {
    await this.app.evaluate(() => {
      const probeGlobal = globalThis as typeof globalThis & {
        __openWaggleAgentSteerProbe?: { release: (() => void) | null }
      }
      probeGlobal.__openWaggleAgentSteerProbe?.release?.()
    })
  }

  async readAgentSteerProbe(): Promise<{ received: unknown[]; delivered: unknown[] }> {
    return this.app.evaluate(() => {
      const probeGlobal = globalThis as typeof globalThis & {
        __openWaggleAgentSteerProbe?: { received: unknown[]; delivered: unknown[] }
      }
      return {
        received: probeGlobal.__openWaggleAgentSteerProbe?.received ?? [],
        delivered: probeGlobal.__openWaggleAgentSteerProbe?.delivered ?? [],
      }
    })
  }

  async installSessionDetailSnapshotProbe(input: {
    readonly sessionId: string
    readonly detail: unknown
  }): Promise<void> {
    await this.app.evaluate(({ ipcMain }, probeInput) => {
      ipcMain.removeHandler('sessions:get-detail')
      ipcMain.handle('sessions:get-detail', (_event, sessionId) =>
        String(sessionId) === probeInput.sessionId ? probeInput.detail : null,
      )
    }, input)
  }

  mainWindow(): MainWindowPage {
    return new MainWindowPage(this.currentWindow)
  }
}
