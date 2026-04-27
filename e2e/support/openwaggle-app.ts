import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { MainWindowPage } from '../page-models/main-window.page'

const E2E_ENV_KEYS: readonly string[] = [
  'CI',
  'COLORTERM',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'SYSTEMROOT',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
]

function buildElectronEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {
    OPENWAGGLE_USER_DATA_DIR: userDataDir,
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
  }

  for (const key of E2E_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value
    }
  }

  return env
}

export class OpenWaggleApp {
  private constructor(
    readonly userDataDir: string,
    private app: ElectronApplication,
    private currentWindow: Page,
  ) {}

  static async launch(prefix = 'openwaggle-e2e-'): Promise<OpenWaggleApp> {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const app = await electron.launch({
      args: ['.'],
      env: buildElectronEnv(userDataDir),
    })
    const window = await app.firstWindow()
    const instance = new OpenWaggleApp(userDataDir, app, window)
    await instance.mainWindow().waitUntilReady()
    return instance
  }

  async restart(): Promise<void> {
    await this.app.close()
    this.app = await electron.launch({
      args: ['.'],
      env: buildElectronEnv(this.userDataDir),
    })
    this.currentWindow = await this.app.firstWindow()
    await this.mainWindow().waitUntilReady()
  }

  async close(): Promise<void> {
    await this.app.close()
  }

  async cleanup(): Promise<void> {
    await this.close().catch(() => undefined)
    await fs.rm(this.userDataDir, { recursive: true, force: true })
  }

  window(): Page {
    return this.currentWindow
  }

  mainWindow(): MainWindowPage {
    return new MainWindowPage(this.currentWindow)
  }
}
