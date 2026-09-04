import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page, test } from '@playwright/test'
import { closeElectronApplication } from './electron-process-tree'
import { shouldUseHiddenElectron } from '../../scripts/electron-launch-mode'
import { launchOpenWaggleElectron } from '../../scripts/playwright-electron-launcher'
import { MainWindowPage } from '../page-models/main-window.page'

let evidenceDirectoryPromise: Promise<string> | null = null
let evidenceSequence = 0
const QA_DIAGNOSTIC_TEXT_LIMIT = 1_000
const QA_SCREENSHOT_SETTLE_MS = 250
const USER_DATA_REMOVE_RETRIES = 3
const USER_DATA_REMOVE_RETRY_DELAY_MS = 500

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

export class OpenWaggleApp {
  private constructor(
    readonly userDataDir: string,
    private app: ElectronApplication,
    private currentWindow: Page,
    readonly hidden: boolean,
    private readonly evidencePrefix: string,
  ) {}

  static async launch(prefix = 'openwaggle-e2e-'): Promise<OpenWaggleApp> {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const hidden = shouldUseHiddenElectron(test.info().project.use.headless)
    let app: ElectronApplication | null = null
    let window: Page | null = null
    try {
      app = await launchOpenWaggleElectron({ userDataDir, hidden })
      window = await app.firstWindow()
      const instance = new OpenWaggleApp(userDataDir, app, window, hidden, prefix)
      await instance.mainWindow().waitUntilReady()
      return instance
    } catch (error) {
      if (window !== null) {
        const directory = await evidenceDirectory()
        const screenshotPath = path.join(directory, evidenceName(`${prefix}-launch-failure`))
        try {
          await window.screenshot({ path: screenshotPath })
          console.error(`[electron-qa] screenshot: ${screenshotPath}`)
        } catch (screenshotError) {
          console.error('[electron-qa] launch screenshot capture failed', screenshotError)
        }
        const diagnostics = await window
          .evaluate((textLimit) => ({
            bodyText: document.body.innerText.slice(0, textLimit),
            title: document.title,
            url: location.href,
          }), QA_DIAGNOSTIC_TEXT_LIMIT)
          .catch(() => null)
        console.error('[electron-qa] launch diagnostics', diagnostics)
      } else {
        console.error('[electron-qa] launch failed before Electron created a page')
      }
      if (app !== null) {
        await closeElectronApplication(app)
      }
      await fs.rm(userDataDir, { recursive: true, force: true })
      throw error
    }
  }

  async restart(): Promise<void> {
    await closeElectronApplication(this.app)
    this.app = await launchOpenWaggleElectron({
      userDataDir: this.userDataDir,
      hidden: this.hidden,
    })
    this.currentWindow = await this.app.firstWindow()
    await this.mainWindow().waitUntilReady()
  }

  async close(): Promise<void> {
    await closeElectronApplication(this.app)
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
    let evidenceError: unknown
    try {
      await this.captureEvidence(this.evidencePrefix)
    } catch (error) {
      evidenceError = error
    } finally {
      await this.close().catch(() => undefined)
      // A just-killed process tree can hold handles on the user-data dir for a moment;
      // a bounded retry keeps that race from failing an otherwise-passing test.
      let attempt = 0
      while (true) {
        try {
          await fs.rm(this.userDataDir, { recursive: true, force: true })
          break
        } catch (error) {
          if (attempt >= USER_DATA_REMOVE_RETRIES) {
            throw error
          }
          attempt += 1
          await this.currentWindow
            .waitForTimeout(USER_DATA_REMOVE_RETRY_DELAY_MS)
            .catch(() => undefined)
        }
      }
    }
    if (evidenceError !== undefined) {
      console.error('[electron-qa] final screenshot capture failed', evidenceError)
      expect.soft(evidenceError, 'Electron QA must capture its final screenshot').toBeUndefined()
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
